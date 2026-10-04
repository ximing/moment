import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  API_MODULES,
  attachConstraints,
  describeRoute,
  extractAllRaw,
  extractConstraintMessages,
  joinApi,
  moduleIdForPath,
  zodToJson,
} from "./generate-moment-skill-api.mjs";

const require = createRequire(
  new URL("../packages/dto/package.json", import.meta.url),
);
const { z } = require("zod");
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function fakeHooks() {
  return {
    resolve(name) {
      return { name, origin: "dto", schema: { title: name, type: "object" } };
    },
    compileInline(expr) {
      return {
        name: "inline",
        origin: "local",
        schema: { type: "string", description: expr },
      };
    },
  };
}

function must(raw, method, pathname) {
  const hit = raw.find(
    (route) => route.method === method && route.path === pathname,
  );
  assert.ok(
    hit,
    `missing ${method} ${pathname}\n${raw.map((route) => `${route.method} ${route.path}`).join("\n")}`,
  );
  return hit;
}

test("joinApi strips the controller trailing slash", () => {
  assert.equal(joinApi("/health", "/"), "/api/health");
  assert.equal(joinApi("", "/feed"), "/api/feed");
  assert.equal(
    joinApi("/chains/:chainId/moments", "/"),
    "/api/chains/:chainId/moments",
  );
});

test("moduleIdForPath splits nested chain resources", () => {
  assert.equal(moduleIdForPath("/api/chains/:chainId/moments"), "moments");
  assert.equal(
    moduleIdForPath("/api/chains/:chainId/recaps/:period"),
    "recaps",
  );
  assert.equal(moduleIdForPath("/api/chains/order"), "chains");
  assert.equal(moduleIdForPath("/api/moments/:id/comments"), "social");
  assert.equal(moduleIdForPath("/api/moments/:id"), "moments");
  assert.equal(moduleIdForPath("/api/auth/me"), "account");
  assert.equal(moduleIdForPath("/api/auth/tokens"), "account");
  assert.equal(moduleIdForPath("/api/auth/tokens/:id"), "account");
  assert.equal(moduleIdForPath("/api/internal/embeddings"), "internal");
  assert.equal(moduleIdForPath("/api/public/share/:token"), "share");
});

test("controllers and route files yield the live catalog shape", () => {
  const raw = extractAllRaw(repoRoot);
  assert.ok(raw.length >= 60, `expected at least 60 routes, got ${raw.length}`);
  const keys = raw.map((route) => `${route.method} ${route.path}`);
  assert.equal(
    new Set(keys).size,
    keys.length,
    `duplicate routes:\n${keys.join("\n")}`,
  );
  for (const route of raw) {
    assert.ok(route.path.startsWith("/api/"), route.path);
    assert.ok(!route.path.endsWith("/"), route.path);
  }

  const hooks = fakeHooks();
  const login = describeRoute(must(raw, "POST", "/api/auth/login"), hooks);
  assert.equal(login.auth, "none");
  assert.equal(login.body.name, "loginInputSchema");

  const me = describeRoute(must(raw, "GET", "/api/auth/me"), hooks);
  assert.equal(me.auth, "bearer");

  const createToken = describeRoute(
    must(raw, "POST", "/api/auth/tokens"),
    hooks,
  );
  assert.equal(createToken.auth, "bearer");
  assert.equal(createToken.body.name, "createAccessTokenInputSchema");
  assert.deepEqual(createToken.status, [201]);

  const revokeToken = describeRoute(
    must(raw, "DELETE", "/api/auth/tokens/:id"),
    hooks,
  );
  assert.equal(revokeToken.auth, "bearer");
  assert.deepEqual(revokeToken.status, [204]);

  const chains = describeRoute(must(raw, "GET", "/api/chains"), hooks);
  assert.equal(chains.auth, "bearer");

  const createMoment = describeRoute(
    must(raw, "POST", "/api/chains/:chainId/moments"),
    hooks,
  );
  assert.equal(createMoment.auth, "bearer");
  assert.equal(createMoment.role, "editor");
  assert.deepEqual(createMoment.status, [201]);
  assert.equal(createMoment.body.name, "createMomentInputSchema");

  const listMoments = describeRoute(
    must(raw, "GET", "/api/chains/:chainId/moments"),
    hooks,
  );
  assert.equal(listMoments.query.name, "listMomentsQuerySchema");

  const templates = describeRoute(must(raw, "GET", "/api/templates"), hooks);
  assert.equal(templates.auth, "bearer");
  assert.equal(templates.query.name, "listQuerySchema");

  const media = describeRoute(must(raw, "GET", "/api/media/:id"), hooks);
  assert.equal(media.auth, "optional");
  assert.ok(media.status.includes(302));
  assert.equal(
    media.query.schema.properties.variant.title,
    "mediaVariantSchema",
  );
  assert.equal(media.query.schema.properties.variant.optional, true);
  assert.equal(media.query.schema.properties.st.type, "string");

  const period = describeRoute(
    must(raw, "GET", "/api/chains/:chainId/recaps/:period"),
    hooks,
  );
  assert.equal(period.params.schema.properties.period.title, "periodSchema");
  assert.deepEqual(period.params.schema.required, ["period"]);

  const regenerate = describeRoute(
    must(raw, "POST", "/api/chains/:chainId/recaps/:period/regenerate"),
    hooks,
  );
  assert.equal(regenerate.role, "editor");
  assert.deepEqual(regenerate.status, [202]);

  const embedding = describeRoute(
    must(raw, "DELETE", "/api/internal/embeddings/:momentId"),
    hooks,
  );
  assert.equal(embedding.auth, "ba");
  assert.match(embedding.params.schema.properties.momentId.description, /uuid/);

  const turn = describeRoute(
    must(raw, "POST", "/api/agent/threads/:id/turns"),
    hooks,
  );
  assert.equal(turn.auth, "bearer");
  assert.equal(turn.stream, true);
  assert.equal(turn.body.name, "postAgentTurnInputSchema");

  const comments = describeRoute(
    must(raw, "GET", "/api/moments/:id/comments"),
    hooks,
  );
  assert.equal(comments.query.origin, "decorator");
  assert.equal(comments.query.schema.properties.cursor.type, "string");
  assert.equal(comments.query.schema.properties.limit.optional, true);
});

