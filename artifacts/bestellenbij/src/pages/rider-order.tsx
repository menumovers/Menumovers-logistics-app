import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOrder,
  useTransitionOrderStatus,
  useResumeOrder,
  useUpdatePickupTime,
  useAssignOrder,
  useGetSettingsFlags,
  useGetVapidPublicKey,
  useSubscribePush,
  useUnsubscribePush,
  getGetOrderQueryKey,
  getGetSettingsFlagsQueryKey,
  getGetVapidPublicKeyQueryKey,
  getListOrdersQueryKey,
  type OrderDetail,
  type OrderStatus as OrderStatusType,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/status-badge";
import { PickupCountdown, PickupSourceBadge } from "@/components/pickup-countdown";
import { DeliveryMethodBadge, RequestedTimeLabel } from "@/components/delivery-expectation";
import { PickupTimeInput } from "@/components/pickup-time-input";
import { PaymentPanel } from "@/components/payment-panel";
import { ArrowLeft, Phone, MapPin, Navigation, Bell, BellOff, Store, ChevronRight, Clock, Layers, CheckCircle2, ClipboardList } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { effectivePickup, formatTime } from "@/lib/format";

/**
 * The expected order of events, used purely to pick which button is the big
 * one. This is presentation, not validity — the server decides what is
 * acceptable and sends it as `allowedTransitions`. A rider who is further along
 * than the app thinks can report any of the others from "Report a different
 * step" below. See docs/workflow-decisions.md D1.
 */
const HAPPY_PATH: Partial<Record<OrderStatusType, OrderStatusType>> = {
  rider_assigned: "rider_accepted",
  rider_accepted: "en_route_to_restaurant",
  en_route_to_restaurant: "arrived_at_restaurant",
  arrived_at_restaurant: "picked_up",
  picked_up: "en_route_to_customer",
  en_route_to_customer: "delivered",
};

