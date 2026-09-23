import {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from "express";
import { requireAuth } from "../../middleware/auth.js";
import { followLimiter } from "../../middleware/rate-limit.js";
import { validateRequest } from "../../middleware/validation.js";
import { avatarUpload } from "./profile.avatar-upload.js";
import { profileController } from "./profile.controller.js";
import {
  profileListQuerySchema,
  profileUpdateSchema,
  userIdParamsSchema,
  userSearchQuerySchema,
} from "./profile.schemas.js";

export const profileRouter = Router();

const handleAvatarUpload = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  avatarUpload.single("avatar")(req, res, (err: unknown) => {
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
  "/profile/me/onboarding/complete",
  requireAuth,
  profileController.completeOnboarding,
);

profileRouter.post(
  "/profile/me/avatar",
  requireAuth,
  handleAvatarUpload,
  profileController.uploadAvatar,
);

profileRouter.delete(
  "/profile/me/avatar",
  requireAuth,
  profileController.deleteAvatar,
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
  "/users/search",
  requireAuth,
  validateRequest({ query: userSearchQuerySchema }),
  profileController.searchUsers,
);

profileRouter.get(
  "/users/:userId/profile",
  requireAuth,
  validateRequest({ params: userIdParamsSchema }),
  profileController.getUserProfile,
);

profileRouter.get(
  "/users/:userId/following",
  requireAuth,
  validateRequest({ params: userIdParamsSchema, query: profileListQuerySchema }),
  profileController.getUserFollowing,
);

profileRouter.get(
  "/users/:userId/followers",
  requireAuth,
  validateRequest({ params: userIdParamsSchema, query: profileListQuerySchema }),
  profileController.getUserFollowers,
);

profileRouter.post(
  "/users/:userId/follow",
  requireAuth,
  followLimiter,
  validateRequest({ params: userIdParamsSchema }),
  profileController.follow,
);

profileRouter.delete(
  "/users/:userId/follow",
  requireAuth,
  followLimiter,
  validateRequest({ params: userIdParamsSchema }),
  profileController.unfollow,
);
