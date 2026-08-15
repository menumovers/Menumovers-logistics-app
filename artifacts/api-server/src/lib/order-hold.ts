import { sql, type SQL } from "drizzle-orm";
import { ordersTable } from "@workspace/db";

/**
 * The "on hold" family — the only mechanism that gates an order.
 *
 * Statuses are reports and never block; a hold is a deliberate stop. A hold
 * blocks *new assignment only*: an order already being worked keeps accepting
 * status reports, so a coordinator can never freeze a rider mid-delivery.
 *
 * `orders.holdState` is read directly wherever a single order is in hand —
 * it needs no helper. This module exists for the query-level predicate below,
 * so held work is filtered out in SQL rather than in application code.
 *
 * See docs/workflow-decisions.md D2.
 */
export function notHeld(): SQL {
  return sql`${ordersTable.holdState} IS NULL`;
}
