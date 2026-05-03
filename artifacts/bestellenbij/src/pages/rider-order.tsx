import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOrder,
  useTransitionOrderStatus,
  useUpdatePickupTime,
  useGetVapidPublicKey,
  useSubscribePush,
  useUnsubscribePush,
  getGetOrderQueryKey,
  getGetVapidPublicKeyQueryKey,
  getListOrdersQueryKey,
  type OrderStatus as OrderStatusType,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/status-badge";
import { PickupCountdown, PickupSourceBadge } from "@/components/pickup-countdown";
import { ArrowLeft, Phone, MapPin, Bell, BellOff, Store, ChevronRight, Clock, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { effectivePickup, formatCurrency, formatTime } from "@/lib/format";

const NEXT: Partial<Record<OrderStatusType, OrderStatusType>> = {
  driver_assigned: "en_route_to_restaurant",
  en_route_to_restaurant: "picked_up",
  picked_up: "en_route_to_customer",
  en_route_to_customer: "delivered",
};

const CAN_POSTPONE: OrderStatusType[] = [
  "driver_assigned",
  "en_route_to_restaurant",
  "en_route_to_customer",
];

export default function RiderOrderPage() {
  const { id } = useParams();
  const orderId = id!;
  const order = useGetOrder(orderId, {
    query: { queryKey: getGetOrderQueryKey(orderId), refetchInterval: 30_000, enabled: !!orderId },
  });
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const transition = useTransitionOrderStatus();
  const updatePickup = useUpdatePickupTime();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [failureReason, setFailureReason] = useState("");
  const [postponeReason, setPostponeReason] = useState("");
  const [pickupTime, setPickupTime] = useState("");

  const effIso = order.data ? effectivePickup(order.data).iso : null;
  useEffect(() => {
    if (effIso) setPickupTime(formatTime(effIso, "en"));
  }, [effIso]);

  if (order.isLoading || !order.data) {
    return <div className="grid place-items-center py-20"><Spinner className="size-6 text-primary" /></div>;
  }
  const o = order.data;
  const next = NEXT[o.status];

  function invalidate() {
    qc.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
    qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
  }

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <Link href="/rider" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-rider">
        <ArrowLeft className="size-4" /> {t("common.back")}
      </Link>

      {o.tripId && o.tripNumber != null ? (
        <div className="rounded-lg border border-primary/40 bg-primary/[0.04] px-3 py-2 text-sm flex items-center gap-2" data-testid="banner-trip-context">
          <Layers className="size-4 text-primary shrink-0" />
          <span className="font-medium">{t("trip.partOfTrip", { number: o.tripNumber })}</span>
        </div>
      ) : null}

      {o.pendingRiderNotification ? (
        <div className="rounded-lg bg-accent border border-accent text-accent-foreground p-4 flex items-start gap-3" data-testid="banner-rider-notification">
          <Bell className="size-5 mt-0.5 shrink-0" />
          <div>
            <div className="text-xs uppercase tracking-wide opacity-70">{t("rider.notification")}</div>
            <div className="text-base font-medium">{o.pendingRiderNotification}</div>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs text-muted-foreground tabular-nums">#{o.externalOrderId}</div>
              <CardTitle className="text-xl">{o.restaurantName}</CardTitle>
            </div>
            <StatusBadge status={o.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <PickupCountdown order={o} size="lg" />
            <PickupSourceBadge source={effectivePickup(o).source} />
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2"><Store className="size-4 mt-0.5 text-muted-foreground" /><span className="font-medium">{o.restaurantName}</span></div>
            <div className="border-t border-border pt-2">
              <div className="font-medium">{o.customerName}</div>
              <div className="flex items-start gap-2 text-muted-foreground"><MapPin className="size-3.5 mt-0.5" /><span>{o.deliveryAddress}</span></div>
              {o.deliveryInstructions ? <div className="pl-5 italic text-xs text-muted-foreground">{o.deliveryInstructions}</div> : null}
            </div>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" className="flex-1" data-testid="button-call-customer">
              <a href={`tel:${o.customerPhone}`}><Phone className="size-4 mr-2" />{t("rider.callCustomer")}</a>
            </Button>
          </div>
          <div className="border-t border-border pt-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{t("coordinator.items")}</div>
            <ul className="text-sm space-y-1">
              {o.items.map((it, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span><span className="text-muted-foreground tabular-nums">{it.quantity}× </span>{it.name}</span>
                  <span className="tabular-nums text-muted-foreground">{formatCurrency(it.price, lang)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between text-sm font-medium mt-2 pt-2 border-t border-border">
              <span>{t("common.actions")}</span><span className="tabular-nums">{formatCurrency(o.totalAmount, lang)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {o.status === "postponed" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("postpone.resume")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Button
              size="lg"
              disabled={transition.isPending}
              onClick={() =>
                transition.mutate(
                  { id: o.id, data: { toStatus: "en_route_to_restaurant" } },
                  { onSuccess: () => { toast({ title: t("orderStatus.en_route_to_restaurant") }); invalidate(); } },
                )
              }
              data-testid="button-rider-resume-restaurant"
            >
              {t("orderStatus.en_route_to_restaurant")}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              disabled={transition.isPending}
              onClick={() =>
                transition.mutate(
                  { id: o.id, data: { toStatus: "en_route_to_customer" } },
                  { onSuccess: () => { toast({ title: t("orderStatus.en_route_to_customer") }); invalidate(); } },
                )
              }
              data-testid="button-rider-resume-customer"
            >
              {t("orderStatus.en_route_to_customer")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {next ? (
        <Button
          size="lg"
          className="w-full h-16 text-lg font-semibold"
          disabled={transition.isPending}
          onClick={() =>
            transition.mutate(
              { id: o.id, data: { toStatus: next } },
              { onSuccess: () => { toast({ title: t(`orderStatus.${next}`) }); invalidate(); } },
            )
          }
          data-testid="button-rider-advance"
        >
          {t("rider.advance")} · {t(`orderStatus.${next}`)} <ChevronRight className="size-5 ml-2" />
        </Button>
      ) : null}

      {CAN_POSTPONE.includes(o.status) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="size-4" /> {t("postpone.action")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              value={postponeReason}
              onChange={(e) => setPostponeReason(e.target.value)}
              rows={2}
              placeholder={t("postpone.reasonPlaceholder")}
              data-testid="textarea-postpone-reason"
            />
            <Button
              variant="outline"
              className="w-full"
              disabled={transition.isPending}
              onClick={() =>
                transition.mutate(
                  { id: o.id, data: { toStatus: "postponed", note: postponeReason || undefined } },
                  {
                    onSuccess: () => {
                      toast({ title: t("postpone.submitted") });
                      setPostponeReason("");
                      invalidate();
                    },
                  },
                )
              }
              data-testid="button-rider-postpone"
            >
              {t("postpone.submit")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {o.status !== "delivered" && o.status !== "failed" ? (
        <Card>
          <CardHeader><CardTitle className="text-base text-destructive">{t("rider.fail")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              value={failureReason}
              onChange={(e) => setFailureReason(e.target.value)}
              rows={2}
              placeholder={t("rider.failureReason")}
              data-testid="textarea-rider-fail-reason"
            />
            <Button
              variant="destructive"
              className="w-full"
              disabled={transition.isPending || failureReason.trim().length === 0}
              onClick={() =>
                transition.mutate(
                  { id: o.id, data: { toStatus: "failed", failureReason } },
                  { onSuccess: () => { toast({ title: t("orderStatus.failed") }); invalidate(); } },
                )
              }
              data-testid="button-rider-fail"
            >
              {t("rider.fail")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle className="text-base">{t("rider.suggestPickup")}</CardTitle></CardHeader>
        <CardContent className="flex gap-2 items-end">
          <div className="flex-1">
            <Label className="text-xs">{t("coordinator.newPickupTime")}</Label>
            <Input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} data-testid="input-rider-pickup-time" />
          </div>
          <Button
            disabled={updatePickup.isPending || !pickupTime}
            onClick={() => {
              const [h, m] = pickupTime.split(":").map((v) => Number.parseInt(v, 10));
              if (Number.isNaN(h) || Number.isNaN(m)) return;
              const date = new Date();
              date.setHours(h, m, 0, 0);
              if (date.getTime() < Date.now() - 60_000) date.setDate(date.getDate() + 1);
              updatePickup.mutate(
                { id: o.id, data: { source: "rider", pickupTime: date.toISOString() } },
                { onSuccess: () => { toast({ title: t("rider.suggestPickup") }); invalidate(); } },
              );
            }}
            data-testid="button-rider-suggest-pickup"
          >
            {t("common.save")}
          </Button>
        </CardContent>
      </Card>

      <PushCard />
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function PushCard() {
  const { t } = useTranslation();
  const vapid = useGetVapidPublicKey({ query: { queryKey: getGetVapidPublicKeyQueryKey() } });
  const subscribe = useSubscribePush();
  const unsubscribe = useUnsubscribePush();
  const { toast } = useToast();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready
      .then((r) => r.pushManager.getSubscription())
      .then((s) => setSubscribed(!!s))
      .catch(() => setSubscribed(false));
  }, [supported]);

  if (!supported) {
    return <Card><CardContent className="py-4 text-sm text-muted-foreground">{t("rider.pushUnsupported")}</CardContent></Card>;
  }
  if (!vapid.data?.configured || !vapid.data.publicKey) {
    return <Card><CardContent className="py-4 text-sm text-muted-foreground">{t("rider.pushNotConfigured")}</CardContent></Card>;
  }

  async function enable() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast({ title: t("rider.pushDenied"), variant: "destructive" });
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const key = urlBase64ToUint8Array(vapid.data!.publicKey!);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
      });
      const json = sub.toJSON();
      subscribe.mutate(
        {
          data: {
            endpoint: sub.endpoint,
            keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
            userAgent: navigator.userAgent,
          },
        },
        { onSuccess: () => { setSubscribed(true); toast({ title: t("rider.pushEnable") }); } },
      );
    } catch {
      toast({ title: t("errors.generic"), variant: "destructive" });
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      unsubscribe.mutate(
        { data: { endpoint: sub.endpoint } },
        {
          onSuccess: async () => {
            await sub.unsubscribe();
            setSubscribed(false);
            toast({ title: t("rider.pushDisable") });
          },
        },
      );
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Bell className="size-4" />{t("rider.push")}</CardTitle></CardHeader>
      <CardContent>
        {subscribed ? (
          <Button variant="outline" className="w-full" onClick={disable} disabled={unsubscribe.isPending} data-testid="button-push-disable">
            <BellOff className="size-4 mr-2" />{t("rider.pushDisable")}
          </Button>
        ) : (
          <Button className="w-full" onClick={enable} disabled={subscribe.isPending} data-testid="button-push-enable">
            <Bell className="size-4 mr-2" />{t("rider.pushEnable")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
