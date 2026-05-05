import {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from "express";
import { requireAuth } from "../../middleware/auth.js";
import { exercisesLimiter } from "../../middleware/rate-limit.js";
import { exercisesController } from "./exercises.controller.js";
import { exerciseImageUpload } from "./exercises.image-upload.js";

export const exercisesRouter = Router();

exercisesRouter.use(exercisesLimiter);

const handleExerciseImageUpload = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  exerciseImageUpload.single("image")(req, res, (err: unknown) => {
    if (err) {
      res.status(400).json({ error: "invalid_file" });
      return;
    }
    next();
  });
};

exercisesRouter.get("/exercises", requireAuth, exercisesController.list);
exercisesRouter.post("/exercises", requireAuth, exercisesController.create);
exercisesRouter.put(
  "/exercises/:id",
  requireAuth,
  exercisesController.update,
);
exercisesRouter.delete(
  "/exercises/:id",
  requireAuth,
  exercisesController.destroy,
);
exercisesRouter.post(
  "/exercises/:id/favourite",
  requireAuth,
  exercisesController.toggleFavourite,
);
exercisesRouter.post(
  "/exercises/:id/image",
  requireAuth,
  handleExerciseImageUpload,
  exercisesController.uploadImage,
);
