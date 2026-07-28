import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";
import { firstZodMessage } from "../common/schemas.js";

export const validateRequest = (schemas: {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
}) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (schemas.params) {
      const parsed = schemas.params.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
        return;
      }
      req.params = parsed.data as Request["params"];
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
