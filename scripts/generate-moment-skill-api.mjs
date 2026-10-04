#!/usr/bin/env node
/**
 * Maintainer script: extract HTTP endpoints from routing-controllers
 * modules, express route files, and @moment/dto into skills/moment/references/.
 *
 * Writes references only. skills/moment/SKILL.md and skills/moment/scripts/moment.mjs
 * are maintained by hand.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRootFromScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const referencesDir = path.join(repoRootFromScript, "skills/moment/references");

const CTRL_RE = /@JsonController\(\s*(?:(['"`])([^'"`]*)\1)?\s*\)/g;
const METHOD_RE = /@(Get|Post|Put|Patch|Delete)\(\s*(['"`])([^'"`]*)\2\s*\)/g;
const METHOD_ONCE_RE =
  /@(Get|Post|Put|Patch|Delete)\(\s*(['"`])([^'"`]*)\2\s*\)/;
const EXPRESS_RE = /\bapp\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g;
const NAMED_PARSE_RE =
  /([A-Za-z_][\w]*Schema)\s*\.\s*(?:parse|safeParse)\s*\(\s*([^)]*?)\s*\)/g;
const INLINE_PARSE_RE =
  /(z(?:\s*\.\s*[A-Za-z_][\w]*\s*(?:\([^)]*\))?)+)\s*\.\s*(?:parse|safeParse)\s*\(\s*([A-Za-z_][\w]*)\s*\)/g;
const LOCAL_SCHEMA_RE = /(?:export\s+)?const\s+(\w+Schema)\s*=\s*/g;
const QP_RE =
  /@QueryParam\(\s*['"]([^'"]+)['"]([\s\S]*?)\)\s*([A-Za-z_][\w]*)(\?)?/g;
const PARAM_RE = /@Param\(\s*['"]([^'"]+)['"]\s*\)\s*([A-Za-z_][\w]*)/g;

/** Coarse modules for agent-facing markdown. Keep SKILL.md links in sync. */
export const API_MODULES = [
  { id: "health", title: "健康检查" },
  { id: "account", title: "账号、通知与设备" },
  { id: "chains", title: "时光链与邀请" },
  { id: "moments", title: "时刻" },
  { id: "feed", title: "时间线与那年今日" },
  { id: "social", title: "评论与表情" },
  { id: "people", title: "标签与人物" },
  { id: "media", title: "媒体" },
  { id: "share", title: "分享" },
  { id: "templates", title: "模板与聚合" },
  { id: "recaps", title: "月度回顾" },
  { id: "search", title: "搜索" },
  { id: "jobs", title: "链上任务" },
  { id: "geocode", title: "逆地理" },
  { id: "agent", title: "助手" },
  { id: "internal", title: "内部向量" },
];

const NESTED_MODULE = [
  ["chains", "moments", "moments"],
  ["chains", "recaps", "recaps"],
  ["chains", "share-links", "share"],
  ["chains", "jobs", "jobs"],
  ["chains", "persons", "people"],
  ["chains", "tags", "people"],
  ["chains", "aggregate", "templates"],
  ["chains", "invites", "chains"],
  ["chains", "members", "chains"],
  ["chains", "transfer", "chains"],
  ["moments", "comments", "social"],
  ["moments", "reaction", "social"],
];

const TOP_MODULE = {
  health: "health",
  auth: "account",
  notifications: "account",
  devices: "account",
  invites: "chains",
  chains: "chains",
  moments: "moments",
  feed: "feed",
  memories: "feed",
  comments: "social",
  tags: "people",
  persons: "people",
  media: "media",
  "share-links": "share",
  public: "share",
  templates: "templates",
  search: "search",
  jobs: "jobs",
  geocode: "geocode",
  agent: "agent",
  internal: "internal",
};

