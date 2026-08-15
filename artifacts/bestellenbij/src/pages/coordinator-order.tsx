import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useGetOrder,
  useAssignOrder,
  useTransitionOrderStatus,
  useUpdatePickupTime,
  useHideOrderItem,
  useAddOrderItem,
  useSetRiderNotification,
  useUpdateOrderContact,
  useHoldOrder,
  useReleaseOrder,
  useListRiders,
  getGetOrderQueryKey,
  getListRidersQueryKey,
  getListOrdersQueryKey,
  type OrderDetail,
  type OrderItem,
  type OrderStatus as OrderStatusType,
  PickupTimeSource,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/status-badge";
import { PickupCountdown, PickupSourceBadge } from "@/components/pickup-countdown";
import { DeliveryMethodBadge, RequestedTimeLabel } from "@/components/delivery-expectation";
import { ArrowLeft, Bike, MapPin, Phone, Mail, Plus, Eye, EyeOff, Bell, History, PauseCircle, PlayCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getOriginalOrderItems, unhideOrderItem } from "@/lib/api";
import { effectivePickup, formatCurrency, formatDateTime, formatTime } from "@/lib/format";

const TRANSITIONS: Record<OrderStatusType, OrderStatusType[]> = {
  pending: ["failed"],
  driver_assigned: ["en_route_to_restaurant", "failed"],
  en_route_to_restaurant: ["picked_up", "postponed", "failed"],
  picked_up: ["en_route_to_customer", "failed"],
  en_route_to_customer: ["delivered", "postponed", "failed"],
  postponed: ["en_route_to_restaurant", "en_route_to_customer", "failed"],
  delivered: [],
  failed: [],
};

export default function CoordinatorOrderPage() {
  const { id } = useParams();
  const orderId = id!;
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const order = useGetOrder(orderId, {
    query: { queryKey: getGetOrderQueryKey(orderId), refetchInterval: 30_000, enabled: !!orderId },
  });

  if (order.isLoading || !order.data) {
    return <div className="grid place-items-center py-20"><Spinner className="size-6 text-primary" /></div>;
  }
  const o = order.data;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/coordinator" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-coordinator">
          <ArrowLeft className="size-4" /> {t("common.back")}
        </Link>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs text-muted-foreground tabular-nums">#{o.externalOrderId}</div>
          <h1 className="text-2xl font-bold tracking-tight">{o.customerName}</h1>
          <div className="text-sm text-muted-foreground">{o.restaurantName}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <DeliveryMethodBadge order={o} />
            <StatusBadge status={o.status} />
          </div>
          <PickupCountdown order={o} size="lg" />
          <RequestedTimeLabel order={o} lang={lang} withDate />
          <span
            className={`text-xs ${o.restaurantAcceptedAt ? "text-chart-5" : "text-muted-foreground"}`}
            data-testid="text-acknowledged"
          >
            {o.restaurantAcceptedAt
              ? t("acknowledge.doneAt", { time: formatTime(o.restaurantAcceptedAt, lang) })
              : t("acknowledge.notYet")}
          </span>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <ItemsCard order={o} />
          <PickupCard order={o} />
          <ContactCard order={o} />
          <NotificationCard order={o} />
          <TimelineCard order={o} />
        </div>
        <div className="space-y-5">
          <HoldCard order={o} />
          <AssignCard order={o} />
          <TransitionCard order={o} />
        </div>
      </div>
    </div>
  );
}

function originalOrderItemsQueryKey(orderId: string) {
  return ["original-order-items", orderId] as const;
}

function useInvalidateOrder(orderId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
    qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    qc.invalidateQueries({ queryKey: originalOrderItemsQueryKey(orderId) });
  };
}

/**
 * Holds are the only thing that blocks dispatch. A parked order is resolved by
 * naming its real restaurant (done from the dispatch board); a deliberate hold
 * is placed and released here.
 */