test("zodToJson keeps defaults, enums, and formats", () => {
  const schema = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    order: z.enum(["happened_at", "created_at"]).default("happened_at"),
    id: z.string().uuid(),
    nickname: z.string().min(1).max(50).optional(),
  });
  const json = zodToJson(schema);
  assert.equal(json.properties.limit.type, "integer");
  assert.equal(json.properties.limit.coerced, true);
  assert.equal(json.properties.limit.default, 20);
  assert.equal(json.properties.limit.optional, true);
  assert.equal(json.properties.limit.minimum, 1);
  assert.equal(json.properties.limit.maximum, 50);
  assert.deepEqual(json.properties.order.enum, ["happened_at", "created_at"]);
  assert.equal(json.properties.order.default, "happened_at");
  assert.equal(json.properties.id.format, "uuid");
  assert.equal(json.properties.nickname.optional, true);
  assert.equal(json.properties.nickname.minLength, 1);
  assert.deepEqual(json.required, ["id"]);
});

test("shared subschemas stay intact and lazy cycles stop", () => {
  const stamp = z
    .string()
    .regex(/^\d+$/)
    .refine(() => true, { message: "BAD" });
  const shared = zodToJson(
    z.object({ a: stamp.optional(), b: stamp.optional() }),
  );
  assert.equal(shared.properties.a.type, "string");
  assert.equal(shared.properties.a.pattern, "^\\d+$");
  assert.equal(shared.properties.b.type, "string");
  assert.equal(shared.properties.b.pattern, "^\\d+$");

  const node = z.lazy(() => z.object({ child: node.optional() }));
  const cycled = zodToJson(node);
  assert.equal(cycled.type, "object");
  assert.equal(cycled.properties.child.optional, true);

  const sized = zodToJson(z.string().length(64));
  assert.equal(sized.minLength, 64);
  assert.equal(sized.maxLength, 64);
});

test("constraint messages come from refine and addIssue", () => {
  const expr = `
    z.object({}).superRefine((val, ctx) => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CONTENT_REQUIRED', path: ['content'] });
    }).refine((val) => val, { message: 'EMPTY_PATCH' });
  `;
  assert.deepEqual(extractConstraintMessages(expr), [
    "CONTENT_REQUIRED",
    "EMPTY_PATCH",
  ]);
  const json = attachConstraints({ type: "object", refined: true }, expr);
  assert.deepEqual(json.constraints, ["CONTENT_REQUIRED", "EMPTY_PATCH"]);
  assert.equal(json.refined, undefined);
});

test("SKILL.md links every generated module", () => {
  const skill = readFileSync(
    path.join(repoRoot, "skills/moment/SKILL.md"),
    "utf8",
  );
  for (const mod of API_MODULES) {
    assert.ok(
      skill.includes(`references/${mod.id}.md`),
      `SKILL.md missing references/${mod.id}.md`,
    );
  }
});
