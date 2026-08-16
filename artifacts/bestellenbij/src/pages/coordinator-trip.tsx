import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTrip,
  useUpdateTrip,
  useDissolveTrip,
  useListRiders,
  getGetTripQueryKey,
  getListTripsQueryKey,
  getListOrdersQueryKey,
  getListRidersQueryKey,
  type TripDetail,
  type TripStopWithOrder,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { OrderStatus } from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/status-badge";
import { ArrowLeft, Bike, Check, Home, Store, Layers, Trash2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatTime } from "@/lib/format";
import { tripProgress } from "@/lib/trip-progress";

const UNASSIGNED = "__unassigned__";

export default function CoordinatorTripPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const { id } = useParams();
  const tripId = id!;
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const trip = useGetTrip(tripId, {
    query: { queryKey: getGetTripQueryKey(tripId), refetchInterval: 30_000, enabled: !!tripId },
  });
  const riders = useListRiders({ query: { queryKey: getListRidersQueryKey() } });
  const update = useUpdateTrip();
  const dissolve = useDissolveTrip();
  const [pendingReassign, setPendingReassign] = useState<{
    name: string | null;
    riderId: string | null;
    inFlightOrders: Array<{ id: string; externalOrderId: string; status: OrderStatus }>;
  } | null>(null);

  if (trip.isLoading || !trip.data) {
    return (
      <div className="grid place-items-center py-20">
        <Spinner className="size-6 text-primary" />
      </div>
    );
  }
  const data: TripDetail = trip.data;
  const progress = tripProgress(data);

  function invalidate() {
    qc.invalidateQueries({ queryKey: getGetTripQueryKey(tripId) });
    qc.invalidateQueries({ queryKey: getListTripsQueryKey() });
    qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    qc.invalidateQueries({ queryKey: getListOrdersQueryKey({}) });
  }

  function submitUpdate(name: string | null, riderId: string | null, force: boolean) {
    update.mutate(
      { id: tripId, data: { name, riderId, force } },
      {
        onSuccess: () => {
          toast({ title: t("trip.saved") });
          setPendingReassign(null);
          invalidate();
        },
        onError: (err: unknown) => {
          const e = err as {
            response?: {
              status?: number;
              data?: {
                code?: string;
                details?: {
                  inFlightOrders?: Array<{
                    id: string;
                    externalOrderId: string;
                    status: OrderStatus;
                  }>;
                };
              };
            };
          };
          if (
            e.response?.status === 409 &&
            e.response?.data?.code === "INFLIGHT_REASSIGN_REQUIRES_CONFIRM" &&
            e.response.data.details?.inFlightOrders?.length
          ) {
            setPendingReassign({
              name,
              riderId,
              inFlightOrders: e.response.data.details.inFlightOrders,
            });
            return;
          }
          toast({ title: t("errors.generic"), variant: "destructive" });
        },
      },
    );
  }

  function onDissolve() {
    if (!window.confirm(t("trip.dissolveConfirm"))) return;
    dissolve.mutate(
      { id: tripId },
      {
        onSuccess: () => {
          toast({ title: t("trip.dissolved") });
          invalidate();
          navigate("/coordinator");
        },
        onError: () => toast({ title: t("errors.generic"), variant: "destructive" }),
      },
    );
  }

  return (
    <div className="space-y-5">
      <Link
        href="/coordinator"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {t("common.back")}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("trip.title")}
          </div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Layers className="size-5" />
            {t("trip.tripNumber", { number: data.tripNumber })}
            {data.name ? <span className="text-muted-foreground">· {data.name}</span> : null}
          </h1>
          <div className="text-sm text-muted-foreground mt-1">
            {t(tripStatusKey(data.status))} · {data.orderCount}{" "}
            {t("trip.orders")} · {progress.done}/{progress.total}{" "}
            {t("trip.stops")}
            {progress.skipped > 0
              ? ` · ${t("trip.skippedCount", { count: progress.skipped })}`
              : ""}
          </div>
        </div>
        <Button
          variant="destructive"
          onClick={onDissolve}
          disabled={dissolve.isPending}
          data-testid="button-dissolve-trip"
        >
          <Trash2 className="size-4 mr-2" />
          {t("trip.dissolve")}
        </Button>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Bike className="size-4" /> {t("trip.stops")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-1.5">
                {data.stops.map((s, i) => (
                  <StopRow key={s.id} stop={s} index={i} lang={lang} t={t} />
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("trip.orders")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.orders.map((o) => (
                <Link
                  key={o.id}
                  href={`/coordinator/orders/${o.id}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 hover:border-primary/40"
                  data-testid={`trip-order-${o.id}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">
                      <span className="tabular-nums">#{o.externalOrderId}</span> ·{" "}
                      {o.customerName}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {o.restaurantName} · {o.deliveryAddress}
                    </div>
                  </div>
                  <StatusBadge status={o.status} />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <EditCard
            trip={data}
            riders={(riders.data ?? []).filter(
              (r) => r.availabilityStatus !== "offline" && r.accountStatus === "active",
            )}
            onSave={(name, riderId) => submitUpdate(name, riderId, false)}
            saving={update.isPending}
          />
        </div>
      </div>

      <AlertDialog
        open={pendingReassign != null}
        onOpenChange={(open) => {
          if (!open) setPendingReassign(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-inflight-reassign">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("trip.reassignWarningTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("trip.reassignWarningBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingReassign ? (
            <ul className="space-y-1.5 rounded-md border border-border p-3 text-sm">
              {pendingReassign.inFlightOrders.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between gap-2"
                  data-testid={`inflight-order-${o.id}`}
                >
                  <span className="tabular-nums font-semibold">
                    #{o.externalOrderId}
                  </span>
                  <StatusBadge status={o.status} />
                </li>
              ))}
            </ul>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-reassign-cancel">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingReassign) return;
                submitUpdate(
                  pendingReassign.name,
                  pendingReassign.riderId,
                  true,
                );
              }}
              data-testid="button-reassign-confirm"
            >
              {t("trip.reassignConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StopRow({
  stop,
  index,
  lang,
  t,
}: {
  stop: TripStopWithOrder;
  index: number;
  lang: string;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const isPickup = stop.kind === "pickup";
  const done = stop.state === "done";
  const skipped = stop.state === "skipped";
  const settled = done || skipped;
  return (
    <li
      className={`flex items-center gap-2 rounded-md border border-border px-2 py-2 ${
        settled ? "opacity-60" : ""
      }`}
      data-testid={`trip-stop-${stop.id}`}
      data-stop-state={stop.state}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground tabular-nums">
        {index + 1}
      </span>
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${
          done
            ? "bg-chart-5/15 text-chart-5"
            : skipped
              ? "bg-destructive/10 text-destructive"
              : isPickup
                ? "bg-accent/15 text-accent-foreground"
                : "bg-chart-5/10 text-chart-5"
        }`}
      >
        {done ? (
          <Check className="h-3 w-3" strokeWidth={3} />
        ) : skipped ? (
          <X className="h-3.5 w-3.5" strokeWidth={3} />
        ) : isPickup ? (
          <Store className="h-3.5 w-3.5" />
        ) : (
          <Home className="h-3.5 w-3.5" />
        )}
      </span>
      <div className={`min-w-0 flex-1 ${settled ? "line-through" : ""}`}>
        <div className="text-sm font-medium truncate">
          {isPickup ? t("trip.pickup") : t("trip.dropoff")} ·{" "}
          {isPickup ? stop.restaurantName : stop.customerName}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          #{stop.externalOrderId} · {isPickup ? stop.customerName : stop.deliveryAddress}
        </div>
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatTime(stop.effectivePickupTime, lang)}
      </span>
    </li>
  );
}

function EditCard({
  trip,
  riders,
  onSave,
  saving,
}: {
  trip: TripDetail;
  riders: ReadonlyArray<{ id: string; name: string; availabilityStatus: string; activeOrderCount: number; queuedOrderCount: number }>;
  onSave: (name: string | null, riderId: string | null) => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(trip.name ?? "");
  const [riderId, setRiderId] = useState<string>(trip.riderId ?? UNASSIGNED);
  useEffect(() => {
    setName(trip.name ?? "");
    setRiderId(trip.riderId ?? UNASSIGNED);
  }, [trip.id, trip.name, trip.riderId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("common.edit")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs">{t("trip.name")}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("trip.namePlaceholder")}
            data-testid="input-trip-edit-name"
          />
        </div>
        <div>
          <Label className="text-xs">{t("trip.rider")}</Label>
          <Select value={riderId} onValueChange={setRiderId}>
            <SelectTrigger data-testid="select-trip-edit-rider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>{t("trip.unassigned")}</SelectItem>
              {riders.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name} · {r.activeOrderCount}+{r.queuedOrderCount}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          className="w-full"
          disabled={saving}
          onClick={() => onSave(name.trim() || null, riderId === UNASSIGNED ? null : riderId)}
          data-testid="button-save-trip"
        >
          {t("trip.save")}
        </Button>
      </CardContent>
    </Card>
  );
}

function tripStatusKey(s: TripDetail["status"]): string {
  switch (s) {
    case "planned":
      return "trip.statusPlanned";
    case "in_progress":
      return "trip.statusInProgress";
    case "completed":
      return "trip.statusCompleted";
    case "dissolved":
      return "trip.statusDissolved";
    default:
      return "trip.statusPlanned";
  }
}
