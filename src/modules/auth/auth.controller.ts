import type { Request, Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { asyncHandler } from "../../common/async-handler.js";
import { authService } from "./auth.service.js";
import {
  loginSchema,
  registerSchema,
  firstZodMessage,
} from "./auth.schemas.js";

export const authController = {
  register: asyncHandler(async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const body = await authService.register(parsed.data);
    res.status(201).json(body);
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const body = await authService.login(parsed.data);
    res.status(200).json(body);
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    const { sub } = (req as AuthRequest).auth;
    const user = await authService.getMe(sub);
    res.status(200).json(user);
  }),
};
