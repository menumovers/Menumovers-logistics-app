import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListOrders,
  useUpdatePickupTime,
  useListRestaurants,
  useGetOrder,
  getListOrdersQueryKey,
  getListRestaurantsQueryKey,
  getGetOrderQueryKey,
  type OrderListItem,
  type OrderDetail,
  type RestaurantAcceptanceMode,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { PickupCountdown, PickupSourceBadge } from "@/components/pickup-countdown";
import { AcknowledgeCard } from "@/components/acknowledge-card";
import { PickupTimeInput } from "@/components/pickup-time-input";
import { useAuth } from "@/lib/auth";
import { effectivePickup, formatTime } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Layers, Clock, Info, Bike, ChefHat } from "lucide-react";

export default function RestaurantPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const { user } = useAuth();
  const restId = user?.restaurantId ?? undefined;

  const orders = useListOrders(
    { restaurantId: restId },
    { query: { queryKey: getListOrdersQueryKey({ restaurantId: restId }), refetchInterval: 30_000, enabled: !!restId } },
  );
  const restaurants = useListRestaurants({ query: { queryKey: getListRestaurantsQueryKey() } });
  const myRestaurant = restaurants.data?.find((r) => r.id === restId);
  // How this restaurant is asked to confirm — an operator setting, not a
  // per-order one. Defaults to the simple confirm until the record loads.
  const acceptanceMode = myRestaurant?.acceptanceMode ?? "accept";

  const active = (orders.data ?? []).filter((o) => !["delivered", "failed"].includes(o.status));

  // Group by tripId — same trip + same restaurant means a bundled pickup.
  const bundles = new Map<string, OrderListItem[]>();
  const solos: OrderListItem[] = [];
  for (const o of active) {
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

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("restaurant.title")}</h1>
          {myRestaurant ? (
            <p className="text-muted-foreground text-sm">
              {myRestaurant.name} · {t("restaurant.minDelivery")}: {myRestaurant.minDeliveryTime} {t("common.minutes")}
            </p>
          ) : null}
        </div>
        <div className="text-sm text-muted-foreground" data-testid="text-active-count">
          {t("coordinator.ordersCount", { count: active.length })}
        </div>
      </header>

      {active.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            {t("restaurant.noOrders")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {bundleGroups.map((g) => (
            <BundleCard key={g.tripId} orders={g.orders} lang={lang} acceptanceMode={acceptanceMode} />
          ))}
          {solos.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {solos.map((o) => (
                <RestaurantOrderCard
                  key={o.id}
                  order={o}
                  lang={lang}
                  acceptanceMode={acceptanceMode}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function BundleCard({
  orders,
  lang,
  acceptanceMode,
}: {
  orders: OrderListItem[];
  lang: string;
  acceptanceMode: RestaurantAcceptanceMode;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const update = useUpdatePickupTime();
  const { toast } = useToast();
  const bundleTime =
    orders[0]?.bundlePickupTime ?? effectivePickup(orders[0]!).iso;
  const tripNumber = orders[0]?.tripNumber ?? "";
  // Find any order whose original pickup differs from the bundle time.
  const adjusted = orders.filter((o) => {
    const own = effectivePickup(o).iso;
    return own && bundleTime && new Date(own).getTime() !== new Date(bundleTime).getTime();
  });

  function markAllReady() {
    const nowIso = new Date().toISOString();
    Promise.all(
      orders.map(
        (o) =>
          new Promise<void>((resolve) => {
            update.mutate(
              { id: o.id, data: { source: "restaurant", pickupTime: nowIso } },
              {
                onSuccess: () => resolve(),
                onError: () => resolve(),
              },
            );
          }),
      ),
    ).then(() => {
      toast({ title: t("restaurant.readyForPickupSent") });
      queryClient.invalidateQueries({
        queryKey: getListOrdersQueryKey({ restaurantId: orders[0]?.restaurantId }),
      });
    });
  }

  return (
    <Card
      className="border-2 border-primary/40 bg-primary/[0.04]"
      data-testid={`card-bundle-${tripNumber}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Layers className="size-4" />
            </span>
            <div>
              <div className="text-sm font-bold">
                {t("bundle.title")} ·{" "}
                {t("bundle.ordersCount", { count: orders.length })}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("bundle.subtitle")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-card border border-border px-3 py-1.5">
            <Clock className="size-4 text-primary" />
            <span className="text-sm font-bold tabular-nums">
              {formatTime(bundleTime, lang)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {adjusted.length > 0 ? (
          <div className="flex items-start gap-2 rounded-md bg-accent/15 border border-accent/40 px-3 py-2 text-xs text-accent-foreground">
            <Info className="size-3.5 mt-0.5 shrink-0" />
            <span>
              {t("bundle.earliestPickup")}{" "}
              {adjusted.map((o) => (
                <span key={o.id} className="font-semibold">
                  #{o.externalOrderId} {t("bundle.wasOriginally", { time: formatTime(effectivePickup(o).iso, lang) })}.{" "}
                </span>
              ))}
            </span>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {orders.map((o) => (
            <RestaurantOrderCard
              key={o.id}
              order={o}
              lang={lang}
              acceptanceMode={acceptanceMode}
              compact
            />
          ))}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border">
          <span className="inline-flex items-center gap-1.5">
            <Bike className="size-3" />{" "}
            {orders[0]?.riderName
              ? t("bundle.tripContext", {
                  number: tripNumber,
                  rider: orders[0].riderName,
                })
              : t("bundle.tripContextOpen", { number: tripNumber })}
          </span>
          <Button
            size="sm"
            disabled={update.isPending}
            onClick={markAllReady}
            data-testid={`button-bundle-ready-${tripNumber}`}
          >
            <CheckCircle2 className="size-3.5 mr-1" /> {t("bundle.markAllReady")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RestaurantOrderCard({
  order,
  lang,
  acceptanceMode,
  compact = false,
}: {
  order: OrderListItem;
  lang: string;
  acceptanceMode: RestaurantAcceptanceMode;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useUpdatePickupTime();

  // Detail fetch supplies item overrides (hidden + extras) for this card.
  const detail = useGetOrder(order.id, {
    query: {
      queryKey: getGetOrderQueryKey(order.id),
      refetchInterval: 30_000,
      staleTime: 15_000,
    },
  });
  const overrides = (detail.data as OrderDetail | undefined)?.itemOverrides ?? [];
  const hidden = new Set(
    overrides
      .filter((o) => o.type === "hide" && o.itemIndex != null)
      .map((o) => o.itemIndex as number),
  );
  const extras = overrides.filter((o) => o.type === "add").map((o) => o.addedItem!).filter(Boolean);

  const eff = effectivePickup(order);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey({ restaurantId: order.restaurantId }) });
    queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) });
  }

  function submit(pickupTime: string) {
    update.mutate(
      { id: order.id, data: { source: "restaurant", pickupTime } },
      {
        onSuccess: () => {
          toast({ title: t("common.save") });
          invalidate();
        },
        onError: () => toast({ title: t("errors.generic"), variant: "destructive" }),
      },
    );
  }

  function readyForPickup() {
    update.mutate(
      { id: order.id, data: { source: "restaurant", pickupTime: new Date().toISOString() } },
      {
        onSuccess: () => {
          toast({ title: t("restaurant.readyForPickupSent") });
          invalidate();
        },
        onError: () => toast({ title: t("errors.generic"), variant: "destructive" }),
      },
    );
  }

  return (
    <Card data-testid={`card-restaurant-order-${order.id}`}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-2 pb-3">
        <div>
          <div className="text-xs text-muted-foreground">#{order.externalOrderId}</div>
          <div className="font-semibold">{order.customerName}</div>
        </div>
        <StatusBadge status={order.status} />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <PickupCountdown order={order} />
          <PickupSourceBadge source={eff.source} />
        </div>

        <AcknowledgeCard
          order={order}
          mode={acceptanceMode}
          lang={lang}
          onDone={invalidate}
        />

        <Button
          type="button"
          className="w-full h-12 text-base font-semibold"
          disabled={update.isPending}
          onClick={readyForPickup}
          data-testid={`button-ready-${order.id}`}
        >
          <CheckCircle2 className="size-4 mr-2" />
          {t("restaurant.readyForPickup")}
        </Button>

        {/* Notes the source addressed to the kitchen. They arrived on every
            order and were shown on no screen at all — least of all this one. */}
        {order.kitchenNotes ? (
          <div
            className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-2 text-sm"
            data-testid={`text-kitchen-notes-${order.id}`}
          >
            <ChefHat className="size-4 mt-0.5 shrink-0" />
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("restaurant.kitchenNotes")}
              </div>
              <div>{order.kitchenNotes}</div>
            </div>
          </div>
        ) : null}

        <ul className="text-sm space-y-1">
          {order.items.map((it, i) => {
            const isHidden = hidden.has(i);
            return (
              <li
                key={i}
                className="flex justify-between gap-2"
                data-testid={`row-rest-item-${order.id}-${i}`}
              >
                <span className={isHidden ? "line-through text-muted-foreground" : ""}>
                  <span className="text-muted-foreground tabular-nums">{it.quantity}× </span>
                  {it.name}
                  {isHidden ? (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground italic">
                      {t("restaurant.hiddenItem")}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
          {extras.map((it, i) => (
            <li
              key={`x${i}`}
              className="flex justify-between gap-2"
              data-testid={`row-rest-extra-${order.id}-${i}`}
            >
              <span>
                <span className="inline-block rounded bg-accent/15 text-accent-foreground text-[10px] uppercase px-1.5 py-0.5 mr-2">
                  {t("restaurant.extraItem")}
                </span>
                <span className="text-muted-foreground tabular-nums">{it.quantity}× </span>
                {it.name}
              </span>
            </li>
          ))}
        </ul>

        {compact ? null : (
          <div className="border-t border-border pt-3 space-y-2">
            <Label className="text-xs">{t("restaurant.suggestPickup")}</Label>
            <PickupTimeInput
              currentIso={eff.iso}
              pending={update.isPending}
              submitLabel={t("common.save")}
              onSubmit={submit}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
