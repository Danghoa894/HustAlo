// server/src/http/middleware/validate.ts — validate({ body, query, params }) bằng Zod; lỗi → VALIDATION_ERROR
import type { RequestHandler } from 'express';
import type { z } from 'zod';

export interface ValidateSchemas {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
}

/** Dữ liệu đã parse (đã chuẩn hóa) gắn vào `res.locals.valid` để controller đọc có kiểu. ZodError → error-handler. */
export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req, res, next) => {
    try {
      res.locals.valid = {
        body: schemas.body ? (schemas.body.parse(req.body) as unknown) : undefined,
        query: schemas.query ? (schemas.query.parse(req.query) as unknown) : undefined,
        params: schemas.params ? (schemas.params.parse(req.params) as unknown) : undefined,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
