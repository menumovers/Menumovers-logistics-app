import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db, itemOverridesTable, ordersTable, type OrderItem } from "@workspace/db";
import { requireAuth, requireRole } from "../lib/auth";
import { httpError } from "../lib/errors";

const router: IRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

async function loadOrderOr404(id: string) {
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, id));
  if (!order) throw httpError(404, "ORDER_NOT_FOUND", "Order not found");
  return order;
}

function parseItemIndex(value: string | undefined): number {
  const index = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(index) || index < 0) {
    throw httpError(400, "INVALID_ITEM_INDEX", "Item index out of range");
  }
  return index;
}

function serializeOriginalItem(item: OrderItem) {
  return {
    name: item.name,
    quantity: item.quantity,
    price: item.price,
    notes: item.notes ?? null,
  };
}

// Dispatcher/admin-only view of the immutable upstream item list. Operational
// order serializers still return the override-applied list for riders and restaurants.
router.get(
  "/orders/:id/items/original",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const order = await loadOrderOr404(id);
    res.json({ items: (order.items ?? []).map(serializeOriginalItem) });
  }),
);

router.delete(
  "/orders/:id/items/hide/:itemIndex",
  requireAuth,
  requireRole("admin", "coordinator"),
  wrap(async (req, res) => {
    const id = req.params["id"] as string;
    const itemIndex = parseItemIndex(req.params["itemIndex"]);
    const order = await loadOrderOr404(id);
    if (itemIndex >= (order.items?.length ?? 0)) {
      throw httpError(400, "INVALID_ITEM_INDEX", "Item index out of range");
    }

    await db
      .delete(itemOverridesTable)
      .where(
        and(
          eq(itemOverridesTable.orderId, id),
          eq(itemOverridesTable.type, "hide"),
          eq(itemOverridesTable.itemIndex, itemIndex),
        ),
      );

    res.status(204).end();
  }),
);

export default router;
