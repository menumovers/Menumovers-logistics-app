import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  useListOrders,
  useSetOwnAvailability,
  getListOrdersQueryKey,
  getGetCurrentUserQueryKey,
  RiderAvailability,
  type OrderListItem,
  type RiderAvailability as RiderAvailabilityType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PickupCountdown } from "@/components/pickup-countdown";
import { useAuth } from "@/lib/auth";
import { Bike, MapPin, Phone, Bell, ChevronRight, Store } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export default function RiderPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const riderId = user?.riderId ?? undefined;
  const orders = useListOrders(
    { riderId },
    { query: { queryKey: getListOrdersQueryKey({ riderId }), refetchInterval: 30_000, enabled: !!riderId } },
  );
  const list = (orders.data ?? []).filter((o) => o.status !== "delivered" && o.status !== "failed");

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t("rider.title")}</h1>
      </header>
      <AvailabilityCard />
      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">{t("rider.myOrders")}</h2>
        {list.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground">{t("rider.noOrders")}</CardContent></Card>
        ) : (
          <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }} className="grid gap-4 md:grid-cols-2">
            {list.map((o) => <RiderOrderCard key={o.id} order={o} />)}
          </motion.div>
        )}
      </section>
    </div>
  );
}

function AvailabilityCard() {
  const { t } = useTranslation();
  const set = useSetOwnAvailability();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const current = (user as unknown as { availabilityStatus?: RiderAvailabilityType })?.availabilityStatus;

  function setAvail(a: RiderAvailabilityType) {
    set.mutate(
      { data: { availabilityStatus: a } },
      {
        onSuccess: () => {
          toast({ title: t(`availability.${a}`) });
          qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        },
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
                className={cn("h-14 text-base font-semibold capitalize", active && a === "online" && "bg-chart-5 text-white hover:bg-chart-5", active && a === "backup" && "bg-accent text-accent-foreground hover:bg-accent")}
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

function RiderOrderCard({ order }: { order: OrderListItem }) {
  return (
    <motion.div variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
      <Link href={`/rider/orders/${order.id}`}>
        <Card className="hover:border-primary/40 hover:shadow-md transition cursor-pointer h-full" data-testid={`card-rider-order-${order.id}`}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs text-muted-foreground tabular-nums">#{order.externalOrderId}</div>
                <div className="font-semibold flex items-center gap-1.5"><Store className="size-3.5 text-muted-foreground" />{order.restaurantName}</div>
              </div>
              <StatusBadge status={order.status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <PickupCountdown order={order} size="lg" />
              <ChevronRight className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm space-y-1">
              <div className="font-medium">{order.customerName}</div>
              <div className="flex items-start gap-1.5 text-muted-foreground"><MapPin className="size-3.5 mt-0.5" />{order.deliveryAddress}</div>
              <div className="flex items-center gap-1.5 text-muted-foreground"><Phone className="size-3.5" /><span className="tabular-nums">{order.customerPhone}</span></div>
              <div className="flex items-center gap-1.5 text-muted-foreground"><Bike className="size-3.5" />{order.items.length} ×</div>
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
