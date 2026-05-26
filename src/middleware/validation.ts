import type { Request, Response, NextFunction } from "express";
import type { AnyZodObject } from "zod";
import { firstZodMessage } from "../common/schemas.js";

export const validateRequest = (schemas: {
  params?: AnyZodObject;
  query?: AnyZodObject;
  body?: AnyZodObject;
}) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (schemas.params) {
      const parsed = schemas.params.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
        return;
      }
      req.params = parsed.data;
    }
    if (schemas.query) {
      const parsed = schemas.query.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
        return;
      }
      req.query = parsed.data as any;
    }
    if (schemas.body) {
      const parsed = schemas.body.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
        return;
      }
      req.body = parsed.data;
    }
    next();
  };
};
