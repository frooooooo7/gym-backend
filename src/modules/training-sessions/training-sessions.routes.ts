import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { trainingSessionsController } from "./training-sessions.controller.js";

export const trainingSessionsRouter = Router();

trainingSessionsRouter.get(
  "/api/v1/training-sessions",
  requireAuth,
  trainingSessionsController.list,
);
trainingSessionsRouter.get(
  "/api/v1/training-sessions/:sessionId",
  requireAuth,
  trainingSessionsController.detail,
);

