// Backfill items[].options for orders ingested during the rollout window
// before the /inbound/orders items mapping picked up the `options` field.
// Those orders' originalPayload (stored verbatim from the validated inbound
// request) already has options — this just re-derives items[].options from
// it, matched by array index, since items is never reordered relative to
// the original payload (overrides live in item_overrides, not here).
//
// Idempotent and safe to re-run: only touches rows where an item is missing
// options but the original payload has some for that index.
//
// Usage:
//   pnpm --filter @workspace/scripts exec tsx src/backfill-item-options.ts
import { eq } from "drizzle-orm";
import { db, ordersTable, type OrderItem } from "@workspace/db";

function extractPayloadOptions(originalPayload: Record<string, unknown>, index: number): string[] | undefined {
  const items = originalPayload["items"];
  if (!Array.isArray(items)) return undefined;
  const item = items[index] as Record<string, unknown> | undefined;
  const options = item?.["options"];
  if (!Array.isArray(options) || options.length === 0) return undefined;
  if (!options.every((o) => typeof o === "string")) return undefined;
  return options as string[];
}

async function main(): Promise<void> {
  const orders = await db
    .select({ id: ordersTable.id, items: ordersTable.items, originalPayload: ordersTable.originalPayload })
    .from(ordersTable);

  let patched = 0;
  for (const order of orders) {
    let changed = false;
    const nextItems: OrderItem[] = order.items.map((item, i) => {
      if (item.options && item.options.length > 0) return item;
      const backfilled = extractPayloadOptions(order.originalPayload, i);
      if (!backfilled) return item;
      changed = true;
      return { ...item, options: backfilled };
    });

    if (!changed) continue;

    await db.update(ordersTable).set({ items: nextItems }).where(eq(ordersTable.id, order.id));
    patched++;
    console.log(`Backfilled options for order ${order.id}`);
  }

  console.log(`Done. Patched ${patched} of ${orders.length} order(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
