import { randomUUID } from "node:crypto";
import {
  ACCESS_TOKEN_MAX_PER_USER,
  type AccessTokenList,
  type CreateAccessTokenInput,
  type CreatedAccessToken,
} from "@moment/dto";
import { and, count, desc, eq } from "drizzle-orm";
import { HttpError, NotFoundError } from "routing-controllers";
import { Service } from "typedi";
import { z } from "zod";
import { db } from "../db/index.js";
import { accessTokens } from "../db/schema.js";
import {
  generateAccessToken,
  hashAccessToken,
  previewAccessToken,
} from "./access-token-logic.js";

@Service()
export class AccessTokenService {
  async list(userId: string): Promise<AccessTokenList> {
    const rows = await db
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.userId, userId))
      .orderBy(desc(accessTokens.createdAt));
    return {
      tokens: rows.map((row) => ({
        id: row.id,
        name: row.name,
        preview: row.tokenPreview,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async create(
    userId: string,
    input: CreateAccessTokenInput,
  ): Promise<CreatedAccessToken> {
    const [existing] = await db
      .select({ n: count() })
      .from(accessTokens)
      .where(eq(accessTokens.userId, userId));
    if (Number(existing?.n ?? 0) >= ACCESS_TOKEN_MAX_PER_USER) {
      throw new HttpError(400, "ACCESS_TOKEN_LIMIT");
    }

    const token = generateAccessToken();
    const createdAt = new Date();
    const id = randomUUID();
    await db.insert(accessTokens).values({
      id,
      userId,
      name: input.name,
      tokenHash: hashAccessToken(token),
      tokenPreview: previewAccessToken(token),
      createdAt,
    });
    return {
      id,
      name: input.name,
      preview: previewAccessToken(token),
      createdAt: createdAt.toISOString(),
      token,
    };
  }

  async revoke(userId: string, id: string): Promise<void> {
    z.string().uuid().parse(id);
    const deleted = await db
      .delete(accessTokens)
      .where(and(eq(accessTokens.id, id), eq(accessTokens.userId, userId)));
    if (deleted[0].affectedRows === 0)
      throw new NotFoundError("ACCESS_TOKEN_NOT_FOUND");
  }

  async revokeAll(userId: string): Promise<void> {
    await db.delete(accessTokens).where(eq(accessTokens.userId, userId));
  }

  /** 鉴权用：只按哈希查，找不到返回 null。 */
  async findByRawToken(
    raw: string,
  ): Promise<{ userId: string; createdAt: Date } | null> {
    const [row] = await db
      .select({
        userId: accessTokens.userId,
        createdAt: accessTokens.createdAt,
      })
      .from(accessTokens)
      .where(eq(accessTokens.tokenHash, hashAccessToken(raw)))
      .limit(1);
    return row ?? null;
  }
}
