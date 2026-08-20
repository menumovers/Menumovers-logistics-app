import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListOrders,
  useListRiders,
  useCreateTrip,
  getListOrdersQueryKey,
  getListRidersQueryKey,
  getListTripsQueryKey,
  type OrderListItem,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { ArrowLeft, Check, Store, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { effectivePickup, formatTime } from "@/lib/format";

const UNASSIGNED = "__unassigned__";

export default function CoordinatorTripBuilderPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const orders = useListOrders(
    {},
    { query: { queryKey: getListOrdersQueryKey({}), refetchInterval: 30_000 } },
  );
  const riders = useListRiders({
    query: { queryKey: getListRidersQueryKey(), refetchInterval: 30_000 },
  });
  const create = useCreateTrip();

  const candidates = useMemo(() => {
    return (orders.data ?? []).filter(
      (o) =>
        o.tripId == null &&
        (o.status === "pending" ||
          o.status === "rider_assigned" ||
          o.status === "rider_accepted"),
    );
  }, [orders.data]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [riderId, setRiderId] = useState<string>(UNASSIGNED);
  const [name, setName] = useState("");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const onlineRiders = (riders.data ?? []).filter(
    (r) => r.availabilityStatus !== "offline" && r.accountStatus === "active",
  );

  function submit() {
    if (selected.size === 0) return;
    create.mutate(
      {
        data: {
          orderIds: Array.from(selected),
          riderId: riderId === UNASSIGNED ? null : riderId,
          name: name.trim() || null,
        },
      },
      {
        onSuccess: (trip) => {
          toast({ title: t("trip.created") });
          qc.invalidateQueries({ queryKey: getListTripsQueryKey() });
          qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          qc.invalidateQueries({ queryKey: getListOrdersQueryKey({}) });
          navigate(`/coordinator/trips/${trip.id}`);
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
        data-testid="link-back-coordinator"
      >
        <ArrowLeft className="size-4" /> {t("common.back")}
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("nav.coordinator")}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t("trip.newTrip")}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/coordinator">{t("common.cancel")}</Link>
          </Button>
          <Button
            disabled={selected.size === 0 || create.isPending}
            onClick={submit}
            data-testid="button-create-trip"
          >
            <Layers className="size-4 mr-2" />
            {create.isPending
              ? t("trip.createPending")
              : `${t("trip.create")} · ${t("trip.selectedCount", { count: selected.size })}`}
          </Button>
        </div>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("trip.selectOrders")}</CardTitle>
          </CardHeader>
          <CardContent>
            {orders.isLoading ? (
              <div className="grid place-items-center py-10">
                <Spinner className="size-5 text-primary" />
              </div>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {t("trip.noOrdersAvailable")}
              </p>
            ) : (
              <ul className="space-y-2">
                {candidates.map((o) => {
                  const isSelected = selected.has(o.id);
                  return (
                    <li
                      key={o.id}
                      className={`flex items-center gap-3 rounded-md border px-3 py-2.5 cursor-pointer ${
                        isSelected
                          ? "border-primary/40 bg-primary/[0.04]"
                          : "border-border bg-card"
                      }`}
                      onClick={() => toggle(o.id)}
                      data-testid={`builder-order-${o.id}`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background"
                        }`}
                      >
                        {isSelected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-semibold tabular-nums">
                            #{o.externalOrderId}
                          </span>
                          <span className="text-muted-foreground">·</span>
                          <span className="truncate">{o.customerName}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <Store className="h-3 w-3" />
                          <span className="truncate">{o.restaurantName}</span>
                          <span>·</span>
                          <span>{o.items.length} ×</span>
                          <span>·</span>
                          <span className="tabular-nums">
                            {formatTime(effectivePickup(o).iso, lang)}
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("trip.tripNumber", { number: "—" })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-xs">{t("trip.name")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("trip.namePlaceholder")}
                data-testid="input-trip-name"
              />
            </div>
            <div>
              <Label className="text-xs">{t("trip.rider")}</Label>
              <Select value={riderId} onValueChange={setRiderId}>
                <SelectTrigger data-testid="select-trip-rider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>{t("trip.unassigned")}</SelectItem>
                  {onlineRiders.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} · {t(`availability.${r.availabilityStatus}`)} · {r.activeOrderCount}+{r.queuedOrderCount}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-md border border-dashed border-border p-3 text-sm space-y-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("trip.selectedCount", { count: selected.size })}
              </div>
              <ul className="text-sm space-y-1">
                {Array.from(selected).map((id) => {
                  const o = candidates.find((c) => c.id === id);
                  if (!o) return null;
                  return (
                    <SelectedRow key={id} order={o} lang={lang} onRemove={() => toggle(id)} />
                  );
                })}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SelectedRow({
  order,
  lang,
  onRemove,
}: {
  order: OrderListItem;
  lang: string;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-2 text-sm" data-testid={`selected-${order.id}`}>
      <span className="truncate">
        <span className="font-semibold tabular-nums">#{order.externalOrderId}</span>{" "}
        <span className="text-muted-foreground">·</span> {order.restaurantName}{" "}
        <span className="text-muted-foreground">·</span>{" "}
        <span className="tabular-nums text-muted-foreground">
          {formatTime(effectivePickup(order).iso, lang)}
        </span>
      </span>
      <Button variant="ghost" size="sm" onClick={onRemove}>
        ×
      </Button>
    </li>
  );
}
