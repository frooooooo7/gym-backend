import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validation.js";
import { notificationsController } from "./notifications.controller.js";
import {
  notificationParamsSchema,
  updateNotificationSettingsSchema,
} from "./notifications.schemas.js";

export const notificationsRouter = Router();

notificationsRouter.get(
  "/notifications",
  requireAuth,
  notificationsController.list,
);

notificationsRouter.get(
  "/notifications/unread-count",
  requireAuth,
  notificationsController.unreadCount,
);

notificationsRouter.get(
  "/notifications/settings",
  requireAuth,
  notificationsController.getSettings,
);

notificationsRouter.patch(
  "/notifications/settings",
  requireAuth,
  validateRequest({ body: updateNotificationSettingsSchema }),
  notificationsController.updateSettings,
);

notificationsRouter.post(
  "/notifications/read-all",
  requireAuth,
  notificationsController.markAllRead,
);

notificationsRouter.post(
  "/notifications/:id/read",
  requireAuth,
  validateRequest({ params: notificationParamsSchema }),
  notificationsController.markRead,
);

notificationsRouter.delete(
  "/notifications/:id",
  requireAuth,
  validateRequest({ params: notificationParamsSchema }),
  notificationsController.dismiss,
);
