import type { Request, Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { asyncHandler } from "../../common/async-handler.js";
import { firstZodMessage } from "../../common/schemas.js";
import {
  listQuerySchema,
  upsertBodySchema,
} from "./exercises.schemas.js";
import { exercisesService } from "./exercises.service.js";

export const exercisesController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    const rows = await exercisesService.list(userId, parsed.data);
    res.status(200).json(rows);
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const parsed = upsertBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    const { exercise, created } = await exercisesService.create(
      userId,
      parsed.data,
    );
    res.status(created ? 201 : 200).json(exercise);
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const parsed = upsertBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    const exerciseId = req.params.id!;
    const body = await exercisesService.update(
      userId,
      exerciseId,
      parsed.data,
    );
    res.status(200).json(body);
  }),

  destroy: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const exerciseId = req.params.id!;
    await exercisesService.deleteIfOwned(userId, exerciseId);
    res.status(204).send();
  }),

  toggleFavourite: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const exerciseId = req.params.id!;
    const body = await exercisesService.toggleFavourite(userId, exerciseId);
    res.status(200).json(body);
  }),

  uploadImage: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const exerciseId = req.params.id!;
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "missing_image" });
      return;
    }
    const publicPath = `/uploads/exercise-images/${file.filename}`;
    const body = await exercisesService.uploadExerciseImage(
      userId,
      exerciseId,
      publicPath,
      file.path,
    );
    res.status(200).json(body);
  }),
};
