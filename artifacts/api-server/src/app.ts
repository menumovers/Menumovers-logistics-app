import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

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
app.use(cors({ credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Centralized error handler. Task #2 expands this with structured error codes
// and per-error handling. We always log the underlying error with request
// context, but only surface the raw message in non-production environments to
// avoid leaking internals (stack traces, SQL fragments, etc.) to clients.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction): void => {
  req.log.error({ err }, "Unhandled route error");
  if (res.headersSent) return;
  const isProd = process.env["NODE_ENV"] === "production";
  const message =
    !isProd && err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
});

export default app;
