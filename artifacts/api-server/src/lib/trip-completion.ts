import { and, eq, isNull } from "drizzle-orm";
import { db, ordersTable, tripsTable } from "@workspace/db";

/**
 * A trip is done once every order still on it — or there are none left —
 * has reached a terminal status (delivered/failed). Call this after any
 * change that could be the last one: an order's status landing on
 * delivered/failed, or an order being removed from the trip. Idempotent
 * and safe to call speculatively — a trip that's already
 * completed/dissolved, or that still has outstanding orders, is left alone.
 *
 * `orders.every(...)` is vacuously true on an empty array, so a trip
 * emptied out by removals completes the same way one finished by delivery
 * does — there is nothing distinguishing "done" from "nothing left to do"
 * from a coordinator's point of view.
 */
export async function completeTripIfDone(tripId: string): Promise<void> {
  const [trip] = await db.select({ status: tripsTable.status }).from(tripsTable).where(eq(tripsTable.id, tripId));
  if (!trip || trip.status === "completed" || trip.status === "dissolved") return;

  const orders = await db
    .select({ status: ordersTable.status })
    .from(ordersTable)
    .where(and(eq(ordersTable.tripId, tripId), isNull(ordersTable.archivedAt)));
  const allDone = orders.every((o) => o.status === "delivered" || o.status === "failed");
  if (!allDone) return;

  await db
    .update(tripsTable)
    .set({ status: "completed" })
    .where(and(eq(tripsTable.id, tripId), eq(tripsTable.status, trip.status)));
}
