import type { Request, Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { asyncHandler } from "../../common/async-handler.js";
import { firstZodMessage } from "../../common/schemas.js";
import { authService } from "./auth.service.js";
import {
  changePasswordSchema,
  deleteAccountSchema,
  loginSchema,
  registerSchema,
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

  changePassword: asyncHandler(async (req: Request, res: Response) => {
    const parsed = changePasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const { sub } = (req as AuthRequest).auth;
    const body = await authService.changePassword(sub, parsed.data);
    res.status(200).json(body);
  }),

  logoutAll: asyncHandler(async (req: Request, res: Response) => {
    const { sub } = (req as AuthRequest).auth;
    const body = await authService.logoutAll(sub);
    res.status(200).json(body);
  }),

  deleteAccount: asyncHandler(async (req: Request, res: Response) => {
    const parsed = deleteAccountSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const { sub } = (req as AuthRequest).auth;
    await authService.deleteAccount(sub, parsed.data);
    res.status(204).end();
  }),
};
