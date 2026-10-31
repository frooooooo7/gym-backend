import { Router } from "express";
import { singleImageUpload } from "../../common/image-upload.js";
import { requireAuth } from "../../middleware/auth.js";
import { planCopyLimiter, writeLimiter } from "../../middleware/rate-limit.js";
import { validateRequest } from "../../middleware/validation.js";
import { postParamsSchema, userPostsParamsSchema } from "../feed/feed.schemas.js";
import { trainingPlansController } from "./training-plans.controller.js";

export const trainingPlansRouter = Router();

trainingPlansRouter.get(
  "/training-plans",
  requireAuth,
  trainingPlansController.list,
);
trainingPlansRouter.post(
  "/training-plans",
  requireAuth,
  writeLimiter,
  trainingPlansController.create,
);
trainingPlansRouter.put(
  "/training-plans/:id",
  requireAuth,
  writeLimiter,
  trainingPlansController.update,
);
trainingPlansRouter.delete(
  "/training-plans/:id",
  requireAuth,
  writeLimiter,
  trainingPlansController.destroy,
);
trainingPlansRouter.post(
  "/training-plans/:id/cover",
  requireAuth,
  writeLimiter,
  singleImageUpload("photo"),
  trainingPlansController.uploadCover,
);
trainingPlansRouter.delete(
  "/training-plans/:id/cover",
  requireAuth,
  writeLimiter,
  trainingPlansController.deleteCover,
);
trainingPlansRouter.post(
  "/training-plans/:id/copy",
  requireAuth,
  planCopyLimiter,
  trainingPlansController.copy,
);
trainingPlansRouter.get(
  "/users/:userId/plans",
  requireAuth,
  validateRequest({ params: userPostsParamsSchema }),
  trainingPlansController.listPublic,
);
trainingPlansRouter.post(
  "/posts/:sessionId/copy-plan",
  requireAuth,
  planCopyLimiter,
  validateRequest({ params: postParamsSchema }),
  trainingPlansController.copyFromPost,
);
