import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UnauthorizedError } from 'routing-controllers';
import { config } from '../config.js';

let override: string | undefined;

export function getBaAuthToken(): string {
  return override !== undefined ? override : config.BA_AUTH_TOKEN;
}

/** 测试注入。undefined = 回落 config。严禁业务代码使用。 */
export function setBaAuthTokenForTests(token: string | undefined): void {
  override = token;
}

function headerValue(authorization: string | string[] | undefined): string | undefined {
  if (Array.isArray(authorization)) return authorization[0];
  return authorization;
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function assertBaAuth(
  configuredToken: string,
  authorization: string | string[] | undefined,
): void {
  if (configuredToken === '') {
    throw new UnauthorizedError('BA_NOT_CONFIGURED');
  }
  const header = headerValue(authorization);
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('BA_AUTH_INVALID');
  }
  const presented = header.slice('Bearer '.length);
  if (!tokensEqual(configuredToken, presented)) {
    throw new UnauthorizedError('BA_AUTH_INVALID');
  }
}

export const baAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    assertBaAuth(getBaAuthToken(), req.headers.authorization);
    next();
  } catch (err) {
    next(err);
  }
};
