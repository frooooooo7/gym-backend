import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import {
  changePasswordLimiter,
  deleteAccountLimiter,
  loginLimiter,
  registerLimiter,
} from "../../middleware/rate-limit.js";
import { authController } from "./auth.controller.js";

export const authRouter = Router();

authRouter.post("/auth/register", registerLimiter, authController.register);
authRouter.post("/auth/login", loginLimiter, authController.login);
authRouter.get("/auth/me", requireAuth, authController.me);

authRouter.post(
  "/auth/change-password",
  requireAuth,
  changePasswordLimiter,
  authController.changePassword,
);
authRouter.post("/auth/logout-all", requireAuth, authController.logoutAll);
authRouter.delete(
  "/auth/me",
  requireAuth,
  deleteAccountLimiter,
  authController.deleteAccount,
);
// Same handler and the same limiter counter as DELETE /auth/me — for clients
// behind proxies that drop DELETE request bodies.
authRouter.post(
  "/auth/delete-account",
  requireAuth,
  deleteAccountLimiter,
  authController.deleteAccount,
);
