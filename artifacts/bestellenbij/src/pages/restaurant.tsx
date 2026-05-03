import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListOrders,
  useUpdatePickupTime,
  useListRestaurants,
  getListOrdersQueryKey,
  getListRestaurantsQueryKey,
  type OrderListItem,
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
  const eff = effectivePickup(order);
  const [hh, setHh] = useState(() => formatTime(eff.iso, lang).split(":")[0] ?? "12");
  const [mm, setMm] = useState(() => formatTime(eff.iso, lang).split(":")[1] ?? "00");
  const queryClient = useQueryClient();
  const update = useUpdatePickupTime();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const date = new Date();
    const h = Number.parseInt(hh, 10);
    const m = Number.parseInt(mm, 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    date.setHours(h, m, 0, 0);
    if (date.getTime() < Date.now() - 60_000) {
      // assume tomorrow if past
      date.setDate(date.getDate() + 1);
    }
    update.mutate(
      { id: order.id, data: { source: "restaurant", pickupTime: date.toISOString() } },
      {
        onSuccess: () => {
          toast({ title: t("common.save") });
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey({ restaurantId: order.restaurantId }) });
        },
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
        <ul className="text-sm space-y-1">
          {order.items.map((it, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span>
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
