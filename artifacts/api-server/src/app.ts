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
// explicit origin instead of `*`. Allow a comma-separated allowlist via env;
// fall back to reflecting the request origin only in non-production.
const corsAllowlist = (process.env["CORS_ALLOWED_ORIGINS"] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    credentials: true,
    origin(origin, cb) {
      if (!origin) return cb(null, true); // same-origin / curl
      if (corsAllowlist.includes(origin)) return cb(null, true);
      if (process.env["NODE_ENV"] !== "production") return cb(null, true);
      return cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Per-endpoint rate limits before the main router.
app.use("/api/auth/login", authLimiter);
app.use("/api/inbound/orders", inboundLimiter);

app.use("/api", router);

app.use(errorHandler);

export default app;
