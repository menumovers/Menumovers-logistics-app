import { useTranslation } from "react-i18next";
import { Link, useParams } from "wouter";
import {
  useGetTrip,
  getGetTripQueryKey,
  type TripDetail,
  type TripStopWithOrder,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/status-badge";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Home,
  Layers,
  MapPin,
  Phone,
  Store,
  X,
} from "lucide-react";
import { formatTime } from "@/lib/format";
import { tripProgress } from "@/lib/trip-progress";

/**
 * The rider's view of a trip: the stops, in the order the coordinator planned
 * them, and which one is next.
 *
 * There is nothing to tick off here. A stop's state comes from its order's
 * status (D6), which the rider already advances from the order screen — so
 * every action lives one tap away on that screen rather than being duplicated
 * here where the two could disagree.
 */
export default function RiderTripPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const { id } = useParams();
  const tripId = id!;

  const trip = useGetTrip(tripId, {
    query: {
      queryKey: getGetTripQueryKey(tripId),
      refetchInterval: 30_000,
      enabled: !!tripId,
    },
  });

  if (trip.isLoading || !trip.data) {
    return (
      <div className="grid place-items-center py-20">
        <Spinner className="size-6 text-primary" />
      </div>
    );
  }
  const data: TripDetail = trip.data;
  const progress = tripProgress(data);
  const stops = [...data.stops].sort((a, b) => a.sequence - b.sequence);
  const next = stops.find((s) => s.state === "upcoming");

  return (
    <div className="space-y-5">
      <Link
        href="/rider"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {t("common.back")}
      </Link>

      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {t("trip.title")}
        </div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Layers className="size-5" />
          {t("trip.tripNumber", { number: data.tripNumber })}
          {data.name ? <span className="text-muted-foreground">· {data.name}</span> : null}
        </h1>
        <div className="mt-2 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${progress.pct}%` }}
              data-testid="rider-trip-progress-bar"
            />
          </div>
          <span
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
            data-testid="rider-trip-progress"
          >
            {t("trip.progress", { done: progress.done, total: progress.total })}
            {progress.skipped > 0
              ? ` · ${t("trip.skippedCount", { count: progress.skipped })}`
              : ""}
          </span>
        </div>
      </header>

      {next ? (
        <Card className="border-primary/50" data-testid="card-next-stop">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("trip.next")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <NextStop stop={next} lang={lang} />
          </CardContent>
        </Card>
      ) : (
        <Card data-testid="card-trip-done">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("trip.allStopsDone")}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("trip.stops")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-1.5">
            {stops.map((s, i) => (
              <StopRow
                key={s.id}
                stop={s}
                index={i}
                isNext={next?.id === s.id}
                lang={lang}
              />
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function placeOf(stop: TripStopWithOrder): { name: string; address: string; phone: string } {
  return stop.kind === "pickup"
    ? { name: stop.restaurantName, address: stop.restaurantAddress, phone: "" }
    : { name: stop.customerName, address: stop.deliveryAddress, phone: stop.customerPhone };
}

function NextStop({ stop, lang }: { stop: TripStopWithOrder; lang: string }) {
  const { t } = useTranslation();
  const isPickup = stop.kind === "pickup";
  const place = placeOf(stop);
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-lg font-semibold">
            {isPickup ? <Store className="size-4" /> : <Home className="size-4" />}
            {isPickup ? t("trip.pickup") : t("trip.dropoff")}
          </div>
          <div className="font-medium">{place.name}</div>
          {place.address ? (
            <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin className="size-3.5 mt-0.5 shrink-0" />
              {place.address}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge status={stop.orderStatus} />
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatTime(stop.effectivePickupTime, lang)}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild className="h-12 flex-1 text-base font-semibold">
          <Link href={`/rider/orders/${stop.orderId}`} data-testid="button-next-stop-order">
            #{stop.externalOrderId}
            <ChevronRight className="size-4 ml-1" />
          </Link>
        </Button>
        {place.phone ? (
          <Button asChild variant="outline" className="h-12">
            <a href={`tel:${place.phone}`} data-testid="button-next-stop-call">
              <Phone className="size-4 mr-2" />
              {t("rider.callCustomer")}
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function StopRow({
  stop,
  index,
  isNext,
  lang,
}: {
  stop: TripStopWithOrder;
  index: number;
  isNext: boolean;
  lang: string;
}) {
  const { t } = useTranslation();
  const isPickup = stop.kind === "pickup";
  const done = stop.state === "done";
  const skipped = stop.state === "skipped";
  const settled = done || skipped;
  const place = placeOf(stop);
  return (
    <li data-testid={`rider-trip-stop-${stop.id}`} data-stop-state={stop.state}>
      <Link
        href={`/rider/orders/${stop.orderId}`}
        className={`flex items-center gap-2 rounded-md border px-2 py-2 hover:border-primary/50 ${
          isNext ? "border-primary/50 bg-primary/[0.04]" : "border-border"
        } ${settled ? "opacity-60" : ""}`}
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
            {isPickup ? t("trip.pickup") : t("trip.dropoff")} · {place.name}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            #{stop.externalOrderId}
            {place.address ? ` · ${place.address}` : ""}
          </div>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatTime(stop.effectivePickupTime, lang)}
        </span>
      </Link>
    </li>
  );
}
