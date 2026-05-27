import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validation.js";
import { profileController } from "./profile.controller.js";
import { avatarImageUpload } from "./profile.avatar-upload.js";
import {
  profileActivitiesQuerySchema,
  profileListQuerySchema,
  profileUpdateSchema,
  userIdParamsSchema,
  userSearchQuerySchema,
} from "./profile.schemas.js";
import type { NextFunction, Request, Response } from "express";

export const profileRouter = Router();

const handleAvatarUpload = (req: Request, res: Response, next: NextFunction) => {
  avatarImageUpload.single("avatar")(req, res, (err: unknown) => {
    if (err) {
      res.status(400).json({ error: "invalid_file" });
      return;
    }
    next();
  });
};

profileRouter.get("/profile/me", requireAuth, profileController.getMe);

profileRouter.patch(
  "/profile/me",
  requireAuth,
  validateRequest({ body: profileUpdateSchema }),
  profileController.updateMe,
);

profileRouter.post(
  "/profile/me/avatar",
  requireAuth,
  handleAvatarUpload,
  profileController.uploadAvatar,
);

profileRouter.get(
  "/profile/following",
  requireAuth,
  validateRequest({ query: profileListQuerySchema }),
  profileController.getFollowing,
);

profileRouter.get(
  "/profile/followers",
  requireAuth,
  validateRequest({ query: profileListQuerySchema }),
  profileController.getFollowers,
);

profileRouter.get(
  "/profile/activities",
  requireAuth,
  validateRequest({ query: profileActivitiesQuerySchema }),
  profileController.getActivities,
);

profileRouter.get(
  "/users/search",
  requireAuth,
  validateRequest({ query: userSearchQuerySchema }),
  profileController.searchUsers,
);

profileRouter.get(
  "/users/:userId/activities",
  requireAuth,
  validateRequest({
    params: userIdParamsSchema,
    query: profileActivitiesQuerySchema,
  }),
  profileController.getUserActivities,
);

profileRouter.get(
  "/users/:userId/profile",
  requireAuth,
  validateRequest({ params: userIdParamsSchema }),
  profileController.getUserProfile,
);

