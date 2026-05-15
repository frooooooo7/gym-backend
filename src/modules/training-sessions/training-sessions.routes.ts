import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { trainingSessionsController } from "./training-sessions.controller.js";

export const trainingSessionsRouter = Router();

trainingSessionsRouter.post(
  "/training-sessions",
  requireAuth,
  trainingSessionsController.create,
);
trainingSessionsRouter.put(
  "/training-sessions/:id",
  requireAuth,
  trainingSessionsController.update,
);
trainingSessionsRouter.get(
  "/training-sessions/active",
  requireAuth,
  trainingSessionsController.active,
);
trainingSessionsRouter.get(
  "/training-sessions/history",
  requireAuth,
  trainingSessionsController.history,
);
