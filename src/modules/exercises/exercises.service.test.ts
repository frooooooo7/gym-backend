import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExercisesService } from "./exercises.service.js";

const repo = {
  list: vi.fn(),
  insertUserExercise: vi.fn(),
  update: vi.fn(),
  deleteIfOwned: vi.fn(),
  exerciseVisibleToUser: vi.fn(),
  getOwnedExerciseImageMeta: vi.fn(),
  updateExerciseImageUrl: vi.fn(),
  insertFavouriteIfAbsent: vi.fn(),
  deleteFavourite: vi.fn(),
  hasFavourite: vi.fn(),
};

describe("createExercisesService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toggleFavourite deletes when insert reports no new row", async () => {
    repo.exerciseVisibleToUser.mockResolvedValue(true);
    repo.insertFavouriteIfAbsent.mockResolvedValue(0);
    repo.deleteFavourite.mockResolvedValue(undefined);

    const svc = createExercisesService(repo);
    const uid = "u1";
    const eid = "e1";

    const result = await svc.toggleFavourite(uid, eid);

    expect(result).toEqual({ exerciseId: eid, isFavourite: false });
    expect(repo.deleteFavourite).toHaveBeenCalledWith(uid, eid);
  });

  it("toggleFavourite returns isFavourite=true when insert adds a row", async () => {
    repo.exerciseVisibleToUser.mockResolvedValue(true);
    repo.insertFavouriteIfAbsent.mockResolvedValue(1);

    const svc = createExercisesService(repo);
    const eid = "e2";

    const result = await svc.toggleFavourite("u2", eid);

    expect(result).toStrictEqual({
      exerciseId: eid,
      isFavourite: true,
    });
    expect(repo.deleteFavourite).not.toHaveBeenCalled();
  });

  it("toggleFavourite throws exercise_not_found when exercise is missing", async () => {
    repo.exerciseVisibleToUser.mockResolvedValue(false);
    const svc = createExercisesService(repo);

    await expect(svc.toggleFavourite("u1", "missing")).rejects.toMatchObject({
      statusCode: 404,
      code: "exercise_not_found",
    });
  });

  it("deleteIfOwned throws not_found_or_not_yours when delete fails", async () => {
    repo.deleteIfOwned.mockResolvedValue(false);
    const svc = createExercisesService(repo);

    await expect(svc.deleteIfOwned("u1", "missing")).rejects.toMatchObject({
      statusCode: 404,
      code: "not_found_or_not_yours",
    });
  });
});
