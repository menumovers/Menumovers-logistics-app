import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { SubscribePushBody, UnsubscribePushBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { httpError } from "../lib/errors";

const router: IRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

router.get("/push/vapid-public-key", (_req, res): void => {
  const publicKey = process.env["VAPID_PUBLIC_KEY"] ?? null;
  const privateKey = process.env["VAPID_PRIVATE_KEY"] ?? null;
  const configured = Boolean(publicKey && privateKey);
  res.json({ publicKey: configured ? publicKey : null, configured });
});

router.post(
  "/push/subscribe",
  requireAuth,
  wrap(async (req, res) => {
    const auth = req.auth!;
    const parsed = SubscribePushBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);

    const [row] = await db
      .insert(pushSubscriptionsTable)
      .values({
        userId: auth.sub,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent: parsed.data.userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: {
          userId: auth.sub,
          p256dh: parsed.data.keys.p256dh,
          auth: parsed.data.keys.auth,
          userAgent: parsed.data.userAgent ?? null,
        },
      })
      .returning();
    if (!row) throw httpError(500, "DB_ERROR", "Failed to register subscription");
    res.status(201).json({ id: row.id });
  }),
);

router.post(
  "/push/unsubscribe",
  requireAuth,
  wrap(async (req, res) => {
    const auth = req.auth!;
    const parsed = UnsubscribePushBody.safeParse(req.body);
    if (!parsed.success) throw httpError(400, "VALIDATION_ERROR", parsed.error.message);
    await db
      .delete(pushSubscriptionsTable)
      .where(
        and(
          eq(pushSubscriptionsTable.userId, auth.sub),
          eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint),
        ),
      );
    res.sendStatus(204);
  }),
);

export default router;
