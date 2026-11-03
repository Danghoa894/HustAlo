// server/src/http/middleware/validate.ts — validate({ body, query, params }) bằng Zod; lỗi → VALIDATION_ERROR
import type { RequestHandler } from 'express';
import type { z } from 'zod';

export interface ValidateSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

/** Dữ liệu đã parse (đã chuẩn hóa) gắn vào `res.locals.valid` để controller đọc có kiểu. ZodError → error-handler. */
export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req, res, next) => {
    try {
      res.locals.valid = {
        body: schemas.body ? schemas.body.parse(req.body) : undefined,
        query: schemas.query ? schemas.query.parse(req.query) : undefined,
        params: schemas.params ? schemas.params.parse(req.params) : undefined,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
