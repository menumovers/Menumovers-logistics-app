import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  useListOrders,
  getListOrdersQueryKey,
  type OrderListItem,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { PickupCountdown } from "@/components/pickup-countdown";
import { AcceptanceStatusBadge } from "@/components/acceptance-status-badge";
import { useAuth } from "@/lib/auth";
import { Bike, Layers } from "lucide-react";
import { motion } from "framer-motion";
import { effectivePickup, formatTime } from "@/lib/format";

// A rider carrying the order (or having finished it) is past the point
// where the restaurant has anything left to do — these sit in their own
// section regardless of acceptance state.
const IN_DELIVERY_OR_DONE_STATUSES: ReadonlyArray<OrderListItem["status"]> = [
  "picked_up",
  "en_route_to_customer",
  "delivered",
  "failed",
];
/** Terminal orders (delivered/failed) stay visible for this long, same
 * recency window the coordinator board uses for its Completed section —
 * old ones fall off rather than accumulating forever. */
const COMPLETED_WINDOW_MS = 60 * 60_000;

function isRecent(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() <= COMPLETED_WINDOW_MS;
}

export default function RestaurantPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const { user } = useAuth();
  const restId = user?.restaurantId ?? undefined;

  const orders = useListOrders(
    { restaurantId: restId },
    { query: { queryKey: getListOrdersQueryKey({ restaurantId: restId }), refetchInterval: 30_000, enabled: !!restId } },
  );

  const visible = (orders.data ?? []).filter(
    (o) => (o.status !== "delivered" && o.status !== "failed") || isRecent(o.updatedAt),
  );
  const inDeliveryOrDone = visible.filter((o) => IN_DELIVERY_OR_DONE_STATUSES.includes(o.status));
  const stillWithRestaurant = visible.filter((o) => !IN_DELIVERY_OR_DONE_STATUSES.includes(o.status));
  const needsAction = stillWithRestaurant.filter((o) => !o.restaurantAcceptedAt);
  const accepted = stillWithRestaurant.filter((o) => o.restaurantAcceptedAt);

  return (
    <div className="space-y-6">
      <header className="flex justify-end">
        <div className="text-sm text-muted-foreground" data-testid="text-visible-count">
          {t("coordinator.ordersCount", { count: visible.length })}
        </div>
      </header>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            {t("restaurant.noOrders")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Section
            title={t("restaurant.sectionNeedsAction")}
            emptyText={t("restaurant.sectionNeedsActionEmpty")}
            orders={needsAction}
            lang={lang}
            testId="section-needs-action"
            highlight
          />
          <Section
            title={t("restaurant.sectionAccepted")}
            emptyText={t("restaurant.sectionAcceptedEmpty")}
            orders={accepted}
            lang={lang}
            testId="section-accepted"
          />
          <Section
            title={t("restaurant.sectionInDeliveryOrDone")}
            emptyText={t("restaurant.sectionInDeliveryOrDoneEmpty")}
            orders={inDeliveryOrDone}
            lang={lang}
            testId="section-in-delivery-or-done"
          />
        </div>
      )}
    </div>
  );
}

/** Same trip + same restaurant means a bundled pickup — pulled out of the
 * plain grid into its own BundleSection, the rest render solo. */
function groupBundles(orders: OrderListItem[]) {
  const bundles = new Map<string, OrderListItem[]>();
  const solos: OrderListItem[] = [];
  for (const o of orders) {
    if (o.tripId) {
      const arr = bundles.get(o.tripId) ?? [];
      arr.push(o);
      bundles.set(o.tripId, arr);
    } else {
      solos.push(o);
    }
  }
  const bundleGroups = Array.from(bundles.entries())
    .map(([tripId, ords]) => ({ tripId, orders: ords }))
    .filter((g) => g.orders.length >= 2);
  // Bundles of 1 (single order in a trip from this restaurant) render as solo.
  for (const [, ords] of bundles) {
    if (ords.length < 2) solos.push(...ords);
  }
  return { bundleGroups, solos };
}

function Section({
  title,
  emptyText,
  orders,
  lang,
  testId,
  highlight = false,
}: {
  title: string;
  emptyText: string;
  orders: OrderListItem[];
  lang: string;
  testId: string;
  highlight?: boolean;
}) {
  const { bundleGroups, solos } = groupBundles(orders);
  return (
    <section data-testid={testId} className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2
          className={`text-sm font-semibold uppercase tracking-wide ${highlight && orders.length > 0 ? "text-accent-foreground" : "text-muted-foreground"}`}
        >
          {title}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums" data-testid={`${testId}-count`}>
          {orders.length}
        </span>
      </div>
      {orders.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">{emptyText}</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {bundleGroups.map((g) => (
            <BundleSection key={g.tripId} orders={g.orders} lang={lang} />
          ))}
          {solos.length > 0 ? (
            <Grid>
              {solos.map((o) => (
                <RestaurantOrderCard key={o.id} order={o} lang={lang} />
              ))}
            </Grid>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.04 } } }}
      className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
    >
      {children}
    </motion.div>
  );
}

/** Groups a bundled pickup's orders under a shared trip header — purely a
 * summary, same role as the rider dashboard's trip row. Each order still
 * links out to its own detail page. */
function BundleSection({ orders, lang }: { orders: OrderListItem[]; lang: string }) {
  const { t } = useTranslation();
  const bundleTime = orders[0]?.bundlePickupTime ?? effectivePickup(orders[0]!).iso;
  const tripNumber = orders[0]?.tripNumber ?? "";

  return (
    <section
      className="rounded-lg border-2 border-primary/40 bg-primary/[0.04] p-4 space-y-3"
      data-testid={`section-bundle-${tripNumber}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Layers className="size-4" />
          </span>
          <div>
            <div className="text-sm font-bold">
              {t("bundle.title")} · {t("bundle.ordersCount", { count: orders.length })}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Bike className="size-3" />
              {orders[0]?.riderName
                ? t("bundle.tripContext", { number: tripNumber, rider: orders[0].riderName })
                : t("bundle.tripContextOpen", { number: tripNumber })}
            </div>
          </div>
        </div>
        <span className="text-sm font-bold tabular-nums">{formatTime(bundleTime, lang)}</span>
      </div>
      <Grid>
        {orders.map((o) => (
          <RestaurantOrderCard key={o.id} order={o} lang={lang} />
        ))}
      </Grid>
    </section>
  );
}

function RestaurantOrderCard({ order, lang }: { order: OrderListItem; lang: string }) {
  const { t } = useTranslation();
  const eff = effectivePickup(order);
  return (
    <motion.div variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
      <Link href={`/restaurant/orders/${order.id}`}>
        <Card
          className="hover:border-primary/40 hover:shadow-md transition cursor-pointer"
          data-testid={`card-restaurant-order-${order.id}`}
        >
          <CardContent className="py-4 space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <PickupCountdown order={order} size="lg" />
              <AcceptanceStatusBadge acceptedAt={order.restaurantAcceptedAt} />
            </div>
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>{t("rider.pickupCompact")} {formatTime(eff.iso, lang)}</span>
              <span className="text-right">
                #{order.externalOrderId} · {order.customerName}
              </span>
            </div>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}
