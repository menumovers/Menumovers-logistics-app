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
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { PickupCountdown, PickupSourceBadge } from "@/components/pickup-countdown";
import { useAuth } from "@/lib/auth";
import { effectivePickup, formatTime } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2 } from "lucide-react";

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

  const active = (orders.data ?? []).filter((o) => !["delivered", "failed"].includes(o.status));

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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {active.map((o) => (
            <RestaurantOrderCard key={o.id} order={o} lang={lang} />
          ))}
        </div>
      )}
    </div>
  );
}

function RestaurantOrderCard({ order, lang }: { order: OrderListItem; lang: string }) {
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
  const [hh, setHh] = useState(() => formatTime(eff.iso, lang).split(":")[0] ?? "12");
  const [mm, setMm] = useState(() => formatTime(eff.iso, lang).split(":")[1] ?? "00");

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey({ restaurantId: order.restaurantId }) });
    queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const date = new Date();
    const h = Number.parseInt(hh, 10);
    const m = Number.parseInt(mm, 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    date.setHours(h, m, 0, 0);
    if (date.getTime() < Date.now() - 60_000) {
      date.setDate(date.getDate() + 1);
    }
    update.mutate(
      { id: order.id, data: { source: "restaurant", pickupTime: date.toISOString() } },
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

        <form onSubmit={submit} className="border-t border-border pt-3 space-y-2">
          <Label className="text-xs">{t("restaurant.suggestPickup")}</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={23}
              value={hh}
              onChange={(e) => setHh(e.target.value)}
              className="w-16 tabular-nums"
              aria-label={t("coordinator.newPickupTime")}
              data-testid={`input-rest-pickup-hh-${order.id}`}
            />
            <span className="text-muted-foreground">:</span>
            <Input
              type="number"
              min={0}
              max={59}
              value={mm}
              onChange={(e) => setMm(e.target.value)}
              className="w-16 tabular-nums"
              aria-label={t("coordinator.newPickupTime")}
              data-testid={`input-rest-pickup-mm-${order.id}`}
            />
            <Button type="submit" size="sm" disabled={update.isPending} data-testid={`button-rest-pickup-save-${order.id}`}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
