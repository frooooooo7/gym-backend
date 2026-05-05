export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = "AppError";
  }
}

export const isAppError = (err: unknown): err is AppError =>
  err instanceof AppError;
