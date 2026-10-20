import { Router } from "express";
import { singleImageUpload } from "../../common/image-upload.js";
import { uuidParamsSchema } from "../../common/schemas.js";
import { requireAuth } from "../../middleware/auth.js";
import { exercisesLimiter } from "../../middleware/rate-limit.js";
import { validateRequest } from "../../middleware/validation.js";
import { exercisesController } from "./exercises.controller.js";

export const exercisesRouter = Router();

// Scoped to /exercises: routers are mounted without a path prefix, so a bare
// `use(limiter)` would count every request that merely passes through here.
exercisesRouter.use("/exercises", exercisesLimiter);

// `:id` is checked before anything else touches it — a non-UUID used to reach
// Postgres (500) and, for uploads, only after the file had been stored.
const validId = validateRequest({ params: uuidParamsSchema });

exercisesRouter.get("/exercises", requireAuth, exercisesController.list);
exercisesRouter.post("/exercises", requireAuth, exercisesController.create);
exercisesRouter.put(
  "/exercises/:id",
  requireAuth,
  validId,
  exercisesController.update,
);
exercisesRouter.delete(
  "/exercises/:id",
  requireAuth,
  validId,
  exercisesController.destroy,
);
exercisesRouter.post(
  "/exercises/:id/favourite",
  requireAuth,
  validId,
  exercisesController.toggleFavourite,
);
exercisesRouter.post(
  "/exercises/:id/image",
  requireAuth,
  validId,
  singleImageUpload("image"),
  exercisesController.uploadImage,
);
