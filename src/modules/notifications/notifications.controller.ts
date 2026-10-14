import type { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import type { AuthRequest } from "../../middleware/auth.js";
import type { UpdateNotificationSettingsBody } from "./notifications.schemas.js";
import { notificationsService } from "./notifications.service.js";

const userIdOf = (req: Request): string => (req as AuthRequest).auth.sub;

export const notificationsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(await notificationsService.list(userIdOf(req)));
  }),

  unreadCount: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(await notificationsService.unreadCount(userIdOf(req)));
  }),

  markAllRead: asyncHandler(async (req: Request, res: Response) => {
    await notificationsService.markAllRead(userIdOf(req));
    res.status(204).end();
  }),

  markRead: asyncHandler(async (req: Request, res: Response) => {
    await notificationsService.markRead(userIdOf(req), req.params.id);
    res.status(204).end();
  }),

  dismiss: asyncHandler(async (req: Request, res: Response) => {
    await notificationsService.dismiss(userIdOf(req), req.params.id);
    res.status(204).end();
  }),

  getSettings: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(await notificationsService.getSettings(userIdOf(req)));
  }),

  updateSettings: asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as UpdateNotificationSettingsBody;
    res
      .status(200)
      .json(await notificationsService.updateSettings(userIdOf(req), body));
  }),
};
