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
// Two-segment path, so it never matches DELETE /training-sessions/:id.
trainingSessionsRouter.delete(
  "/training-sessions/by-client-id/:clientId",
  requireAuth,
  trainingSessionsController.removeByClientId,
);
trainingSessionsRouter.delete(
  "/training-sessions/:id",
  requireAuth,
  trainingSessionsController.remove,
);
trainingSessionsRouter.patch(
  "/training-sessions/:id/shared-to-profile",
  requireAuth,
  trainingSessionsController.setSharedToProfile,
);
