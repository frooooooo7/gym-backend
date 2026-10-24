import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { singleImageUpload } from "../../common/image-upload.js";
import { writeLimiter } from "../../middleware/rate-limit.js";
import { trainingSessionsController } from "./training-sessions.controller.js";

export const trainingSessionsRouter = Router();

trainingSessionsRouter.post(
  "/training-sessions",
  requireAuth,
  writeLimiter,
  trainingSessionsController.create,
);
trainingSessionsRouter.put(
  "/training-sessions/:id",
  requireAuth,
  writeLimiter,
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
  writeLimiter,
  trainingSessionsController.removeByClientId,
);
trainingSessionsRouter.delete(
  "/training-sessions/:id",
  requireAuth,
  writeLimiter,
  trainingSessionsController.remove,
);
trainingSessionsRouter.patch(
  "/training-sessions/:id/shared-to-profile",
  requireAuth,
  writeLimiter,
  trainingSessionsController.setSharedToProfile,
);
trainingSessionsRouter.post(
  "/training-sessions/:id/post-photo",
  requireAuth,
  writeLimiter,
  singleImageUpload("photo"),
  trainingSessionsController.uploadPostPhoto,
);
trainingSessionsRouter.delete(
  "/training-sessions/:id/post-photo",
  requireAuth,
  writeLimiter,
  trainingSessionsController.deletePostPhoto,
);
