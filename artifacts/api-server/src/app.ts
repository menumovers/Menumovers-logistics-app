import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler } from "./middlewares/error-handler";
import { authLimiter, inboundLimiter } from "./middlewares/rate-limit";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    customProps(req, _res) {
      const r = req as typeof req & {
        auth?: { sub?: string; role?: string };
        id?: unknown;
      };
      return {
        requestId: r.id != null ? String(r.id) : undefined,
        userId: r.auth?.sub,
        role: r.auth?.role,
      };
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS: when cookie auth is enabled (`credentials: true`), browsers require an
// explicit origin instead of `*`. Three tiers in priority order:
//   1. No origin header (same-origin GET/HEAD, curl) — always allowed.
//   2. Origin hostname matches the request's own Host/X-Forwarded-Host — always
//      allowed. This covers every domain the server is actually running on
//      (replit.app, custom domains, future re-points) without any config change.
//   3. Explicit comma-separated allowlist via CORS_ALLOWED_ORIGINS — for any
//      additional cross-origin callers (e.g. a separate dev frontend).
//   4. Non-production fallback: reflect all origins so local dev is frictionless.
const corsAllowlist = (process.env["CORS_ALLOWED_ORIGINS"] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors((req, cb) => {
    const origin = req.headers.origin;
    if (!origin) return cb(null, { origin: true, credentials: true }); // no origin / curl
    if (corsAllowlist.includes(origin)) return cb(null, { origin: true, credentials: true });

    // Allow same-host: compare origin hostname against Host or X-Forwarded-Host.
    // Browsers send Origin on cross-origin AND same-origin POST requests, so we
    // cannot simply treat a present Origin as cross-origin.
    const hostHeader = (
      req.headers["x-forwarded-host"] ?? req.headers["host"] ?? ""
    )
      .toString()
      .split(",")[0]
      .trim();
    try {
      if (new URL(origin).host === hostHeader) {
        return cb(null, { origin: true, credentials: true });
      }
    } catch {
      // malformed origin — fall through to the production gate below
    }

    if (process.env["NODE_ENV"] !== "production") {
      return cb(null, { origin: true, credentials: true });
    }
    return cb(new Error(`Origin ${origin} not allowed by CORS`));
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Per-endpoint rate limits before the main router.
app.use("/api/auth", authLimiter);
app.use("/api/inbound/orders", inboundLimiter);

app.use("/api", router);

app.use(errorHandler);

export default app;