export function findRepoRoot(start = repoRootFromScript) {
  let dir = path.resolve(start);
  for (;;) {
    if (
      existsSync(path.join(dir, "packages/dto/package.json")) &&
      existsSync(path.join(dir, "apps/server/src"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        "Not inside the moment repo (need packages/dto and apps/server/src).",
      );
    }
    dir = parent;
  }
}

export function joinApi(controllerPath, methodPath) {
  const c = controllerPath
    ? controllerPath.startsWith("/")
      ? controllerPath
      : `/${controllerPath}`
    : "";
  const m = methodPath
    ? methodPath.startsWith("/")
      ? methodPath
      : `/${methodPath}`
    : "";
  return normalizeFull(`/api${c}${m}`);
}

export function normalizeFull(apiPath) {
  let full = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  full = full.replace(/\/{2,}/g, "/");
  if (full.length > 1 && full.endsWith("/")) full = full.slice(0, -1);
  return full;
}

export function moduleIdForPath(apiPath) {
  const parts = apiPath.split("/").filter(Boolean);
  const segs = parts[0] === "api" ? parts.slice(1) : parts;
  const head = segs[0] ?? "other";
  const nested = segs[2];
  if (nested) {
    const hit = NESTED_MODULE.find(
      (row) => row[0] === head && row[1] === nested,
    );
    if (hit) return hit[2];
  }
  return TOP_MODULE[head] ?? head;
}

function listFiles(dir, test) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...listFiles(full, test));
    } else if (test(entry.name, full)) {
      out.push(full);
    }
  }
  return out;
}

function latestMtime(files) {
  let max = 0;
  for (const file of files) {
    if (!existsSync(file)) continue;
    const t = statSync(file).mtimeMs;
    if (t > max) max = t;
  }
  return max;
}

function ensureDtoBuilt(repoRoot) {
  const dtoRoot = path.join(repoRoot, "packages/dto");
  const dist = path.join(dtoRoot, "dist/index.js");
  const srcFiles = listFiles(path.join(dtoRoot, "src"), (name) =>
    name.endsWith(".ts"),
  );
  const distStale =
    !existsSync(dist) || latestMtime(srcFiles) > statSync(dist).mtimeMs;
  if (!distStale) return dist;
  execFileSync("pnpm", ["--filter", "@moment/dto", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (!existsSync(dist)) {
    throw new Error(
      "Failed to build @moment/dto (packages/dto/dist/index.js missing).",
    );
  }
  return dist;
}

function extractJsExpr(source, start) {
  let i = start;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let regex = false;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      i += 1;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (regex) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "/") regex = false;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      lineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && isRegexStart(source, i)) {
      regex = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === "(") paren += 1;
    else if (ch === ")") paren -= 1;
    else if (ch === "{") brace += 1;
    else if (ch === "}") brace -= 1;
    else if (ch === "[") bracket += 1;
    else if (ch === "]") bracket -= 1;
    else if (ch === ";" && paren === 0 && brace === 0 && bracket === 0) {
      return source.slice(start, i).trim();
    }
    if (paren < 0 || brace < 0 || bracket < 0) break;
    i += 1;
  }
  return source.slice(start, i).trim();
}

