import type { NextFunction, Request, Response } from 'express';
import { HttpError, Middleware } from 'routing-controllers';
import type { ExpressErrorMiddlewareInterface } from 'routing-controllers';
import { Service } from 'typedi';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

@Middleware({ type: 'after' })
@Service()
export class ErrorHandlerMiddleware implements ExpressErrorMiddlewareInterface {
  error(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
    // instanceof + name 双保险：dto 包与 server 的 zod 若发生版本漂移，instanceof 会失效
    if (error instanceof ZodError || (error as Error)?.name === 'ZodError') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: '请求参数不合法', details: (error as ZodError).issues },
      });
      return;
    }
    if (error instanceof HttpError) {
      // 约定：业务代码抛 HttpError 系错误时，message 承载 UPPER_SNAKE 机器码；
      // 框架自带错误（如 AuthorizationRequiredError）message 是自然语言，退回用 name 做 code。
      const isMachineCode = /^[A-Z0-9_]+$/.test(error.message);
      // ManifestInvalidError 等自定义错误可携带 details（spec §3.1：TEMPLATE_MANIFEST_INVALID 附 ajv 错误路径）
      const details = (error as { details?: unknown }).details;
      res.status(error.httpCode).json({
        error: {
          code: isMachineCode ? error.message : error.name,
          message: error.message,
          ...(details !== undefined ? { details } : {}),
        },
      });
      return;
    }
    logger.error('unhandled error', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
  }
}
