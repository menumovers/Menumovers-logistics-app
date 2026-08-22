import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListOrders,
  useListTrips,
  useSetOwnAvailability,
  getListOrdersQueryKey,
  getListTripsQueryKey,
  getGetCurrentUserQueryKey,
  RiderAvailability,
  type OrderListItem,
  type TripListItem,
  type RiderAvailability as RiderAvailabilityType,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PickupCountdown } from "@/components/pickup-countdown";
import { PickupTimeTypeIcon } from "@/components/delivery-expectation";
import { useAuth } from "@/lib/auth";
import { ArrowRight, ChevronRight, Layers } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { tripProgress } from "@/lib/trip-progress";
import { comparePickupTime, effectivePickup, formatTime } from "@/lib/format";

const AVAILABILITY_BG: Record<RiderAvailabilityType, string> = {
  online: "bg-[#E2F0D9]",
  offline: "bg-[#A0CFD7]",
  backup: "bg-[#FFF2CC]",
};

const ACTIVE_STATUSES: ReadonlyArray<OrderListItem["status"]> = [
  "en_route_to_restaurant",
  "arrived_at_restaurant",
  "picked_up",
  "en_route_to_customer",
  "postponed",
];

export default function RiderPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const { user } = useAuth();
  const riderId = user?.riderId ?? undefined;

  const orders = useListOrders(
    {},
    {
      query: {
        queryKey: getListOrdersQueryKey({}),
        refetchInterval: 30_000,
        enabled: !!riderId,
      },
    },
  );

  // The server already scopes /trips to the calling rider; the status filter
  // keeps dissolved and finished trips off the dashboard.
  const trips = useListTrips(undefined, {
    query: {
      queryKey: getListTripsQueryKey(),
      refetchInterval: 30_000,
      enabled: !!riderId,
    },
  });
  const myTrips = (trips.data ?? []).filter(
    (tr) => tr.status === "planned" || tr.status === "in_progress",
  );

  const all = [...(orders.data ?? [])].sort(comparePickupTime);
  const mine = all.filter((o) => o.riderId === riderId);
  const active = mine.filter((o) => ACTIVE_STATUSES.includes(o.status));
  const queue = mine.filter(
    (o) => o.status === "rider_assigned" || o.status === "rider_accepted",
  );
  const open = all.filter((o) => o.status === "pending" && !o.riderId);

  return (
    <div className="space-y-6">
      <AvailabilityRow />

      {myTrips.length > 0 ? (
        <Section title={t("trip.tripsSection")} count={myTrips.length} testId="section-trips">
          <div className="space-y-2">
            {myTrips.map((tr) => (
              <RiderTripRow key={tr.id} trip={tr} />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title={t("rider.sectionActive")} count={active.length} testId="section-active">
        {active.length === 0 ? (
          <EmptyState text={t("rider.sectionActiveEmpty")} />
        ) : (
          <Grid>
            {active.map((o) => (
              <RiderOrderCard key={o.id} order={o} lang={lang} />
            ))}
          </Grid>
        )}
      </Section>

      <Section title={t("rider.sectionQueue")} count={queue.length} testId="section-queue">
        {queue.length === 0 ? (
          <EmptyState text={t("rider.sectionQueueEmpty")} />
        ) : (
          <Grid>
            {queue.map((o) => (
              <RiderOrderCard key={o.id} order={o} lang={lang} />
            ))}
          </Grid>
        )}
      </Section>

      <Section title={t("rider.sectionOpen")} count={open.length} testId="section-open">
        {open.length === 0 ? (
          <EmptyState text={t("rider.sectionOpenEmpty")} />
        ) : (
          <Grid>
            {open.map((o) => (
              <RiderOrderCard key={o.id} order={o} lang={lang} />
            ))}
          </Grid>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  count,
  testId,
  children,
}: {
  title: string;
  count: number;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section data-testid={testId}>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{title}</h2>
        <span className="text-xs text-muted-foreground tabular-nums" data-testid={`${testId}-count`}>
          {count}
        </span>
      </div>
      {children}
    </section>
  );
}

function RiderTripRow({ trip }: { trip: TripListItem }) {
  const { t } = useTranslation();
  const { done, total, skipped, pct } = tripProgress(trip);
  return (
    <Link href={`/rider/trips/${trip.id}`}>
      <div
        className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/[0.04] px-3 py-3 hover:border-primary/60"
        data-testid={`rider-trip-row-${trip.id}`}
      >
        <Layers className="size-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold tabular-nums">
            {t("trip.tripNumber", { number: trip.tripNumber })}
            {trip.name ? (
              <span className="ml-2 font-normal text-muted-foreground">{trip.name}</span>
            ) : null}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {t("trip.progress", { done, total })}
            {skipped > 0 ? ` · ${t("trip.skippedCount", { count: skipped })}` : ""}
          </div>
        </div>
        <div className="hidden sm:block h-1.5 w-24 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <ChevronRight className="size-4 text-muted-foreground shrink-0" />
      </div>
    </Link>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.04 } } }}
      className="grid gap-4 md:grid-cols-2"
    >
      {children}
    </motion.div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}

function AvailabilityRow() {
  const { t } = useTranslation();
  const set = useSetOwnAvailability();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const current: RiderAvailabilityType | undefined = user?.availabilityStatus ?? undefined;

  function setAvail(a: RiderAvailabilityType) {
    set.mutate(
      { data: { availabilityStatus: a } },
      {
        onSuccess: () => {
          toast({ title: t(`availability.${a}`) });
          qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        },
        onError: () => toast({ title: t("errors.generic"), variant: "destructive" }),
      },
    );
  }
  const opts: RiderAvailabilityType[] = Object.values(RiderAvailability);

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium",
          current ? AVAILABILITY_BG[current] : "bg-muted text-muted-foreground",
        )}
        data-testid="text-availability-current"
      >
        {current ? t(`availability.${current}`) : "—"}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={set.isPending}
            data-testid="button-change-availability"
          >
            {t("rider.changeAvailability")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {opts.map((a) => (
            <DropdownMenuItem
              key={a}
              onClick={() => setAvail(a)}
              data-testid={`option-availability-${a}`}
            >
              {t(`availability.${a}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function RiderOrderCard({ order, lang }: { order: OrderListItem; lang: string }) {
  const { t } = useTranslation();
  const eff = effectivePickup(order);
  return (
    <motion.div variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
      <Link href={`/rider/orders/${order.id}`}>
        <Card
          className="hover:border-primary/40 hover:shadow-md transition cursor-pointer"
          data-testid={`card-rider-order-${order.id}`}
        >
          <CardContent className="py-4 space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <PickupCountdown order={order} size="lg" />
              <span className="font-semibold text-right">{order.restaurantName}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <PickupTimeTypeIcon deliveryTimeType={order.deliveryTimeType} />
                {t("rider.pickupCompact")} {formatTime(eff.iso, lang)}
              </span>
              <span className="flex items-center gap-1 text-right">
                <ArrowRight className="size-3.5 shrink-0" />
                {order.deliveryAddress}
              </span>
            </div>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}
