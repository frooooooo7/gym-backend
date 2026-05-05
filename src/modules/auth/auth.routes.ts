import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { loginLimiter, registerLimiter } from "../../middleware/rate-limit.js";
import { authController } from "./auth.controller.js";

export const authRouter = Router();

authRouter.post("/auth/register", registerLimiter, authController.register);
authRouter.post("/auth/login", loginLimiter, authController.login);
authRouter.get("/auth/me", requireAuth, authController.me);
