import { useTranslation } from "react-i18next";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOrder,
  useUpdatePickupTime,
  useMarkOrderReady,
  useListRestaurants,
  getGetOrderQueryKey,
  getListOrdersQueryKey,
  getListRestaurantsQueryKey,
  type OrderItem,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/status-badge";
import { AcceptanceStatusBadge } from "@/components/acceptance-status-badge";
import { PickupCountdown } from "@/components/pickup-countdown";
import { AcknowledgeCard } from "@/components/acknowledge-card";
import { PickupTimeInput } from "@/components/pickup-time-input";
import { useAuth } from "@/lib/auth";
import { effectivePickup, formatTime } from "@/lib/format";
import { URGENCY_CLASS } from "@/lib/status";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ArrowLeft, CheckCircle2, ChefHat, Clock, Layers, Printer } from "lucide-react";

export default function RestaurantOrderPage() {
  const { id } = useParams();
  const orderId = id!;
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const restId = user?.restaurantId ?? undefined;

  const order = useGetOrder(orderId, {
    query: { queryKey: getGetOrderQueryKey(orderId), refetchInterval: 30_000, enabled: !!orderId },
  });
  const restaurants = useListRestaurants({ query: { queryKey: getListRestaurantsQueryKey() } });
  const myRestaurant = restaurants.data?.find((r) => r.id === restId);
  // How this restaurant is asked to confirm — an operator setting, not a
  // per-order one. Defaults to the simple confirm until the record loads.
  const acceptanceMode = myRestaurant?.acceptanceMode ?? "accept";

  const update = useUpdatePickupTime();
  const markReady = useMarkOrderReady();

  if (order.isLoading || !order.data) {
    return <div className="grid place-items-center py-20"><Spinner className="size-6 text-primary" /></div>;
  }
  const o = order.data;
  const overrides = o.itemOverrides ?? [];
  const hidden = new Set(
    overrides
      .filter((ov) => ov.type === "hide" && ov.itemIndex != null)
      .map((ov) => ov.itemIndex as number),
  );
  const extras = overrides.filter((ov) => ov.type === "add").map((ov) => ov.addedItem!).filter(Boolean);
  const eff = effectivePickup(o);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
    queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey({ restaurantId: o.restaurantId }) });
  }

  function readyForPickup() {
    markReady.mutate(
      { id: o.id },
      {
        onSuccess: () => {
          toast({ title: t("restaurant.readyForPickupSent") });
          invalidate();
        },
        onError: () => toast({ title: t("errors.generic"), variant: "destructive" }),
      },
    );
  }

  function submitPickup(pickupTime: string) {
    update.mutate(
      { id: o.id, data: { source: "restaurant", pickupTime } },
      {
        onSuccess: () => {
          toast({ title: t("common.save") });
          invalidate();
        },
        onError: () => toast({ title: t("errors.generic"), variant: "destructive" }),
      },
    );
  }

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <Link href="/restaurant" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-restaurant">
        <ArrowLeft className="size-4" /> {t("common.back")}
      </Link>

      {o.tripId && o.tripNumber != null ? (
        <div className="rounded-lg border border-primary/40 bg-primary/[0.04] px-3 py-2 text-sm flex items-center gap-2" data-testid="banner-trip-context">
          <Layers className="size-4 text-primary shrink-0" />
          <span className="font-medium">{t("trip.partOfTrip", { number: o.tripNumber })}</span>
        </div>
      ) : null}

      <Card data-testid={`card-restaurant-order-detail-${o.id}`}>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs text-muted-foreground tabular-nums">#{o.externalOrderId}</div>
              <CardTitle className="text-xl">{o.customerName}</CardTitle>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <StatusBadge status={o.status} />
              <AcceptanceStatusBadge acceptedAt={o.restaurantAcceptedAt} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-lg font-semibold",
                URGENCY_CLASS.neutral,
              )}
              data-testid="badge-pickup-time-absolute"
            >
              <Clock className="size-3.5" />
              {formatTime(eff.iso, lang)}
            </span>
            <PickupCountdown order={o} size="lg" />
          </div>

          <Button asChild variant="outline" size="sm" className="w-full" data-testid={`button-receipt-${o.id}`}>
            <Link href={`/orders/${o.id}/receipt?autoprint=true`}>
              <Printer className="size-3.5 mr-1.5" /> {t("receipt.title")}
            </Link>
          </Button>

          <ul className="text-sm space-y-1.5">
            {o.items.map((it, i) => {
              const isHidden = hidden.has(i);
              return (
                <li key={i} data-testid={`row-rest-item-${o.id}-${i}`}>
                  <div
                    className={cn("flex justify-between gap-2", isHidden && "line-through text-muted-foreground")}
                  >
                    <span>
                      <span className="text-muted-foreground tabular-nums">{it.quantity}× </span>
                      {it.name}
                      {isHidden ? (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground italic">
                          {t("restaurant.hiddenItem")}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <ItemOptions item={it} />
                </li>
              );
            })}
            {extras.map((it, i) => (
              <li key={`x${i}`} data-testid={`row-rest-extra-${o.id}-${i}`}>
                <div className="flex justify-between gap-2">
                  <span>
                    <span className="inline-block rounded bg-accent/15 text-accent-foreground text-[10px] uppercase px-1.5 py-0.5 mr-2">
                      {t("restaurant.extraItem")}
                    </span>
                    <span className="text-muted-foreground tabular-nums">{it.quantity}× </span>
                    {it.name}
                  </span>
                </div>
                <ItemOptions item={it} />
              </li>
            ))}
          </ul>

          {/* Notes the source addressed to the kitchen. They arrived on every
              order and were shown on no screen at all — least of all this one. */}
          {o.kitchenNotes ? (
            <div
              className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-2 text-sm"
              data-testid={`text-kitchen-notes-${o.id}`}
            >
              <ChefHat className="size-4 mt-0.5 shrink-0" />
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("restaurant.kitchenNotes")}
                </div>
                <div>{o.kitchenNotes}</div>
              </div>
            </div>
          ) : null}

          <AcknowledgeCard order={o} mode={acceptanceMode} lang={lang} onDone={invalidate} />

          <div className="border-t border-border pt-3 space-y-2">
            <Label className="text-xs">{t("restaurant.suggestPickup")}</Label>
            <PickupTimeInput
              currentIso={eff.iso}
              pending={update.isPending}
              submitLabel={t("common.save")}
              onSubmit={submitPickup}
            />
          </div>

          {/* Once reported, the button becomes the record of it. A status that
              can only be written and never read is how failure reasons went
              missing (todo-bugs B3). */}
          {o.restaurantReadyAt ? (
            <div
              className="flex items-center justify-center gap-2 rounded-md border border-chart-5/40 bg-chart-5/10 py-3 text-sm font-medium text-chart-5"
              data-testid={`text-ready-${o.id}`}
            >
              <CheckCircle2 className="size-4" />
              {t("restaurant.readyAt", { time: formatTime(o.restaurantReadyAt, lang) })}
            </div>
          ) : (
            <Button
              type="button"
              className="w-full h-12 text-base font-semibold"
              disabled={markReady.isPending}
              onClick={readyForPickup}
              data-testid={`button-ready-${o.id}`}
            >
              <CheckCircle2 className="size-4 mr-2" />
              {t("restaurant.readyForPickup")}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Selected customizations, one per row — same formatting as the receipt.
 * Falls back to the free-text note only for legacy sources without
 * structured options. */
function ItemOptions({ item }: { item: OrderItem }) {
  if (item.options && item.options.length > 0) {
    return (
      <>
        {item.options.map((option, i) => (
          <div key={i} className="text-xs text-muted-foreground">
            - {option}
          </div>
        ))}
      </>
    );
  }
  if (item.notes) {
    return <div className="text-xs text-muted-foreground">- {item.notes}</div>;
  }
  return null;
}
