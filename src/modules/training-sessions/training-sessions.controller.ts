import type { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import { firstZodMessage, uuidParamsSchema } from "../../common/schemas.js";
import type { AuthRequest } from "../../middleware/auth.js";
import {
  decodeHistoryCursor,
  sessionClientIdParamsSchema,
  sessionIdParamsSchema,
  sharedToProfileBodySchema,
  trainingSessionBodySchema,
  trainingSessionHistoryQuerySchema,
} from "./training-sessions.schemas.js";
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
    const parsed = trainingSessionHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    const page = await trainingSessionsService.history(userId, {
      limit: parsed.data.limit,
      updatedSince: parsed.data.updatedSince,
      cursor: decodeHistoryCursor(parsed.data.cursor),
    });
    res.status(200).json(page);
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const parsedParams = sessionIdParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      res
        .status(400)
        .json({ error: firstZodMessage(parsedParams.error.issues) });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    await trainingSessionsService.remove(userId, parsedParams.data.id);
    res.status(204).end();
  }),

  removeByClientId: asyncHandler(async (req: Request, res: Response) => {
    const parsedParams = sessionClientIdParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      res
        .status(400)
        .json({ error: firstZodMessage(parsedParams.error.issues) });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    await trainingSessionsService.removeByClientId(
      userId,
      parsedParams.data.clientId,
    );
    res.status(204).end();
  }),

  setSharedToProfile: asyncHandler(async (req: Request, res: Response) => {
    const parsedParams = uuidParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      res
        .status(400)
        .json({ error: firstZodMessage(parsedParams.error.issues) });
      return;
    }
    const parsed = sharedToProfileBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodMessage(parsed.error.issues) });
      return;
    }
    const userId = (req as AuthRequest).auth.sub;
    const session = await trainingSessionsService.setSharedToProfile(
      userId,
      parsedParams.data.id,
      parsed.data.sharedToProfile,
    );
    res.status(200).json(session);
  }),
};
