import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCESS_TOKEN_NAME_MAX,
  createAccessTokenInputSchema,
} from "./access-token.js";

test("createAccessTokenInputSchema 去掉名称两端空白，拒绝空名和超长名", () => {
  assert.equal(
    createAccessTokenInputSchema.parse({ name: "  本地脚本  " }).name,
    "本地脚本",
  );
  assert.throws(() => createAccessTokenInputSchema.parse({ name: "   " }));
  assert.throws(() => createAccessTokenInputSchema.parse({ name: "" }));
  assert.equal(
    createAccessTokenInputSchema.parse({
      name: "a".repeat(ACCESS_TOKEN_NAME_MAX),
    }).name.length,
    ACCESS_TOKEN_NAME_MAX,
  );
  assert.throws(() =>
    createAccessTokenInputSchema.parse({
      name: "a".repeat(ACCESS_TOKEN_NAME_MAX + 1),
    }),
  );
});
