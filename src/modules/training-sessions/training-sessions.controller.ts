import type { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import { firstZodMessage, uuidParamsSchema } from "../../common/schemas.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { trainingSessionBodySchema } from "./training-sessions.schemas.js";
import { trainingSessionsService } from "./training-sessions.service.js";

export const trainingSessionsController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const parsed = trainingSessionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    const { session, created } = await trainingSessionsService.upsert(
      userId,
      parsed.data,
    );
    res.status(created ? 201 : 200).json(session);
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const parsedParams = uuidParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      res
        .status(400)
        .json({ error: firstZodMessage(parsedParams.error.issues) });
      return;
    }
    const parsed = trainingSessionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    const session = await trainingSessionsService.update(
      userId,
      parsedParams.data.id,
      parsed.data,
    );
    res.status(200).json(session);
  }),

  active: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const session = await trainingSessionsService.active(userId);
    res.status(200).json(session);
  }),

  history: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const sessions = await trainingSessionsService.history(userId);
    res.status(200).json(sessions);
  }),
};
