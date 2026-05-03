import app from "./app";
import { logger } from "./lib/logger";
import { startRetryLoop } from "./lib/webhook";
import { startJanitor } from "./lib/janitor";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Background loop polling webhook_retry_queue every 10s.
  startRetryLoop();
  // Background cleanup loop (revoked tokens, etc.) every 5 minutes.
  startJanitor();
});
