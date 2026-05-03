import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors";

function requestIdOf(req: Request): string | undefined {
  const id = (req as Request & { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;
  const requestId = requestIdOf(req);

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Invalid request body",
      code: "VALIDATION_ERROR",
      requestId,
      details: err.issues,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      requestId,
    });
    return;
  }

  const maybe = err as { statusCode?: number; code?: string; message?: string };
  if (typeof maybe.statusCode === "number" && maybe.statusCode >= 400 && maybe.statusCode < 500) {
    res.status(maybe.statusCode).json({
      error: maybe.message ?? "Bad request",
      code: maybe.code ?? "ERROR",
      requestId,
    });
    return;
  }

  const params = (req as Request & { params?: Record<string, unknown> }).params;
  const orderId =
    params && typeof params["id"] === "string" && req.path.includes("/orders/")
      ? (params["id"] as string)
      : undefined;
  req.log.error(
    { err, requestId, orderId, path: req.path, method: req.method },
    "Unhandled route error",
  );
  const isProd = process.env["NODE_ENV"] === "production";
  const message =
    !isProd && err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message, code: "INTERNAL", requestId });
}