export default function RiderOrderPage() {
  const { id } = useParams();
  const orderId = id!;
  // Coordinators land here by default from the coordinator overview (see
  // coordinator.tsx); `from=coordinator` on the URL means "back" should
  // return them there instead of the rider's own order list.
  const [searchParams] = useSearchParams();
  const cameFromCoordinator = searchParams.get("from") === "coordinator";
  const order = useGetOrder(orderId, {
    query: { queryKey: getGetOrderQueryKey(orderId), refetchInterval: 30_000, enabled: !!orderId },
  });
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const transition = useTransitionOrderStatus();
  const resume = useResumeOrder();
  const updatePickup = useUpdatePickupTime();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const riderId = user?.riderId ?? undefined;
  const isCoordinator = !!user?.roles.includes("coordinator") || !!user?.roles.includes("admin");

  const [failureReason, setFailureReason] = useState("");
  const [postponeReason, setPostponeReason] = useState("");

  if (order.isLoading || !order.data) {
    return <div className="grid place-items-center py-20"><Spinner className="size-6 text-primary" /></div>;
  }
  const o = order.data;
  // The server only ever returns an order to a rider if it's either theirs
  // or still open for claiming (see orderScopeWhere) — so anything visible
  // here that isn't assigned to this rider is claimable, not someone else's.
  const isMine = !!riderId && o.riderId === riderId;
  const allowed = o.allowedTransitions ?? [];
  const happyNext = HAPPY_PATH[o.status];
  // The primary button only appears when the expected next step is genuinely
  // acceptable; everything else acceptable goes in the secondary list.
  const next = happyNext && allowed.includes(happyNext) ? happyNext : undefined;
  const otherSteps = allowed.filter(
    (s) => s !== next && s !== "failed" && s !== "postponed",
  );

  function invalidate() {
    qc.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
    qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
  }

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={cameFromCoordinator ? "/coordinator" : "/rider"}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          data-testid="link-back-rider"
        >
          <ArrowLeft className="size-4" /> {t("common.back")}
        </Link>
        {isCoordinator ? (
          <Button asChild variant="ghost" size="sm" data-testid="button-open-coordinator-view">
            <Link href={`/coordinator/orders/${orderId}?from=rider`}>
              <ClipboardList className="size-4 mr-1.5" /> {t("rider.coordinatorView")}
            </Link>
          </Button>
        ) : null}
      </div>

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
            <div className="flex flex-col items-end gap-1.5">
              <StatusBadge status={o.status} />
              <DeliveryMethodBadge order={o} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <PickupCountdown order={o} size="lg" />
            <PickupSourceBadge source={effectivePickup(o).source} />
          </div>
          <RequestedTimeLabel order={o} lang={lang} withDate />
          {/* The kitchen's own status. Worth a rider's attention on the way
              there: it says the food is waiting, not when to collect — the
              pickup time above is still the agreed time (D14). */}
          {o.restaurantReadyAt ? (
            <div
              className="flex items-center gap-2 rounded-md border border-chart-5/40 bg-chart-5/10 px-3 py-2 text-sm font-medium text-chart-5"
              data-testid="text-restaurant-ready"
            >
              <CheckCircle2 className="size-4 shrink-0" />
              {t("restaurant.readyAt", { time: formatTime(o.restaurantReadyAt, lang) })}
            </div>
          ) : null}
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2"><Store className="size-4 mt-0.5 text-muted-foreground" /><span className="font-medium">{o.restaurantName}</span></div>
            <div className="border-t border-border pt-2">
              <div className="font-medium">{o.customerName}</div>
              <div className="flex items-start gap-2 text-muted-foreground"><MapPin className="size-3.5 mt-0.5" /><span>{o.deliveryAddress}</span></div>
              {o.deliveryInstructions ? <div className="pl-5 italic text-xs text-muted-foreground">{o.deliveryInstructions}</div> : null}
            </div>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" className="flex-1" data-testid="button-maps-directions">
              <a
                href={`https://www.google.com/maps/dir/${encodeURIComponent(o.restaurantAddress ?? "")}/${encodeURIComponent(o.deliveryAddress)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Navigation className="size-4 mr-2" />{t("rider.mapsDirections")}
              </a>
            </Button>
            <Button asChild variant="outline" className="shrink-0" data-testid="button-call-customer">
              <a href={`tel:${o.customerPhone}`} aria-label={t("rider.callCustomer")}><Phone className="size-4" /></a>
            </Button>
          </div>
          <div className="border-t border-border pt-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{t("coordinator.items")}</div>
            <ul className="text-sm space-y-1">
              {o.items.map((it, i) => (
                <li key={i}>
                  <span className="text-muted-foreground tabular-nums">{it.quantity}× </span>{it.name}
                </li>
              ))}
            </ul>
          </div>
          {o.cashPayment ? (
            <div className="border-t border-border pt-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{t("payment.title")}</div>
              <PaymentPanel order={o} lang={lang} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isMine ? (
        <>
          {o.status === "postponed" ? (
            <Button
              size="lg"
              className="w-full h-16 text-lg font-semibold"
              disabled={resume.isPending}
              onClick={() =>
                resume.mutate(
                  { id: o.id },
                  {
                    onSuccess: () => {
                      toast({ title: t("postpone.resume") });
                      invalidate();
                    },
                  },
                )
              }
              data-testid="button-rider-resume"
            >
              {t("postpone.resume")} <ChevronRight className="size-5 ml-2" />
            </Button>
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

          {otherSteps.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  {t("rider.otherStep")}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {otherSteps.map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    disabled={transition.isPending}
                    onClick={() =>
                      transition.mutate(
                        { id: o.id, data: { toStatus: s } },
                        { onSuccess: () => { toast({ title: t(`orderStatus.${s}`) }); invalidate(); } },
                      )
                    }
                    data-testid={`button-rider-report-${s}`}
                  >
                    {t(`orderStatus.${s}`)}
                  </Button>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {allowed.includes("postponed") ? (
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
            <CardContent>
              <PickupTimeInput
                currentIso={effectivePickup(o).iso}
                pending={updatePickup.isPending}
                submitLabel={t("common.save")}
                onSubmit={(pickupTime) =>
                  updatePickup.mutate(
                    { id: o.id, data: { source: "rider", pickupTime } },
                    { onSuccess: () => { toast({ title: t("rider.suggestPickup") }); invalidate(); } },
                  )
                }
              />
            </CardContent>
          </Card>
        </>
      ) : (
        <ClaimCard order={o} riderId={riderId} onClaimed={invalidate} />
      )}

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

function ClaimCard({ order, riderId, onClaimed }: { order: OrderDetail; riderId: string | undefined; onClaimed: () => void }) {
  const { t } = useTranslation();
  const assign = useAssignOrder();
  const { toast } = useToast();
  // Server is authoritative; the UI just hides the button when self-claim is
  // disabled. While loading, default to false so we don't briefly show an
  // action the server will then refuse.
  const flags = useGetSettingsFlags({
    query: { queryKey: getGetSettingsFlagsQueryKey(), staleTime: 60_000 },
  });
  const allowSelfClaim = flags.data?.allowRiderSelfClaim ?? false;

  function claim() {
    if (!riderId) return;
    assign.mutate(
      { id: order.id, data: { riderId } },
      {
        onSuccess: () => {
          toast({ title: t("rider.claim") });
          onClaimed();
        },
        onError: (err: unknown) => {
          const status =
            typeof err === "object" && err !== null && "status" in err
              ? (err as { status?: number }).status
              : undefined;
          const title = status === 403 ? t("rider.claimUnavailable") : t("errors.generic");
          toast({ title, variant: "destructive" });
        },
      },
    );
  }

  return (
    <Card>
      <CardContent className="py-4">
        {allowSelfClaim ? (
          <Button
            size="lg"
            className="w-full h-16 text-lg font-semibold"
            disabled={!riderId || assign.isPending}
            onClick={claim}
            data-testid={`button-claim-${order.id}`}
          >
            {assign.isPending ? t("rider.claimPending") : t("rider.claim")}
          </Button>
        ) : (
          <p
            className="text-sm text-muted-foreground text-center"
            data-testid={`text-claim-disabled-${order.id}`}
          >
            {t("rider.claimDisabled")}
          </p>
        )}
      </CardContent>
    </Card>
  );
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
