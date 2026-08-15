import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListOrders,
  useListRiders,
  useSetOwnAvailability,
  useAssignOrder,
  useGetSettingsFlags,
  getGetSettingsFlagsQueryKey,
  getListOrdersQueryKey,
  getListRidersQueryKey,
  getGetCurrentUserQueryKey,
  RiderAvailability,
  type OrderListItem,
  type RiderAvailability as RiderAvailabilityType,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PickupCountdown } from "@/components/pickup-countdown";
import { DeliveryMethodBadge, RequestedTimeLabel } from "@/components/delivery-expectation";
import { PaymentBadge } from "@/components/payment-panel";
import { useAuth } from "@/lib/auth";
import { Bike, MapPin, Phone, Bell, ChevronRight, Store } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const ACTIVE_STATUSES: ReadonlyArray<OrderListItem["status"]> = [
  "en_route_to_restaurant",
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

  const all = orders.data ?? [];
  const mine = all.filter((o) => o.riderId === riderId);
  const active = mine.filter((o) => ACTIVE_STATUSES.includes(o.status));
  const queue = mine.filter((o) => o.status === "driver_assigned");
  const open = all.filter((o) => o.status === "pending" && !o.riderId);

  // Server is authoritative; the UI just hides the button when self-claim
  // is disabled. While loading, default to false so we don't briefly show
  // an action that the server will then refuse.
  const flags = useGetSettingsFlags({
    query: { queryKey: getGetSettingsFlagsQueryKey(), staleTime: 60_000 },
  });
  const allowSelfClaim = flags.data?.allowRiderSelfClaim ?? false;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t("rider.title")}</h1>
      </header>
      <AvailabilityCard />

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
              <OpenOrderCard
                key={o.id}
                order={o}
                riderId={riderId}
                allowSelfClaim={allowSelfClaim}
                lang={lang}
              />
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

function AvailabilityCard() {
  const { t } = useTranslation();
  const set = useSetOwnAvailability();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const riderId = user?.riderId ?? undefined;
  const ridersQuery = useListRiders({
    query: {
      queryKey: getListRidersQueryKey(),
      enabled: !!riderId,
      refetchInterval: 30_000,
    },
  });
  const current: RiderAvailabilityType | undefined = riderId
    ? ridersQuery.data?.find((r) => r.id === riderId)?.availabilityStatus
    : undefined;

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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{t("rider.availability")}</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2">
          {opts.map((a) => {
            const active = current === a;
            return (
              <Button
                key={a}
                onClick={() => setAvail(a)}
                disabled={set.isPending}
                variant={active ? "default" : "outline"}
                className={cn(
                  "h-14 text-base font-semibold capitalize",
                  active && a === "online" && "bg-chart-5 text-white hover:bg-chart-5",
                  active && a === "backup" && "bg-accent text-accent-foreground hover:bg-accent",
                )}
                data-testid={`button-availability-${a}`}
              >
                {t(`availability.${a}`)}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function RiderOrderCard({ order, lang }: { order: OrderListItem; lang: string }) {
  return (
    <motion.div variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
      <Link href={`/rider/orders/${order.id}`}>
        <Card
          className="hover:border-primary/40 hover:shadow-md transition cursor-pointer h-full"
          data-testid={`card-rider-order-${order.id}`}
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs text-muted-foreground tabular-nums">#{order.externalOrderId}</div>
                <div className="font-semibold flex items-center gap-1.5">
                  <Store className="size-3.5 text-muted-foreground" />
                  {order.restaurantName}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <StatusBadge status={order.status} />
                <DeliveryMethodBadge order={order} />
                <PaymentBadge order={order} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <PickupCountdown order={order} size="lg" />
              <ChevronRight className="size-5 text-muted-foreground" />
            </div>
            <RequestedTimeLabel order={order} lang={lang} />
            <div className="text-sm space-y-1">
              <div className="font-medium">{order.customerName}</div>
              <div className="flex items-start gap-1.5 text-muted-foreground">
                <MapPin className="size-3.5 mt-0.5" />
                {order.deliveryAddress}
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Phone className="size-3.5" />
                <span className="tabular-nums">{order.customerPhone}</span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Bike className="size-3.5" />
                {order.items.length} ×
              </div>
            </div>
            {order.pendingRiderNotification ? (
              <div className="flex items-start gap-2 rounded-md bg-accent/15 border border-accent/40 p-2 text-sm text-accent-foreground">
                <Bell className="size-4 mt-0.5 shrink-0" />
                <span>{order.pendingRiderNotification}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}

function OpenOrderCard({
  order,
  riderId,
  allowSelfClaim,
  lang,
}: {
  order: OrderListItem;
  riderId: string | undefined;
  allowSelfClaim: boolean;
  lang: string;
}) {
  const { t } = useTranslation();
  const assign = useAssignOrder();
  const qc = useQueryClient();
  const { toast } = useToast();

  function claim() {
    if (!riderId) return;
    assign.mutate(
      { id: order.id, data: { riderId } },
      {
        onSuccess: () => {
          toast({ title: t("rider.claim") });
          qc.invalidateQueries({ queryKey: getListOrdersQueryKey({}) });
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
    <motion.div variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
      <Card
        className="border-dashed h-full"
        data-testid={`card-open-order-${order.id}`}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs text-muted-foreground tabular-nums">#{order.externalOrderId}</div>
              <div className="font-semibold flex items-center gap-1.5">
                <Store className="size-3.5 text-muted-foreground" />
                {order.restaurantName}
              </div>
            </div>
            <StatusBadge status={order.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <PickupCountdown order={order} size="lg" />
            <DeliveryMethodBadge order={order} />
          </div>
          <RequestedTimeLabel order={order} lang={lang} />
          <div className="text-sm space-y-1">
            <div className="font-medium">{order.customerName}</div>
            <div className="flex items-start gap-1.5 text-muted-foreground">
              <MapPin className="size-3.5 mt-0.5" />
              {order.deliveryAddress}
            </div>
          </div>
          {allowSelfClaim ? (
            <Button
              className="w-full h-12 text-base font-semibold"
              disabled={!riderId || assign.isPending}
              onClick={claim}
              data-testid={`button-claim-${order.id}`}
            >
              {assign.isPending ? t("rider.claimPending") : t("rider.claim")}
            </Button>
          ) : (
            <p
              className="text-xs text-muted-foreground text-center"
              data-testid={`text-claim-disabled-${order.id}`}
            >
              {t("rider.claimDisabled")}
            </p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
