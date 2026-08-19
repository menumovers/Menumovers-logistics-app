import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pushSubscriptionsTable,
  ridersTable,
  usersTable,
  userRolesTable,
  type UserRole,
} from "@workspace/db";
import { logger } from "./logger";

let configured = false;

function configure(): boolean {
  if (configured) return true;
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  const subject = process.env["VAPID_SUBJECT"] ?? "mailto:ops@bestellenbij.local";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

async function deleteSubscription(id: string): Promise<void> {
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, id));
}

async function sendToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (userIds.length === 0) return;
  if (!configure()) {
    logger.debug({ userIds }, "VAPID not configured; skipping push");
    return;
  }
  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(inArray(pushSubscriptionsTable.userId, userIds));
  if (subs.length === 0) return;
  const json = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          json,
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await deleteSubscription(sub.id);
          return;
        }
        logger.warn({ err, endpoint: sub.endpoint }, "Push delivery failed");
      }
    }),
  );
}

export async function sendPushToRoles(
  roles: ReadonlyArray<UserRole>,
  payload: PushPayload,
): Promise<void> {
  if (roles.length === 0) return;
  const users = await db
    .selectDistinct({ id: usersTable.id })
    .from(usersTable)
    .innerJoin(userRolesTable, eq(userRolesTable.userId, usersTable.id))
    .where(inArray(userRolesTable.role, roles as UserRole[]));
  await sendToUsers(
    users.map((u) => u.id),
    payload,
  );
}

export async function sendPushToRider(
  riderId: string,
  payload: PushPayload,
): Promise<void> {
  const [rider] = await db
    .select({ userId: ridersTable.userId })
    .from(ridersTable)
    .where(eq(ridersTable.id, riderId));
  if (!rider) return;
  await sendToUsers([rider.userId], payload);
}

export async function sendPushToRestaurantStaff(
  restaurantId: string,
  payload: PushPayload,
): Promise<void> {
  const users = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.restaurantId, restaurantId));
  await sendToUsers(users.map((u) => u.id), payload);
}

export function isVapidConfigured(): boolean {
  return Boolean(
    process.env["VAPID_PUBLIC_KEY"] && process.env["VAPID_PRIVATE_KEY"],
  );
}
