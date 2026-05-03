import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  if (err instanceof ZodError) {
    const e = err as ZodError;
    res.status(400).json({
      error: "Invalid request body",
      code: "VALIDATION_ERROR",
      details: e.issues,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  // Generic Error with statusCode set (e.g. from state-machine helpers).
  const maybe = err as { statusCode?: number; code?: string; message?: string };
  if (typeof maybe.statusCode === "number" && maybe.statusCode >= 400 && maybe.statusCode < 500) {
    res.status(maybe.statusCode).json({
      error: maybe.message ?? "Bad request",
      code: maybe.code ?? "ERROR",
    });
    return;
  }

  req.log.error({ err }, "Unhandled route error");
  const isProd = process.env["NODE_ENV"] === "production";
  const message =
    !isProd && err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message, code: "INTERNAL" });
}
