import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  useListOrders,
  useListRestaurants,
  useListRiders,
  getListOrdersQueryKey,
  getListRestaurantsQueryKey,
  getListRidersQueryKey,
  OrderStatus,
  type OrderListItem,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/status-badge";
import { PickupCountdown, PickupSourceBadge } from "@/components/pickup-countdown";
import { effectivePickup, formatCurrency } from "@/lib/format";
import { Bike, MapPin, Phone, Bell, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";

const ALL = "__all__";

export default function CoordinatorPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const [status, setStatus] = useState<string>(ALL);
  const [restaurantId, setRestaurantId] = useState<string>(ALL);
  const [riderId, setRiderId] = useState<string>(ALL);
  const [q, setQ] = useState("");

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (status !== ALL) p.status = status;
    if (restaurantId !== ALL) p.restaurantId = restaurantId;
    if (riderId !== ALL) p.riderId = riderId;
    if (q.trim()) p.q = q.trim();
    return p;
  }, [status, restaurantId, riderId, q]);

  const orders = useListOrders(params, {
    query: { queryKey: getListOrdersQueryKey(params), refetchInterval: 30_000 },
  });
  const restaurants = useListRestaurants({ query: { queryKey: getListRestaurantsQueryKey() } });
  const riders = useListRiders({ query: { queryKey: getListRidersQueryKey() } });

  const list = orders.data ?? [];

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("coordinator.title")}</h1>
          <p className="text-muted-foreground text-sm">{t("coordinator.subtitle")}</p>
        </div>
        <div className="text-sm text-muted-foreground tabular-nums" data-testid="text-orders-count">
          {t("coordinator.ordersCount", { count: list.length })}
        </div>
      </header>

      <Card>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 py-4">
          <div className="md:col-span-1">
            <Label className="text-xs text-muted-foreground">{t("common.search")}</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("coordinator.searchPlaceholder")}
              data-testid="input-search"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("coordinator.filterStatus")}</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger data-testid="select-filter-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("common.all")}</SelectItem>
                {Object.values(OrderStatus).map((s) => (
                  <SelectItem key={s} value={s}>{t(`orderStatus.${s}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("coordinator.filterRestaurant")}</Label>
            <Select value={restaurantId} onValueChange={setRestaurantId}>
              <SelectTrigger data-testid="select-filter-restaurant"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("common.all")}</SelectItem>
                {(restaurants.data ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("coordinator.filterRider")}</Label>
            <Select value={riderId} onValueChange={setRiderId}>
              <SelectTrigger data-testid="select-filter-rider"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("common.all")}</SelectItem>
                {(riders.data ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {orders.isLoading ? (
        <div className="grid place-items-center py-20"><Spinner className="size-6 text-primary" /></div>
      ) : list.length === 0 ? (
        <Card><CardContent className="py-20 text-center text-muted-foreground">{t("coordinator.empty")}</CardContent></Card>
      ) : (
        <motion.div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.04 } } }}>
          {list.map((o) => (
            <OrderCard key={o.id} order={o} lang={lang} />
          ))}
        </motion.div>
      )}
    </div>
  );
}

function OrderCard({ order, lang }: { order: OrderListItem; lang: string }) {
  const { t } = useTranslation();
  const eff = effectivePickup(order);
  return (
    <motion.div variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
      <Link href={`/coordinator/orders/${order.id}`}>
        <Card
          className="hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 transition cursor-pointer group h-full"
          data-testid={`card-order-${order.id}`}
        >
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground tabular-nums">#{order.externalOrderId}</div>
                <div className="font-semibold truncate" data-testid={`text-customer-${order.id}`}>{order.customerName}</div>
                <div className="text-xs text-muted-foreground truncate">{order.restaurantName}</div>
              </div>
              <StatusBadge status={order.status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <PickupCountdown order={order} />
              <PickupSourceBadge source={eff.source} />
            </div>
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="size-3.5 mt-0.5 shrink-0" />
              <span className="line-clamp-2">{order.deliveryAddress}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Phone className="size-3.5 shrink-0" />
              <span className="tabular-nums">{order.customerPhone}</span>
            </div>
            <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
              <span className="text-muted-foreground">
                {order.items.length} × · <span className="tabular-nums">{formatCurrency(order.totalAmount, lang)}</span>
              </span>
              <span className="flex items-center gap-1.5 text-foreground">
                {order.riderName ? (
                  <><Bike className="size-3.5" /> <span className="font-medium">{order.riderName}</span></>
                ) : (
                  <span className="text-muted-foreground italic">{t("common.none")}</span>
                )}
              </span>
            </div>
            {order.pendingRiderNotification ? (
              <div className="flex items-start gap-2 text-xs rounded-md bg-accent/10 border border-accent/30 p-2 text-accent-foreground">
                <Bell className="size-3.5 mt-0.5 shrink-0" />
                <span className="line-clamp-2">{order.pendingRiderNotification}</span>
              </div>
            ) : null}
            <div className="flex justify-end -mb-1">
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}
