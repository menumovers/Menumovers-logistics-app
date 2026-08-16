import { sql, type SQL } from "drizzle-orm";
import { ordersTable } from "@workspace/db";

/**
 * How the customer receives the order, as sent by the source.
 *
 *   - `delivery`    — a rider brings it. The default case.
 *   - `happy_hour`  — also delivered, but the customer took a cheaper delivery
 *                     fee in exchange for less control over timing. Purely an
 *                     expectation signal here: it tells staff whether someone is
 *                     waiting on a specific time or has accepted flexibility.
 *   - `pickup`      — the customer collects it themselves. **Never rider work.**
 *
 * `deliveryMethod` is stored as text rather than a Postgres enum on purpose:
 * it is an inbound field we don't control, and a new upstream value should be
 * rejected at the API boundary with a clear 400 from the Zod layer rather than
 * failing an insert deep in ingestion.
 *
 * See docs/workflow-decisions.md D5.
 */

export const CUSTOMER_PICKUP = "pickup";

/** Methods a rider actually delivers. Excludes customer collection. */
export function isRiderDeliverable(deliveryMethod: string): boolean {
  return deliveryMethod !== CUSTOMER_PICKUP;
}

/**
 * SQL predicate matching orders a rider can be given. Applied to rider
 * discovery and to the assignment guard, so customer-collect orders are
 * excluded at the query level rather than merely hidden in the UI.
 */
export function riderDeliverable(): SQL {
  return sql`${ordersTable.deliveryMethod} <> ${CUSTOMER_PICKUP}`;
}
