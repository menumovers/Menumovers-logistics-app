import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  useListOrders,
  useListRestaurants,
  useListRiders,
  useListTrips,
  useReleaseOrder,
  useSetOrderRestaurant,
  getListOrdersQueryKey,
  getListRestaurantsQueryKey,
  getListRidersQueryKey,
  getListTripsQueryKey,
  OrderStatus,
  type OrderListItem,
  type TripListItem,
  type Restaurant,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/status-badge";
import { PickupCountdown, PickupSourceBadge } from "@/components/pickup-countdown";
import { DeliveryMethodBadge, RequestedTimeLabel } from "@/components/delivery-expectation";
import { effectivePickup, formatCurrency } from "@/lib/format";
import { tripProgress } from "@/lib/trip-progress";
import { Bike, MapPin, Phone, Bell, ChevronRight, Layers, Plus, PauseCircle, PlayCircle, ShoppingBag, CircleDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

const ALL = "__all__";

export default function CoordinatorPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const [status, setStatus] = useState<string>(ALL);
  const [restaurantId, setRestaurantId] = useState<string>(ALL);
  const [riderId, setRiderId] = useState<string>(ALL);
  const [q, setQ] = useState("");

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (status !== ALL) p.status = status;
    if (restaurantId !== ALL) p.restaurantId = restaurantId;
    if (riderId !== ALL) p.riderId = riderId;
    if (q.trim()) p.q = q.trim();
    return p;
  }, [status, restaurantId, riderId, q]);

  const orders = useListOrders(params, {
    query: { queryKey: getListOrdersQueryKey(params), refetchInterval: 30_000 },
  });
  const restaurants = useListRestaurants({ query: { queryKey: getListRestaurantsQueryKey() } });
  const riders = useListRiders({ query: { queryKey: getListRidersQueryKey(), refetchInterval: 30_000 } });
  const trips = useListTrips(undefined, {
    query: { queryKey: getListTripsQueryKey(), refetchInterval: 30_000 },
  });

  const all = orders.data ?? [];
  // Held orders get their own section rather than sitting in the main grid
  // looking dispatchable — a parked one is attributed to a placeholder
  // restaurant until someone resolves it.
  const held = all.filter((o) => o.holdState != null);
  const unheld = all.filter((o) => o.holdState == null);
  // The customer collects these themselves. They never reach a rider, so they
  // don't belong in the dispatch grid — but they still need watching.
  const customerPickup = unheld.filter((o) => o.deliveryMethod === "pickup");
  const list = unheld.filter((o) => o.deliveryMethod !== "pickup");
  const activeTrips = (trips.data ?? []).filter(
    (tr) => tr.status !== "completed" && tr.status !== "dissolved",
  );

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("coordinator.title")}</h1>
          <p className="text-muted-foreground text-sm">{t("coordinator.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground tabular-nums" data-testid="text-orders-count">
            {t("coordinator.ordersCount", { count: list.length })}
          </div>
          <Button asChild data-testid="button-new-trip">
            <Link href="/coordinator/trips/new">
              <Plus className="size-4 mr-1" /> {t("trip.newTrip")}
            </Link>
          </Button>
        </div>
      </header>

      {held.length > 0 ? (
        <HeldSection held={held} restaurants={restaurants.data ?? []} />
      ) : null}

      {customerPickup.length > 0 ? (
        <CustomerPickupSection orders={customerPickup} lang={lang} />
      ) : null}

      {activeTrips.length > 0 ? <TripsSection trips={activeTrips} /> : null}

      <Card>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 py-4">
          <div className="md:col-span-1">
            <Label className="text-xs text-muted-foreground">{t("common.search")}</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("coordinator.searchPlaceholder")}
              data-testid="input-search"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("coordinator.filterStatus")}</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger data-testid="select-filter-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("common.all")}</SelectItem>
                {Object.values(OrderStatus).map((s) => (
                  <SelectItem key={s} value={s}>{t(`orderStatus.${s}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("coordinator.filterRestaurant")}</Label>
            <Select value={restaurantId} onValueChange={setRestaurantId}>
              <SelectTrigger data-testid="select-filter-restaurant"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("common.all")}</SelectItem>
                {(restaurants.data ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("coordinator.filterRider")}</Label>
            <Select value={riderId} onValueChange={setRiderId}>
              <SelectTrigger data-testid="select-filter-rider"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("common.all")}</SelectItem>
                {(riders.data ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <WorkloadPanel riders={riders.data ?? []} />

      {orders.isLoading ? (
        <div className="grid place-items-center py-20"><Spinner className="size-6 text-primary" /></div>
      ) : list.length === 0 ? (
        <Card><CardContent className="py-20 text-center text-muted-foreground">{t("coordinator.empty")}</CardContent></Card>
      ) : (
        <motion.div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.04 } } }}>
          {list.map((o) => (
            <OrderCard key={o.id} order={o} lang={lang} />
          ))}
        </motion.div>
      )}
    </div>
  );
}

/**
 * Customer-pickup orders. Excluded from rider scope at the SQL level, so they
 * can never be claimed or assigned — this section exists purely so admins and
 * coordinators can keep an eye on them. See docs/workflow-decisions.md D5.
 */
function CustomerPickupSection({
  orders,
  lang,
}: {
  orders: OrderListItem[];
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <Card data-testid="card-customer-pickup-section">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <ShoppingBag className="size-4" /> {t("delivery.pickupSection", { count: orders.length })}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t("delivery.pickupSectionHelp")}</p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={`/coordinator/orders/${o.id}`}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2 hover:border-primary/50"
                data-testid={`customer-pickup-row-${o.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground tabular-nums">#{o.externalOrderId}</span>
                    <span className="font-medium truncate">{o.customerName}</span>
                    <StatusBadge status={o.status} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{o.restaurantName}</span>
                    <span>·</span>
                    <RequestedTimeLabel order={o} lang={lang} />
                  </div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Held orders — the only thing that genuinely blocks dispatch. Riders never see
 * these. A `parked` order is resolved by naming its real restaurant, which
 * lifts the hold; a deliberate hold is simply released.
 */
function HeldSection({
  held,
  restaurants,
}: {
  held: OrderListItem[];
  restaurants: Restaurant[];
}) {
  const { t } = useTranslation();
  return (
    <Card className="border-accent/50 bg-accent/[0.04]" data-testid="card-held-section">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <PauseCircle className="size-4" /> {t("hold.sectionTitle", { count: held.length })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {held.map((o) => (
            <HeldRow key={o.id} order={o} restaurants={restaurants} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function HeldRow({
  order,
  restaurants,
}: {
  order: OrderListItem;
  restaurants: Restaurant[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const release = useReleaseOrder();
  const setRestaurant = useSetOrderRestaurant();
  const [restaurantId, setRestaurantId] = useState("");
  const isParked = order.holdState === "parked";
  // The placeholder is never a valid destination — it's what "unresolved" means.
  const candidates = restaurants.filter((r) => r.nameCode !== "unmapped");

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
  }

  return (
    <li
      className="rounded-md border border-border bg-card px-3 py-2.5 space-y-2"
      data-testid={`held-row-${order.id}`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                isParked
                  ? "bg-destructive/15 text-destructive"
                  : "bg-accent/20 text-accent-foreground"
              }`}
            >
              {t(`hold.state_${order.holdState}`)}
            </span>
            <span className="text-muted-foreground tabular-nums">#{order.externalOrderId}</span>
            <span className="font-medium truncate">{order.customerName}</span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {order.holdReason ?? t("hold.noReason")}
            {order.heldByUserName ? <> · {order.heldByUserName}</> : null}
          </div>
        </div>
        <Link
          href={`/coordinator/orders/${order.id}`}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
        >
          {t("common.details")} <ChevronRight className="size-3" />
        </Link>
      </div>

      {isParked ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <Label className="text-xs text-muted-foreground">{t("hold.assignRestaurant")}</Label>
            <Select value={restaurantId} onValueChange={setRestaurantId}>
              <SelectTrigger data-testid={`select-hold-restaurant-${order.id}`}>
                <SelectValue placeholder={t("hold.selectRestaurant")} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={!restaurantId || setRestaurant.isPending}
            onClick={() =>
              setRestaurant.mutate(
                { id: order.id, data: { restaurantId } },
                { onSuccess: invalidate },
              )
            }
            data-testid={`button-resolve-parked-${order.id}`}
          >
            {t("hold.resolve")}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={release.isPending}
          onClick={() => release.mutate({ id: order.id }, { onSuccess: invalidate })}
          data-testid={`button-release-${order.id}`}
        >
          <PlayCircle className="size-3.5 mr-1" /> {t("hold.release")}
        </Button>
      )}
    </li>
  );
}

function TripsSection({ trips }: { trips: TripListItem[] }) {
  const { t } = useTranslation();
  return (
    <Card data-testid="card-trips-section">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <Layers className="size-4" /> {t("trip.tripsSection")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {trips.map((tr) => {
            const { total, done, skipped, pct } = tripProgress(tr);
            return (
              <li key={tr.id}>
                <Link
                  href={`/coordinator/trips/${tr.id}`}
                  className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/[0.04] px-3 py-2.5 hover:border-primary/60"
                  data-testid={`trip-row-${tr.id}`}
                >
                  <Layers className="size-4 text-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-bold tabular-nums">
                        {t("trip.tripNumber", { number: tr.tripNumber })}
                      </span>
                      {tr.name ? (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="truncate">{tr.name}</span>
                        </>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <Bike className="size-3" />
                      <span>{tr.riderName ?? t("trip.unassigned")}</span>
                      <span>·</span>
                      <span>{t("trip.progress", { done, total })}</span>
                      {skipped > 0 ? (
                        <span data-testid={`trip-skipped-${tr.id}`}>
                          · {t("trip.skippedCount", { count: skipped })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="hidden md:flex w-32 items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                      {pct}%
                    </span>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function WorkloadPanel({ riders }: { riders: ReadonlyArray<{ id: string; name: string; availabilityStatus: "online" | "backup" | "offline"; activeOrderCount: number; queuedOrderCount: number }> }) {
  const { t } = useTranslation();
  const sorted = [...riders].sort((a, b) => {
    const order = { online: 0, backup: 1, offline: 2 } as const;
    if (order[a.availabilityStatus] !== order[b.availabilityStatus])
      return order[a.availabilityStatus] - order[b.availabilityStatus];
    return a.name.localeCompare(b.name);
  });
  return (
    <Card data-testid="card-workload-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <Bike className="size-4" /> {t("coordinator.workload")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("coordinator.workloadEmpty")}</p>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {sorted.map((r) => {
              const isOffline = r.availabilityStatus === "offline";
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                  data-testid={`workload-row-${r.id}`}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.name}</div>
                    <div className={`text-xs ${isOffline ? "text-muted-foreground" : "text-chart-5"}`}>
                      {t(`availability.${r.availabilityStatus}`)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs tabular-nums">
                    <div className="text-right">
                      <div className="text-muted-foreground uppercase tracking-wide text-[10px]">
                        {t("coordinator.workloadActive")}
                      </div>
                      <div className="font-semibold text-base text-foreground" data-testid={`workload-active-${r.id}`}>
                        {r.activeOrderCount}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-muted-foreground uppercase tracking-wide text-[10px]">
                        {t("coordinator.workloadQueued")}
                      </div>
                      <div className="font-semibold text-base text-foreground" data-testid={`workload-queued-${r.id}`}>
                        {r.queuedOrderCount}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function OrderCard({ order, lang }: { order: OrderListItem; lang: string }) {
  const { t } = useTranslation();
  const eff = effectivePickup(order);
  return (
    <motion.div variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
      <Link href={`/coordinator/orders/${order.id}`}>
        <Card
          className="hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 transition cursor-pointer group h-full"
          data-testid={`card-order-${order.id}`}
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground tabular-nums">#{order.externalOrderId}</div>
                <div className="font-semibold truncate" data-testid={`text-customer-${order.id}`}>{order.customerName}</div>
                <div className="text-xs text-muted-foreground truncate">{order.restaurantName}</div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <StatusBadge status={order.status} />
                <DeliveryMethodBadge order={order} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <PickupCountdown order={order} />
              <PickupSourceBadge source={eff.source} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <RequestedTimeLabel order={order} lang={lang} />
              {/* Visibility, not escalation — acknowledgement gates nothing. */}
              {order.restaurantAcceptedAt ? null : (
                <span
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground"
                  data-testid={`text-unconfirmed-${order.id}`}
                >
                  <CircleDashed className="size-3" /> {t("acknowledge.notYetShort")}
                </span>
              )}
            </div>
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="size-3.5 mt-0.5 shrink-0" />
              <span className="line-clamp-2">{order.deliveryAddress}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Phone className="size-3.5 shrink-0" />
              <span className="tabular-nums">{order.customerPhone}</span>
            </div>
            <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
              <span className="text-muted-foreground">
                {order.items.length} × · <span className="tabular-nums">{formatCurrency(order.totalAmount, lang)}</span>
              </span>
              <span className="flex items-center gap-1.5 text-foreground">
                {order.riderName ? (
                  <><Bike className="size-3.5" /> <span className="font-medium">{order.riderName}</span></>
                ) : (
                  <span className="text-muted-foreground italic">{t("common.none")}</span>
                )}
              </span>
            </div>
            {order.pendingRiderNotification ? (
              <div className="flex items-start gap-2 text-xs rounded-md bg-accent/10 border border-accent/30 p-2 text-accent-foreground">
                <Bell className="size-3.5 mt-0.5 shrink-0" />
                <span className="line-clamp-2">{order.pendingRiderNotification}</span>
              </div>
            ) : null}
            <div className="flex justify-end -mb-1">
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}
