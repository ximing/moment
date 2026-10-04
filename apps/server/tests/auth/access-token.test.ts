import request from "supertest";
import { ACCESS_TOKEN_MAX_PER_USER } from "@moment/dto";
import { createApp } from "../../src/app.js";
import {
  isPersonalAccessToken,
  previewAccessToken,
} from "../../src/auth/access-token-logic.js";
import { closeDb, resetDb } from "../helpers/db.js";
import { listenLocal } from "../helpers/http-server.js";

const app = listenLocal(createApp());

const alice = {
  email: "alice-token@example.com",
  password: "secret123",
  nickname: "Alice",
};
const bob = {
  email: "bob-token@example.com",
  password: "secret123",
  nickname: "Bob",
};

beforeEach(resetDb);
afterAll(closeDb);

async function register(
  input: typeof alice,
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await request(app).post("/api/auth/register").send(input);
  expect(res.status).toBe(201);
  return res.body.tokens as { accessToken: string; refreshToken: string };
}

function auth(accessToken: string): { Authorization: string } {
  return { Authorization: `Bearer ${accessToken}` };
}

describe("接口令牌", () => {
  it("创建只返回一次明文；列表只有 preview；令牌可以访问 me", async () => {
    const { accessToken } = await register(alice);
    const created = await request(app)
      .post("/api/auth/tokens")
      .set(auth(accessToken))
      .send({ name: "  本地脚本  " });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe("本地脚本");
    expect(isPersonalAccessToken(created.body.token)).toBe(true);
    expect(created.body.preview).toBe(previewAccessToken(created.body.token));
    expect(created.body.tokenHash).toBeUndefined();

    const list = await request(app)
      .get("/api/auth/tokens")
      .set(auth(accessToken));
    expect(list.status).toBe(200);
    expect(list.body.tokens).toHaveLength(1);
    expect(list.body.tokens[0].id).toBe(created.body.id);
    expect(list.body.tokens[0].preview).toBe(created.body.preview);
    expect(list.body.tokens[0].token).toBeUndefined();

    const me = await request(app)
      .get("/api/auth/me")
      .set(auth(created.body.token));
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(alice.email);

    const chains = await request(app)
      .get("/api/chains")
      .set(auth(created.body.token));
    expect(chains.status).toBe(200);

    const stillJwt = await request(app)
      .get("/api/auth/me")
      .set(auth(accessToken));
    expect(stillJwt.status).toBe(200);
  });

  it("未知令牌 401；别人的令牌不能吊销；吊销后不能再访问", async () => {
    const aliceTokens = await register(alice);
    const bobTokens = await register(bob);
    const created = await request(app)
      .post("/api/auth/tokens")
      .set(auth(aliceTokens.accessToken))
      .send({ name: "脚本" });
    const token = created.body.token as string;
    const id = created.body.id as string;

    const unknown = await request(app)
      .get("/api/auth/me")
      .set(auth(`mmt_${"a".repeat(43)}`));
    expect(unknown.status).toBe(401);

    const foreign = await request(app)
      .delete(`/api/auth/tokens/${id}`)
      .set(auth(bobTokens.accessToken));
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe("ACCESS_TOKEN_NOT_FOUND");

    const still = await request(app).get("/api/auth/me").set(auth(token));
    expect(still.status).toBe(200);

    const gone = await request(app)
      .delete(`/api/auth/tokens/${id}`)
      .set(auth(aliceTokens.accessToken));
    expect(gone.status).toBe(204);
    const after = await request(app).get("/api/auth/me").set(auth(token));
    expect(after.status).toBe(401);

    const missing = await request(app)
      .delete(`/api/auth/tokens/${id}`)
      .set(auth(aliceTokens.accessToken));
    expect(missing.status).toBe(404);
  });

  it("空名称 400；超过上限 ACCESS_TOKEN_LIMIT", async () => {
    const { accessToken } = await register(alice);
    const blank = await request(app)
      .post("/api/auth/tokens")
      .set(auth(accessToken))
      .send({ name: "   " });
    expect(blank.status).toBe(400);
    expect(blank.body.error.code).toBe("VALIDATION_ERROR");

    const badId = await request(app)
      .delete("/api/auth/tokens/not-a-uuid")
      .set(auth(accessToken));
    expect(badId.status).toBe(400);
    expect(badId.body.error.code).toBe("VALIDATION_ERROR");

    for (let i = 0; i < ACCESS_TOKEN_MAX_PER_USER; i += 1) {
      const res = await request(app)
        .post("/api/auth/tokens")
        .set(auth(accessToken))
        .send({ name: `令牌 ${i}` });
      expect(res.status).toBe(201);
    }
    const limited = await request(app)
      .post("/api/auth/tokens")
      .set(auth(accessToken))
      .send({ name: "再一个" });
    expect(limited.status).toBe(400);
    expect(limited.body.error.code).toBe("ACCESS_TOKEN_LIMIT");
  });

  it("改密后旧接口令牌失效，并且从列表消失", async () => {
    const { accessToken } = await register(alice);
    const created = await request(app)
      .post("/api/auth/tokens")
      .set(auth(accessToken))
      .send({ name: "脚本" });
    const token = created.body.token as string;

    const changed = await request(app)
      .post("/api/auth/change-password")
      .set(auth(accessToken))
      .send({ oldPassword: alice.password, newPassword: "new-secret-123" });
    expect(changed.status).toBe(204);

    const me = await request(app).get("/api/auth/me").set(auth(token));
    expect(me.status).toBe(401);

    // JWT iat 只有秒。passwordChangedAt 落在同一秒并被进位时，新 access token 要等下一秒才晚于改密时间。
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: alice.email, password: "new-secret-123" });
    expect(login.status).toBe(200);
    const list = await request(app)
      .get("/api/auth/tokens")
      .set(auth(login.body.tokens.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.tokens).toEqual([]);
  });
});
