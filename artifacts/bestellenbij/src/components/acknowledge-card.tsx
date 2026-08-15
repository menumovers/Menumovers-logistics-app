import { useTranslation } from "react-i18next";
import {
  useAcknowledgeOrder,
  type OrderListItem,
  type RestaurantAcceptanceMode,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { effectivePickup, formatTime } from "@/lib/format";

/**
 * The restaurant's acknowledgement: "we've seen this order and its pickup time."
 *
 * A read receipt, not a gate. Nothing waits on it — the delivery team sees and
 * works the order before and without it. See docs/workflow-decisions.md D3.
 *
 * Two modes, set per restaurant by an admin or coordinator. Both record the
 * same acknowledgement; they differ only in what the restaurant is asked. The
 * `choose_time` variant writes `pickupTimeRestaurant` through the same path an
 * explicit pickup-time update uses, so acknowledgement adds no second
 * mechanism for changing the schedule.
 */

/** How far either side of the proposed time the alternatives sit. */
export const ACKNOWLEDGE_OFFSET_MINUTES = 10;

export function AcknowledgeCard({
  order,
  mode,
  lang,
  onDone,
}: {
  order: OrderListItem;
  mode: RestaurantAcceptanceMode;
  lang: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const acknowledge = useAcknowledgeOrder();
  const { toast } = useToast();

  if (order.restaurantAcceptedAt) {
    return (
      <div
        className="flex items-center gap-1.5 text-xs text-chart-5"
        data-testid={`ack-done-${order.id}`}
      >
        <CheckCircle2 className="size-3.5" />
        <span>
          {t("acknowledge.doneAt", { time: formatTime(order.restaurantAcceptedAt, lang) })}
        </span>
        {order.restaurantAcceptedByName ? (
          <span className="text-muted-foreground">
            {t("acknowledge.confirmedBy", { name: order.restaurantAcceptedByName })}
          </span>
        ) : null}
      </div>
    );
  }

  function submit(pickupTime: string | null) {
    acknowledge.mutate(
      { id: order.id, data: { pickupTime } },
      {
        onSuccess: () => {
          toast({ title: t("acknowledge.toast") });
          onDone();
        },
        onError: () => toast({ title: t("errors.generic"), variant: "destructive" }),
      },
    );
  }

  const proposedIso = effectivePickup(order).iso;

  function shifted(minutes: number): string | null {
    if (!proposedIso) return null;
    return new Date(new Date(proposedIso).getTime() + minutes * 60_000).toISOString();
  }

  if (mode === "accept") {
    return (
      <div className="space-y-2 border-t border-border pt-3" data-testid={`ack-accept-${order.id}`}>
        <p className="text-xs text-muted-foreground">{t("acknowledge.prompt")}</p>
        <Button
          className="w-full"
          disabled={acknowledge.isPending}
          onClick={() => submit(null)}
          data-testid={`button-acknowledge-${order.id}`}
        >
          <CheckCircle2 className="size-4 mr-2" /> {t("acknowledge.accept")}
        </Button>
      </div>
    );
  }

  // choose_time: the proposed pickup time, or ten minutes either side.
  const options: Array<{ key: string; label: string; iso: string | null }> = [
    {
      key: "earlier",
      label: t("acknowledge.earlier", { minutes: ACKNOWLEDGE_OFFSET_MINUTES }),
      iso: shifted(-ACKNOWLEDGE_OFFSET_MINUTES),
    },
    { key: "as-proposed", label: t("acknowledge.asProposed"), iso: null },
    {
      key: "later",
      label: t("acknowledge.later", { minutes: ACKNOWLEDGE_OFFSET_MINUTES }),
      iso: shifted(ACKNOWLEDGE_OFFSET_MINUTES),
    },
  ];

  return (
    <div className="space-y-2 border-t border-border pt-3" data-testid={`ack-choose-${order.id}`}>
      <p className="text-xs text-muted-foreground">{t("acknowledge.promptChoose")}</p>
      <div className="grid grid-cols-3 gap-2">
        {options.map((opt) => {
          // "As proposed" sends no time — it confirms without touching the schedule.
          const shownIso = opt.key === "as-proposed" ? proposedIso : opt.iso;
          return (
            <Button
              key={opt.key}
              variant={opt.key === "as-proposed" ? "default" : "outline"}
              className="h-auto flex-col py-2 gap-0.5"
              disabled={acknowledge.isPending || (opt.key !== "as-proposed" && !opt.iso)}
              onClick={() => submit(opt.iso)}
              data-testid={`button-acknowledge-${opt.key}-${order.id}`}
            >
              <span className="text-sm font-bold tabular-nums">
                {shownIso ? formatTime(shownIso, lang) : "—"}
              </span>
              <span className="text-[10px] font-normal opacity-80">{opt.label}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
