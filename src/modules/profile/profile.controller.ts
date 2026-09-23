import type { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { AVATARS_PUBLIC_PREFIX } from "./profile.avatar-upload.js";
import type { ProfileUpdateInput } from "./profile.schemas.js";
import { profileService } from "./profile.service.js";

export const profileController = {
  getMe: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const profile = await profileService.getOwnProfile(userId);
    res.status(200).json(profile);
  }),

  updateMe: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const body = req.body as ProfileUpdateInput;
    const profile = await profileService.updateProfile(userId, body);
    res.status(200).json(profile);
  }),

  completeOnboarding: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const profile = await profileService.completeOnboarding(userId);
    res.status(200).json(profile);
  }),

  uploadAvatar: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "missing_image" });
      return;
    }
    const publicPath = `${AVATARS_PUBLIC_PREFIX}${file.filename}`;
    const profile = await profileService.uploadAvatar(
      userId,
      publicPath,
      file.path,
    );
    res.status(200).json(profile);
  }),

  deleteAvatar: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const profile = await profileService.deleteAvatar(userId);
    res.status(200).json(profile);
  }),

  getUserProfile: asyncHandler(async (req: Request, res: Response) => {
    const viewerId = (req as AuthRequest).auth.sub;
    const profile = await profileService.getUserProfile(
      viewerId,
      req.params.userId,
    );
    res.status(200).json(profile);
  }),

  follow: asyncHandler(async (req: Request, res: Response) => {
    const viewerId = (req as AuthRequest).auth.sub;
    const body = await profileService.follow(viewerId, req.params.userId);
    res.status(200).json(body);
  }),

  unfollow: asyncHandler(async (req: Request, res: Response) => {
    const viewerId = (req as AuthRequest).auth.sub;
    const body = await profileService.unfollow(viewerId, req.params.userId);
    res.status(200).json(body);
  }),

  getFollowing: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const query = req.query as any;
    const items = await profileService.getFollowing(
      userId,
      query.limit,
      query.offset,
    );
    res.status(200).json(items);
  }),

  getFollowers: asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).auth.sub;
    const query = req.query as any;
    const items = await profileService.getFollowers(
      userId,
      query.limit,
      query.offset,
    );
    res.status(200).json(items);
  }),

  getUserFollowing: asyncHandler(async (req: Request, res: Response) => {
    const viewerId = (req as AuthRequest).auth.sub;
    const query = req.query as any;
    const items = await profileService.getUserFollowing(
      viewerId,
      req.params.userId,
      query.limit,
      query.offset,
    );
    res.status(200).json(items);
  }),

  getUserFollowers: asyncHandler(async (req: Request, res: Response) => {
    const viewerId = (req as AuthRequest).auth.sub;
    const query = req.query as any;
    const items = await profileService.getUserFollowers(
      viewerId,
      req.params.userId,
      query.limit,
      query.offset,
    );
    res.status(200).json(items);
  }),

  searchUsers: asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as any;
    const viewerId = (req as AuthRequest).auth.sub;
    const items = await profileService.searchUsers(
      viewerId,
      query.q,
      query.limit,
    );
    res.status(200).json(items);
  }),
};