function isRegexStart(source, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(source[j])) j -= 1;
  if (j < 0) return true;
  return (
    /[([{:;,=!&|?]$/.test(source[j]) ||
    source.startsWith("return", Math.max(0, j - 5))
  );
}

function extractLocalSchemas(source) {
  const map = new Map();
  LOCAL_SCHEMA_RE.lastIndex = 0;
  let match;
  while ((match = LOCAL_SCHEMA_RE.exec(source))) {
    map.set(match[1], extractJsExpr(source, match.index + match[0].length));
  }
  return map;
}

function cleanComment(block) {
  return block
    .replace(/^\/\*\*/, "")
    .replace(/\*\/\s*$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ");
}

function precedingComment(source, index) {
  const before = source.slice(Math.max(0, index - 800), index);
  const match = before.match(/\/\*\*(?:[^*]|\*(?!\/))*\*\/\s*$/);
  if (!match) return undefined;
  const text = cleanComment(match[0]);
  return text || undefined;
}

function firstBlockComment(source) {
  const match = source.match(/\/\*\*[\s\S]*?\*\//);
  if (!match) return undefined;
  const text = cleanComment(match[0]);
  return text || undefined;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function queryParamsOf(snippet) {
  const out = [];
  QP_RE.lastIndex = 0;
  let match;
  while ((match = QP_RE.exec(snippet))) {
    out.push({
      name: match[1],
      variable: match[3],
      optional: !/required:\s*true/.test(match[2] ?? ""),
    });
  }
  return out;
}

function pathParamsOf(snippet) {
  const out = [];
  PARAM_RE.lastIndex = 0;
  let match;
  while ((match = PARAM_RE.exec(snippet))) {
    out.push({ name: match[1], variable: match[2] });
  }
  return out;
}

function parsesOf(snippet) {
  const out = [];
  NAMED_PARSE_RE.lastIndex = 0;
  let match;
  while ((match = NAMED_PARSE_RE.exec(snippet))) {
    out.push({ kind: "named", name: match[1], arg: match[2].trim() });
  }
  INLINE_PARSE_RE.lastIndex = 0;
  while ((match = INLINE_PARSE_RE.exec(snippet))) {
    out.push({
      kind: "inline",
      name: "inline",
      arg: match[2],
      expr: match[1].replace(/\s+/g, ""),
    });
  }
  return out;
}

function queryObjectVariable(snippet) {
  return snippet.match(/@QueryParams\(\)\s*([A-Za-z_][\w]*)/)?.[1];
}

function statusOf(snippet) {
  const codes = [...snippet.matchAll(/@HttpCode\(\s*(\d+)\s*\)/g)].map((m) =>
    Number(m[1]),
  );
  if (/res\.redirect\(/.test(snippet)) codes.push(302);
  return uniqueSorted(codes);
}

function roleOf(snippet) {
  return snippet.match(
    /requireChainRole\(\s*['"](owner|editor|viewer)['"]\s*\)/,
  )?.[1];
}

function authOf(snippet, classAuthorized) {
  if (/@UseBefore\(\s*baAuth\s*\)/.test(snippet)) return "ba";
  if (/@Authorized\(\)/.test(snippet) || classAuthorized) return "bearer";
  if (/UserProfile\s*\|\s*null/.test(snippet)) return "optional";
  return "none";
}

function expressAuth(snippet) {
  if (/baAuth|BA_AUTH/.test(snippet)) return "ba";
  if (/UnauthorizedError|\buser\?:/.test(snippet)) return "bearer";
  return "none";
}

function methodFrom(
  snippet,
  start,
  end,
  fullSource,
  fullStart,
  classAuthorized,
  classNote,
) {
  const body = snippet.slice(start, end);
  const decorator = body.match(METHOD_ONCE_RE);
  if (!decorator) return undefined;
  const comment = precedingComment(fullSource, fullStart) ?? classNote;
  const qps = queryObjectVariable(body);
  return {
    method: decorator[1].toUpperCase(),
    methodPath: decorator[3],
    auth: authOf(body, classAuthorized),
    role: roleOf(body),
    status: statusOf(body),
    comment,
    stream: /streamTurn|text\/event-stream/.test(body),
    queryParams: queryParamsOf(body),
    pathParams: pathParamsOf(body),
    parses: parsesOf(body),
    hasBody: /@Body\(/.test(body),
    queryObjectVariable: qps,
  };
}

export function extractControllerRoutes(relFile, source) {
  const routes = [];
  const controllers = [...source.matchAll(CTRL_RE)];
  for (let i = 0; i < controllers.length; i += 1) {
    const ctrl = controllers[i];
    const start = ctrl.index ?? 0;
    const end =
      i + 1 < controllers.length
        ? (controllers[i + 1].index ?? source.length)
        : source.length;
    const slice = source.slice(start, end);
    const classKey = slice.search(/\bclass\s+/);
    const prelude = classKey >= 0 ? slice.slice(0, classKey) : slice;
    const classAuthorized = /@Authorized\(\)/.test(prelude);
    const classNote = precedingComment(source, start);
    const methods = [...slice.matchAll(METHOD_RE)];
    for (let m = 0; m < methods.length; m += 1) {
      const method = methods[m];
      const methodStart = method.index ?? 0;
      const methodEnd =
        m + 1 < methods.length
          ? (methods[m + 1].index ?? slice.length)
          : slice.length;
      const described = methodFrom(
        slice,
        methodStart,
        methodEnd,
        source,
        start + methodStart,
        classAuthorized,
        classNote,
      );
      if (!described) continue;
      routes.push({
        ...described,
        path: joinApi(ctrl[2] ?? "", described.methodPath),
        file: relFile,
      });
    }
  }
  return routes;
}

export function extractExpressRoutes(relFile, source) {
  const matches = [...source.matchAll(EXPRESS_RE)];
  return matches.map((match, i) => {
    const start = match.index ?? 0;
    const end =
      i + 1 < matches.length
        ? (matches[i + 1].index ?? source.length)
        : source.length;
    const snippet = matches.length === 1 ? source : source.slice(start, end);
    const comment =
      precedingComment(source, start) ??
      (matches.length === 1 ? firstBlockComment(source) : undefined);
    return {
      method: match[1].toUpperCase(),
      path: normalizeFull(match[3]),
      auth: expressAuth(snippet),
      role: roleOf(snippet),
      status: statusOf(snippet),
      comment,
      stream: /streamTurn|text\/event-stream/.test(snippet),
      queryParams: queryParamsOf(snippet),
      pathParams: pathParamsOf(snippet),
      parses: parsesOf(snippet),
      hasBody: /@Body\(/.test(snippet) || /req\.body/.test(snippet),
      queryObjectVariable: queryObjectVariable(snippet),
      file: relFile,
    };
  });
}

export function extractAllRaw(repoRoot = findRepoRoot()) {
  const serverSrc = path.join(repoRoot, "apps/server/src");
  const raw = [];
  for (const file of listFiles(serverSrc, (name) =>
    name.endsWith(".controller.ts"),
  )) {
    raw.push(
      ...extractControllerRoutes(
        path.relative(repoRoot, file),
        readFileSync(file, "utf8"),
      ),
    );
  }
  for (const file of listFiles(serverSrc, (name) =>
    name.endsWith(".route.ts"),
  )) {
    raw.push(
      ...extractExpressRoutes(
        path.relative(repoRoot, file),
        readFileSync(file, "utf8"),
      ),
    );
  }
  return raw.sort(compareEndpoints);
}

function classifyParse(parse, route) {
  const arg = parse.arg.trim();
  if (arg === "body" || arg === "req.body") return { bucket: "body" };
  if (
    arg === "req.query" ||
    arg === "query" ||
    (route.queryObjectVariable && arg === route.queryObjectVariable)
  ) {
    return { bucket: "query" };
  }
  const qp = route.queryParams.find((item) => item.variable === arg);
  if (qp) return { bucket: "queryField", param: qp.name };
  const pp = route.pathParams.find((item) => item.variable === arg);
  if (pp) return { bucket: "paramField", param: pp.name };
  if (arg.startsWith("{")) {
    const keys = [...arg.matchAll(/[A-Za-z_][\w]*/g)].map((item) => item[0]);
    const queryNames = new Set(route.queryParams.map((item) => item.name));
    const allQuery =
      keys.length > 0 && keys.every((key) => queryNames.has(key));
    if (!route.hasBody || allQuery) return { bucket: "query" };
    return { bucket: "body" };
  }
  return { bucket: "unknown" };
}

function materialize(parse, hooks) {
  if (parse.kind === "inline") return hooks.compileInline(parse.expr);
  return hooks.resolve(parse.name);
}

function fieldSchema(resolved, optional) {
  if (!resolved?.schema) {
    const out = { description: resolved?.source ?? "unparsed" };
    if (optional) out.optional = true;
    return out;
  }
  const schema = { ...resolved.schema };
  if (optional) schema.optional = true;
  return schema;
}

function originOf(items) {
  const origins = [
    ...new Set(items.map((item) => item?.origin).filter(Boolean)),
  ];
  if (origins.length === 1) return origins[0];
  if (origins.length === 0) return "decorator";
  return "mixed";
}

export function describeRoute(route, hooks) {
  const parsed = route.parses.map((parse) => ({
    parse,
    classed: classifyParse(parse, route),
  }));
  const bodyParse = parsed.find((item) => item.classed.bucket === "body");
  const queryParse = parsed.find((item) => item.classed.bucket === "query");
  const body = bodyParse ? materialize(bodyParse.parse, hooks) : undefined;

  let query;
  if (queryParse) {
    query = materialize(queryParse.parse, hooks);
  } else {
    const fieldParses = parsed.filter(
      (item) => item.classed.bucket === "queryField",
    );
    if (route.queryParams.length > 0 || fieldParses.length > 0) {
      const properties = {};
      for (const qp of route.queryParams) {
        properties[qp.name] = {
          type: "string",
          ...(qp.optional ? { optional: true } : {}),
        };
      }
      const resolvedFields = [];
      for (const item of fieldParses) {
        const resolved = materialize(item.parse, hooks);
        resolvedFields.push(resolved);
        const qp = route.queryParams.find(
          (param) => param.name === item.classed.param,
        );
        properties[item.classed.param] = fieldSchema(
          resolved,
          qp ? qp.optional : true,
        );
      }
      const sameOrigin =
        resolvedFields.length > 0 &&
        resolvedFields.every(
          (item) => item?.origin === resolvedFields[0]?.origin,
        );
      const coversAll =
        route.queryParams.length > 0 &&
        route.queryParams.length === fieldParses.length;
      query = {
        name: "query",
        origin:
          resolvedFields.length === 0
            ? "decorator"
            : sameOrigin && coversAll
              ? (resolvedFields[0].origin ?? "mixed")
              : "mixed",
        schema: { type: "object", properties },
      };
    }
  }

  const paramParses = parsed.filter(
    (item) => item.classed.bucket === "paramField",
  );
  let params;
  if (paramParses.length > 0) {
    const properties = {};
    const resolvedFields = [];
    for (const item of paramParses) {
      const resolved = materialize(item.parse, hooks);
      resolvedFields.push(resolved);
      properties[item.classed.param] = fieldSchema(resolved, false);
    }
    params = {
      name: "params",
      origin: originOf(resolvedFields),
      schema: { type: "object", properties, required: Object.keys(properties) },
    };
  }

  return {
    method: route.method,
    path: route.path,
    module: moduleIdForPath(route.path),
    auth: route.auth,
    role: route.role,
    status: route.status,
    comment: route.comment,
    stream: route.stream || undefined,
    body,
    query,
    params,
  };
}

function readDefault(def) {
  if (typeof def.defaultValue === "function") return def.defaultValue();
  return def.defaultValue;
}

function peel(schema) {
  const flags = {
    optional: false,
    nullable: false,
    defaultValue: undefined,
    refinements: [],
  };
  let current = schema;
  const seen = new WeakSet();
  while (current && current._def && !seen.has(current)) {
    seen.add(current);
    const def = current._def;
    switch (def.typeName) {
      case "ZodOptional":
      case "ZodCatch":
        flags.optional = true;
        current = def.innerType;
        break;
      case "ZodDefault":
        flags.optional = true;
        flags.defaultValue = readDefault(def);
        current = def.innerType;
        break;
      case "ZodNullable":
        flags.nullable = true;
        current = def.innerType;
        break;
      case "ZodEffects":
        if (def.effect?.type === "refinement")
          flags.refinements.push(def.effect);
        current = def.schema;
        break;
      case "ZodBranded":
      case "ZodReadonly":
      case "ZodPromise":
        current = def.innerType;
        break;
      case "ZodPipeline":
        current = def.out ?? def.in;
        break;
      default:
        return { flags, core: current };
    }
  }
  return { flags, core: current };
}

function applyFlags(json, flags) {
  if (flags.optional) json.optional = true;
  if (flags.nullable) json.nullable = true;
  if (flags.defaultValue !== undefined) json.default = flags.defaultValue;
  if (flags.refinements.length > 0) json.refined = true;
  return json;
}

function stringFormat(def) {
  const checks = def.checks ?? [];
  if (checks.some((check) => check.kind === "uuid")) return "uuid";
  if (checks.some((check) => check.kind === "email")) return "email";
  if (checks.some((check) => check.kind === "url")) return "uri";
  if (checks.some((check) => check.kind === "datetime")) return "date-time";
  return undefined;
}

export function zodToJson(schema, seen = new WeakSet()) {
  if (!schema || typeof schema !== "object" || !schema._def) {
    return { description: "unparsed" };
  }
  const { flags, core } = peel(schema);
  if (!core || typeof core !== "object" || !core._def) {
    return applyFlags({ description: "unparsed" }, flags);
  }
  if (seen.has(core)) return applyFlags({}, flags);
  seen.add(core);

  const def = core._def;
  try {
    const json = (() => {
      switch (def.typeName) {
        case "ZodString": {
          const out = { type: "string" };
          const format = stringFormat(def);
          if (format) out.format = format;
          for (const check of def.checks ?? []) {
            if (check.kind === "min") out.minLength = check.value;
            if (check.kind === "max") out.maxLength = check.value;
            if (check.kind === "length") {
              out.minLength = check.value;
              out.maxLength = check.value;
            }
            if (check.kind === "regex" && check.regex instanceof RegExp)
              out.pattern = check.regex.source;
          }
          return out;
        }
        case "ZodNumber": {
          const out = { type: "number" };
          if (def.coerce) out.coerced = true;
          for (const check of def.checks ?? []) {
            if (check.kind === "int") out.type = "integer";
            if (check.kind === "min") {
              out.minimum = check.value;
              if (check.inclusive === false) out.exclusiveMinimum = true;
            }
            if (check.kind === "max") {
              out.maximum = check.value;
              if (check.inclusive === false) out.exclusiveMaximum = true;
            }
          }
          return out;
        }
        case "ZodBoolean":
          return { type: "boolean" };
        case "ZodLiteral":
          return { const: def.value };
        case "ZodEnum": {
          const values = Array.isArray(def.values)
            ? [...def.values]
            : [...(def.values ?? [])];
          return { type: "string", enum: values };
        }
        case "ZodNativeEnum": {
          const values = Object.values(def.values).filter(
            (value) => typeof value === "string" || typeof value === "number",
          );
          return { enum: values };
        }
        case "ZodObject": {
          const shape =
            typeof def.shape === "function" ? def.shape() : def.shape;
          const properties = {};
          const required = [];
          for (const [key, value] of Object.entries(shape ?? {})) {
            const field = peel(value);
            properties[key] = zodToJson(value, seen);
            if (!field.flags.optional) required.push(key);
          }
          const out = { type: "object", properties };
          if (required.length > 0) out.required = required;
          if (def.unknownKeys === "strict") out.additionalProperties = false;
          if (def.unknownKeys === "passthrough")
            out.additionalProperties = true;
          return out;
        }
        case "ZodArray": {
          const out = { type: "array", items: zodToJson(def.type, seen) };
          if (typeof def.minLength?.value === "number")
            out.minItems = def.minLength.value;
          if (typeof def.maxLength?.value === "number")
            out.maxItems = def.maxLength.value;
          return out;
        }
        case "ZodTuple":
          return {
            type: "array",
            prefixItems: (def.items ?? []).map((item) => zodToJson(item, seen)),
          };
        case "ZodUnion":
        case "ZodDiscriminatedUnion": {
          const options = def.options
            ? Array.isArray(def.options)
              ? def.options
              : [...def.options.values()]
            : [];
          return { anyOf: options.map((option) => zodToJson(option, seen)) };
        }
        case "ZodRecord":
          return {
            type: "object",
            additionalProperties: zodToJson(def.valueType, seen),
          };
        case "ZodAny":
        case "ZodUnknown":
          return {};
        case "ZodNull":
          return { type: "null" };
        case "ZodUndefined":
        case "ZodVoid":
        case "ZodNever":
          return { not: {} };
        case "ZodDate":
          return { type: "string", format: "date-time" };
        case "ZodLazy":
          try {
            return zodToJson(def.getter(), seen);
          } catch {
            return {};
          }
        default:
          return { description: `zod:${def.typeName}` };
      }
    })();
    return applyFlags(json, flags);
  } finally {
    seen.delete(core);
  }
}

export function extractConstraintMessages(expr) {
  if (!expr) return [];
  const out = [];
  const re = /message:\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = re.exec(expr))) out.push(match[1]);
  return [...new Set(out)];
}

export function attachConstraints(json, expr) {
  const constraints = extractConstraintMessages(expr);
  if (!json) return json;
  if (constraints.length > 0) {
    json.constraints = constraints;
    delete json.refined;
  }
  return json;
}

function loadZod(repoRoot) {
  const requireFromDto = createRequire(
    path.join(repoRoot, "packages/dto/package.json"),
  );
  return requireFromDto("zod");
}

function compileExpr(expr, z, dtoExports) {
  if (!expr || !/^z\s*\./.test(expr)) return undefined;
  const names = Object.keys(dtoExports).filter((name) =>
    /^[A-Za-z_$][\w$]*$/.test(name),
  );
  try {
    return new Function("z", ...names, `"use strict"; return (${expr});`)(
      z,
      ...names.map((name) => dtoExports[name]),
    );
  } catch {
    return undefined;
  }
}

function loadDtoSchemaSources(repoRoot) {
  const map = new Map();
  const dir = path.join(repoRoot, "packages/dto/src");
  for (const file of listFiles(
    dir,
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  )) {
    const source = readFileSync(file, "utf8");
    for (const [name, expr] of extractLocalSchemas(source)) map.set(name, expr);
  }
  return map;
}

function loadServerSchemas(repoRoot, z, dtoExports) {
  const map = new Map();
  const serverSrc = path.join(repoRoot, "apps/server/src");
  const files = listFiles(
    serverSrc,
    (name) => name.endsWith(".schema.ts") || name.endsWith(".controller.ts"),
  );
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const [name, expr] of extractLocalSchemas(source)) {
      const compiled = compileExpr(expr, z, dtoExports);
      map.set(name, {
        name,
        origin: "local",
        expr,
        schema: compiled?._def
          ? attachConstraints(zodToJson(compiled), expr)
          : undefined,
      });
    }
  }
  return map;
}

function schemaRecord(name, origin, schema, expr) {
  const json = schema ? attachConstraints(zodToJson(schema), expr) : undefined;
  return { name, origin, schema: json, source: json ? undefined : expr };
}

function makeHooks(dtoSchemas, dtoSources, serverSchemas, z, dtoExports) {
  return {
    resolve(name) {
      const local = serverSchemas.get(name);
      if (local?.schema) return { name, origin: "local", schema: local.schema };
      if (local?.expr) return { name, origin: "local", source: local.expr };
      const dto = dtoSchemas.get(name);
      if (dto) return schemaRecord(name, "dto", dto, dtoSources.get(name));
      return { name, origin: "unknown" };
    },
    compileInline(expr) {
      const compiled = compileExpr(expr, z, dtoExports);
      if (compiled?._def) {
        return {
          name: "inline",
          origin: "local",
          schema: attachConstraints(zodToJson(compiled), expr),
        };
      }
      return { name: "inline", origin: "local", source: expr };
    },
  };
}

function compareEndpoints(a, b) {
  if (a.path !== b.path) return a.path.localeCompare(b.path);
  return a.method.localeCompare(b.method);
}

function compactJson(value) {
  return JSON.stringify(value, null, 2);
}

function renderSlot(label, slot) {
  if (!slot) return "";
  const lines = [`- **${label}** \`${slot.name}\` (${slot.origin})`];
  if (slot.schema) lines.push("```json", compactJson(slot.schema), "```");
  else if (slot.source) lines.push("```ts", slot.source, "```");
  return `${lines.join("\n")}\n`;
}

function renderEndpoint(ep) {
  const bits = [];
  if (ep.auth !== "none") bits.push(`auth=${ep.auth}`);
  if (ep.role) bits.push(`role>=${ep.role}`);
  if (ep.status.length > 0) bits.push(ep.status.join("/"));
  if (ep.stream) bits.push("sse");
  const lines = [`### ${ep.method} \`${ep.path}\``, ""];
  if (bits.length > 0) lines.push(bits.join(" · "));
  if (ep.comment) lines.push("", ep.comment);
  lines.push("");
  if (ep.params) lines.push(renderSlot("params", ep.params));
  if (ep.query) lines.push(renderSlot("query", ep.query));
  if (ep.body) lines.push(renderSlot("body", ep.body));
  return lines.join("\n");
}

const MODULE_LEGEND = [
  "auth: `none` 无令牌；`bearer` 带 access token；`optional` 有则带上；`ba` 只用内部令牌。",
  "`role>=` 是链内最低角色。未写状态码的成功响应是 200。`sse` 的响应体是事件流。",
  "",
].join("\n");

function renderModuleMarkdown(mod, endpoints, generatedAt) {
  const lines = [
    "<!-- Generated by scripts/generate-moment-skill-api.mjs. Do not edit. -->",
    "",
    `# ${mod.title}`,
    "",
    `Generated ${generatedAt}. ${endpoints.length} endpoints.`,
    "",
    MODULE_LEGEND,
  ];
  for (const ep of endpoints) lines.push(renderEndpoint(ep), "");
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

function renderIndexMarkdown(modules, generatedAt) {
  const lines = [
    "<!-- Generated by scripts/generate-moment-skill-api.mjs. Do not edit. -->",
    "",
    "# API 模块索引",
    "",
    `Generated ${generatedAt}.`,
    "",
    "按意图只读其中一个文件。不要一次打开多个模块，也不要读 `api.json`。",
    "",
    MODULE_LEGEND,
    "| 模块 | 文件 | 条数 |",
    "|---|---|---|",
  ];
  for (const mod of modules) {
    lines.push(
      `| ${mod.title} | [${mod.id}.md](./${mod.id}.md) | ${mod.count} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function clearGeneratedMarkdown(outDir) {
  if (!existsSync(outDir)) return;
  for (const name of readdirSync(outDir)) {
    if (name.endsWith(".md")) unlinkSync(path.join(outDir, name));
  }
}

function warnSkillDrift(repoRoot, moduleIds) {
  const skillPath = path.join(repoRoot, "skills/moment/SKILL.md");
  if (!existsSync(skillPath)) return;
  const skill = readFileSync(skillPath, "utf8");
  const missing = moduleIds.filter(
    (id) => !skill.includes(`references/${id}.md`),
  );
  if (missing.length > 0) {
    console.error(
      `SKILL.md is missing links: ${missing.map((id) => `references/${id}.md`).join(", ")}`,
    );
  }
}

export async function generateApi(opts = {}) {
  const repoRoot = opts.repoRoot ?? findRepoRoot();
  const outDir = opts.outDir ?? referencesDir;
  const dist = ensureDtoBuilt(repoRoot);
  const dtoExports = await import(pathToFileURL(dist).href);
  const z = loadZod(repoRoot);
  const dtoSchemas = new Map();
  for (const [name, value] of Object.entries(dtoExports)) {
    if (value && typeof value === "object" && value._def)
      dtoSchemas.set(name, value);
  }
  const dtoSources = loadDtoSchemaSources(repoRoot);
  const serverSchemas = loadServerSchemas(repoRoot, z, dtoExports);
  const hooks = makeHooks(dtoSchemas, dtoSources, serverSchemas, z, dtoExports);
  const endpoints = extractAllRaw(repoRoot)
    .map((route) => describeRoute(route, hooks))
    .sort(compareEndpoints);

  const generatedAt = new Date().toISOString();
  const byModule = new Map();
  for (const ep of endpoints) {
    if (!byModule.has(ep.module)) byModule.set(ep.module, []);
    byModule.get(ep.module).push(ep);
  }

  const moduleSummaries = [];
  for (const spec of API_MODULES) {
    const items = byModule.get(spec.id) ?? [];
    if (items.length === 0) continue;
    moduleSummaries.push({
      id: spec.id,
      title: spec.title,
      count: items.length,
    });
  }
  for (const [id, items] of byModule) {
    if (API_MODULES.some((spec) => spec.id === id)) continue;
    moduleSummaries.push({ id, title: id, count: items.length });
  }

  const catalog = { generatedAt, modules: moduleSummaries, endpoints };
  mkdirSync(outDir, { recursive: true });
  clearGeneratedMarkdown(outDir);
  const jsonPath = path.join(outDir, "api.json");
  writeFileSync(jsonPath, `${JSON.stringify(catalog, null, 2)}\n`);
  writeFileSync(
    path.join(outDir, "index.md"),
    renderIndexMarkdown(moduleSummaries, generatedAt),
  );
  const written = [jsonPath, path.join(outDir, "index.md")];
  for (const spec of moduleSummaries) {
    const mdPath = path.join(outDir, `${spec.id}.md`);
    writeFileSync(
      mdPath,
      renderModuleMarkdown(spec, byModule.get(spec.id) ?? [], generatedAt),
    );
    written.push(mdPath);
  }
  warnSkillDrift(
    repoRoot,
    moduleSummaries.map((mod) => mod.id),
  );
  return { catalog, jsonPath, written };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { catalog, written } = await generateApi();
  console.log(
    `Wrote ${catalog.endpoints.length} endpoints in ${catalog.modules.length} modules`,
  );
  for (const file of written) console.log(file);
}