function HoldCard({ order }: { order: OrderDetail }) {
  const { t } = useTranslation();
  const hold = useHoldOrder();
  const release = useReleaseOrder();
  const invalidate = useInvalidateOrder(order.id);
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const finished = order.status === "delivered" || order.status === "failed";

  if (order.holdState === "parked") {
    return (
      <Card className="border-destructive/40" data-testid="card-hold-parked">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-destructive">
            <PauseCircle className="size-4" /> {t("hold.state_parked")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{t("hold.parkedNotice")}</p>
          {order.holdReason ? <p className="text-xs italic">{order.holdReason}</p> : null}
        </CardContent>
      </Card>
    );
  }

  if (order.holdState === "on_hold") {
    return (
      <Card className="border-accent/50" data-testid="card-hold-active">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <PauseCircle className="size-4" /> {t("hold.state_on_hold")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("hold.heldNotice")}</p>
          {order.holdReason ? (
            <p className="text-xs italic text-muted-foreground">{order.holdReason}</p>
          ) : null}
          {order.heldByUserName ? (
            <p className="text-xs text-muted-foreground">{order.heldByUserName}</p>
          ) : null}
          <Button
            variant="outline"
            className="w-full"
            disabled={release.isPending}
            onClick={() =>
              release.mutate(
                { id: order.id },
                { onSuccess: () => { toast({ title: t("hold.release") }); invalidate(); } },
              )
            }
            data-testid="button-release-hold"
          >
            <PlayCircle className="size-4 mr-2" /> {t("hold.release")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (finished) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <PauseCircle className="size-4" /> {t("hold.hold")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder={t("hold.holdReasonPlaceholder")}
          data-testid="textarea-hold-reason"
        />
        <Button
          variant="secondary"
          className="w-full"
          disabled={hold.isPending}
          onClick={() =>
            hold.mutate(
              { id: order.id, data: { reason: reason.trim() || null } },
              {
                onSuccess: () => {
                  setReason("");
                  toast({ title: t("hold.hold") });
                  invalidate();
                },
              },
            )
          }
          data-testid="button-hold-order"
        >
          {t("hold.hold")}
        </Button>
      </CardContent>
    </Card>
  );
}

function AssignCard({ order }: { order: OrderDetail }) {
  const { t } = useTranslation();
  const riders = useListRiders({ query: { queryKey: getListRidersQueryKey(), refetchInterval: 30_000 } });
  const [riderId, setRiderId] = useState<string>("");
  const assign = useAssignOrder();
  const invalidate = useInvalidateOrder(order.id);
  const { toast } = useToast();
  const candidates = (riders.data ?? []).filter((r) => r.availabilityStatus !== "offline" && r.accountStatus === "active");

  // Not dispatchable: held orders are refused by the server, and customer
  // pickup is never rider work at all. Don't offer an action that will fail.
  if (order.status !== "pending") return null;
  if (order.holdState != null) return null;
  if (order.deliveryMethod === "pickup") return null;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Bike className="size-4" /> {t("coordinator.assignRider")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("coordinator.noOnlineRiders")}</p>
        ) : (
          <>
            <Select value={riderId} onValueChange={setRiderId}>
              <SelectTrigger data-testid="select-rider"><SelectValue placeholder={t("coordinator.selectRider")} /></SelectTrigger>
              <SelectContent>
                {candidates.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name} · {t(`availability.${r.availabilityStatus}`)} · {r.activeOrderCount}+{r.queuedOrderCount}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="w-full"
              disabled={!riderId || assign.isPending}
              onClick={() =>
                assign.mutate(
                  { id: order.id, data: { riderId } },
                  {
                    onSuccess: () => {
                      toast({ title: t("coordinator.assignRider") });
                      invalidate();
                    },
                  },
                )
              }
              data-testid="button-assign-rider"
            >
              {t("coordinator.assignRider")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TransitionCard({ order }: { order: OrderDetail }) {
  const { t } = useTranslation();
  const transition = useTransitionOrderStatus();
  const invalidate = useInvalidateOrder(order.id);
  const [failureReason, setFailureReason] = useState("");
  const targets = TRANSITIONS[order.status];
  const { toast } = useToast();
  if (targets.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="size-4" /> {t("coordinator.transition")}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {targets.includes("failed") ? (
          <Textarea
            placeholder={t("rider.failureReason")}
            value={failureReason}
            onChange={(e) => setFailureReason(e.target.value)}
            rows={2}
            data-testid="textarea-failure-reason"
          />
        ) : null}
        {targets.map((s) => (
          <Button
            key={s}
            variant={s === "failed" ? "destructive" : "default"}
            className="w-full justify-start"
            disabled={transition.isPending || (s === "failed" && failureReason.trim().length === 0)}
            onClick={() =>
              transition.mutate(
                { id: order.id, data: { toStatus: s, failureReason: s === "failed" ? failureReason : null } },
                {
                  onSuccess: () => {
                    toast({ title: t(`orderStatus.${s}`) });
                    invalidate();
                  },
                },
              )
            }
            data-testid={`button-transition-${s}`}
          >
            {t("coordinator.advancePrompt")} · {t(`orderStatus.${s}`)}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

function ItemsCard({ order }: { order: OrderDetail }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const hide = useHideOrderItem();
  const add = useAddOrderItem();
  const invalidate = useInvalidateOrder(order.id);
  const { toast } = useToast();
  const originalItems = useQuery({
    queryKey: originalOrderItemsQueryKey(order.id),
    queryFn: () => getOriginalOrderItems(order.id),
    refetchInterval: 30_000,
  });
  const [pendingUnhideIndex, setPendingUnhideIndex] = useState<number | null>(null);
  const hidden = new Set(
    (order.itemOverrides ?? []).filter((o) => o.type === "hide" && o.itemIndex != null).map((o) => o.itemIndex as number),
  );
  const extras = (order.itemOverrides ?? []).filter((o) => o.type === "add").map((o) => o.addedItem!).filter(Boolean);
  const displayItems: OrderItem[] = originalItems.data?.items ?? order.items;

  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("0.00");
  const [notes, setNotes] = useState("");

  async function unhide(itemIndex: number) {
    setPendingUnhideIndex(itemIndex);
    try {
      await unhideOrderItem(order.id, itemIndex);
      toast({ title: t("coordinator.unhideItem") });
      invalidate();
    } finally {
      setPendingUnhideIndex(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t("coordinator.items")}</CardTitle>
        <span className="text-sm text-muted-foreground tabular-nums">{formatCurrency(order.totalAmount, lang)}</span>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="text-sm divide-y divide-border">
          {displayItems.map((it, i) => {
            const isHidden = hidden.has(i);
            return (
              <li
                key={i}
                className={`flex items-center justify-between py-2 gap-3 ${isHidden ? "bg-muted/40 px-2 -mx-2 rounded-md" : ""}`}
                data-testid={`row-item-${i}`}
              >
                <div className={isHidden ? "text-muted-foreground flex-1" : "flex-1"}>
                  <div className={isHidden ? "line-through" : ""}>
                    <span className="text-muted-foreground tabular-nums">{it.quantity}× </span>
                    {it.name}
                  </div>
                  {it.notes ? <span className="block text-xs text-muted-foreground">{it.notes}</span> : null}
                  {isHidden ? (
                    <span className="mt-1 inline-flex items-center rounded border border-border bg-background px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                      {t("coordinator.hiddenForOthers")}
                    </span>
                  ) : null}
                </div>
                <span className="tabular-nums text-muted-foreground">{formatCurrency(it.price, lang)}</span>
                {!isHidden ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={hide.isPending}
                    onClick={() => hide.mutate({ id: order.id, data: { itemIndex: i } }, { onSuccess: invalidate })}
                    title={t("coordinator.hideItemLabel", { name: it.name })}
                    data-testid={`button-hide-item-${i}`}
                  >
                    <EyeOff className="size-3.5" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pendingUnhideIndex === i}
                    onClick={() => void unhide(i)}
                    title={t("coordinator.unhideItemLabel", { name: it.name })}
                    data-testid={`button-unhide-item-${i}`}
                  >
                    <Eye className="size-3.5" />
                    <span className="sr-only">{t("coordinator.unhideItem")}</span>
                  </Button>
                )}
              </li>
            );
          })}
          {extras.map((it, i) => (
            <li key={`x${i}`} className="flex items-center justify-between py-2 gap-3 text-sm">
              <div className="flex-1">
                <span className="inline-block rounded bg-accent/15 text-accent-foreground text-[10px] uppercase px-1.5 py-0.5 mr-2">{t("coordinator.extra")}</span>
                <span className="text-muted-foreground tabular-nums">{it.quantity}× </span>
                {it.name}
                {it.notes ? <span className="block text-xs text-muted-foreground">{it.notes}</span> : null}
              </div>
              <span className="tabular-nums text-muted-foreground">{formatCurrency(it.price, lang)}</span>
            </li>
          ))}
        </ul>
        <Separator />
        <form
          className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            add.mutate(
              {
                id: order.id,
                data: { item: { name: name.trim(), quantity: Math.max(1, Number(qty) || 1), price, notes: notes.trim() || null } },
              },
              {
                onSuccess: () => {
                  setName(""); setQty("1"); setPrice("0.00"); setNotes("");
                  toast({ title: t("coordinator.addItem") });
                  invalidate();
                },
              },
            );
          }}
        >
          <div className="col-span-2">
            <Label className="text-xs">{t("coordinator.newItemName")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-add-item-name" />
          </div>
          <div>
            <Label className="text-xs">{t("coordinator.newItemQty")}</Label>
            <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} data-testid="input-add-item-qty" />
          </div>
          <div>
            <Label className="text-xs">{t("coordinator.newItemPrice")}</Label>
            <Input value={price} onChange={(e) => setPrice(e.target.value)} data-testid="input-add-item-price" />
          </div>
          <Button type="submit" disabled={add.isPending} data-testid="button-add-item">
            <Plus className="size-4" />{t("coordinator.addItem")}
          </Button>
          <div className="col-span-2 md:col-span-5">
            <Label className="text-xs">{t("coordinator.newItemNotes")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-add-item-notes" />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PickupCard({ order }: { order: OrderDetail }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const update = useUpdatePickupTime();
  const invalidate = useInvalidateOrder(order.id);
  const { toast } = useToast();
  const eff = effectivePickup(order);

  const [source, setSource] = useState<PickupTimeSource>("override");
  const [time, setTime] = useState(formatTime(eff.iso, "en")); // HH:mm

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const [h, m] = time.split(":").map((v) => Number.parseInt(v, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const date = new Date();
    date.setHours(h, m, 0, 0);
    if (date.getTime() < Date.now() - 60_000) date.setDate(date.getDate() + 1);
    update.mutate(
      { id: order.id, data: { source, pickupTime: date.toISOString() } },
      {
        onSuccess: () => {
          toast({ title: t("coordinator.pickupTimes") });
          invalidate();
        },
      },
    );
  }

  const rows: Array<[string, string | null | undefined]> = [
    ["original", order.pickupTimeOriginal],
    ["rider", order.pickupTimeRider],
    ["restaurant", order.pickupTimeRestaurant],
    ["override", order.pickupTimeOverride],
  ];

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("coordinator.pickupTimes")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {rows.map(([k, v]) => {
            const active = eff.source === k;
            return (
              <div key={k} className={`rounded-lg border p-2 ${active ? "border-primary bg-primary/5" : "border-border"}`} data-testid={`pickup-row-${k}`}>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t(`pickup.source_${k}`)}</div>
                <div className="text-sm font-medium tabular-nums">{v ? formatTime(v, lang) : "—"}</div>
              </div>
            );
          })}
        </div>
        <form onSubmit={submit} className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[140px]">
            <Label className="text-xs">{t("pickup.source")}</Label>
            <Select value={source} onValueChange={(v) => setSource(v as PickupTimeSource)}>
              <SelectTrigger data-testid="select-pickup-source"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rider">{t("pickup.source_rider")}</SelectItem>
                <SelectItem value="restaurant">{t("pickup.source_restaurant")}</SelectItem>
                <SelectItem value="override">{t("pickup.source_override")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("coordinator.newPickupTime")}</Label>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="input-pickup-time" />
          </div>
          <Button type="submit" disabled={update.isPending} data-testid="button-save-pickup-time">{t("common.save")}</Button>
          <div className="ml-auto"><PickupSourceBadge source={eff.source} /></div>
        </form>
      </CardContent>
    </Card>
  );
}

function ContactCard({ order }: { order: OrderDetail }) {
  const { t } = useTranslation();
  const update = useUpdateOrderContact();
  const invalidate = useInvalidateOrder(order.id);
  const [name, setName] = useState(order.customerName);
  const [phone, setPhone] = useState(order.customerPhone);
  const [email, setEmail] = useState(order.customerEmail ?? "");
  const [addr, setAddr] = useState(order.deliveryAddress);
  const [instr, setInstr] = useState(order.deliveryInstructions ?? "");
  const { toast } = useToast();
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("coordinator.contact")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label className="text-xs">{t("common.name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-contact-name" /></div>
          <div><Label className="text-xs">{t("common.phone")}</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-contact-phone" /></div>
          <div><Label className="text-xs">{t("common.email")}</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-contact-email" /></div>
          <div><Label className="text-xs">{t("common.address")}</Label><Input value={addr} onChange={(e) => setAddr(e.target.value)} data-testid="input-contact-address" /></div>
          <div className="md:col-span-2"><Label className="text-xs">{t("common.notes")}</Label><Textarea value={instr} onChange={(e) => setInstr(e.target.value)} rows={2} data-testid="textarea-contact-instructions" /></div>
        </div>
        <Button
          onClick={() =>
            update.mutate(
              {
                id: order.id,
                data: {
                  customerName: name,
                  customerPhone: phone,
                  customerEmail: email || null,
                  deliveryAddress: addr,
                  deliveryInstructions: instr || null,
                },
              },
              {
                onSuccess: () => { toast({ title: t("coordinator.updateContact") }); invalidate(); },
              },
            )
          }
          disabled={update.isPending}
          data-testid="button-update-contact"
        >
          {t("coordinator.updateContact")}
        </Button>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-2">
          <span className="inline-flex items-center gap-1"><Phone className="size-3" />{order.customerPhone}</span>
          {order.customerEmail ? <span className="inline-flex items-center gap-1"><Mail className="size-3" />{order.customerEmail}</span> : null}
          <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{order.deliveryAddress}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function NotificationCard({ order }: { order: OrderDetail }) {
  const { t } = useTranslation();
  const set = useSetRiderNotification();
  const invalidate = useInvalidateOrder(order.id);
  const [msg, setMsg] = useState(order.pendingRiderNotification ?? "");
  const { toast } = useToast();
  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Bell className="size-4" />{t("coordinator.notification")}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder={t("coordinator.notificationPlaceholder")}
          rows={2}
          data-testid="textarea-rider-notification"
        />
        <div className="flex gap-2">
          <Button
            onClick={() =>
              set.mutate(
                { id: order.id, data: { message: msg.trim() || null } },
                { onSuccess: () => { toast({ title: t("coordinator.saveNotification") }); invalidate(); } },
              )
            }
            disabled={set.isPending}
            data-testid="button-save-notification"
          >
            {t("coordinator.saveNotification")}
          </Button>
          {order.pendingRiderNotification ? (
            <Button
              variant="ghost"
              onClick={() => {
                setMsg("");
                set.mutate({ id: order.id, data: { message: null } }, { onSuccess: invalidate });
              }}
              data-testid="button-clear-notification"
            >
              {t("coordinator.clearNotification")}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function TimelineCard({ order }: { order: OrderDetail }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("coordinator.auditTrail")}</CardTitle></CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {order.statusLog.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3" data-testid={`log-${entry.id}`}>
              <div className="size-2 rounded-full bg-primary mt-2" />
              <div className="flex-1">
                <div className="text-sm font-medium">{t(`orderStatus.${entry.toStatus}`)}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDateTime(entry.createdAt, lang)}
                  {entry.actorUserName ? <> · {entry.actorUserName}</> : null}
                  {entry.actorRole ? <> ({t(`roles.${entry.actorRole}`)})</> : null}
                </div>
                {entry.note ? <div className="text-xs italic text-muted-foreground">{entry.note}</div> : null}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
