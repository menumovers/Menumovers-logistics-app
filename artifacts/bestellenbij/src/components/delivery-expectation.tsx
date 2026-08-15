import { useTranslation } from "react-i18next";
import { CalendarClock, Zap, Tag, ShoppingBag } from "lucide-react";
import { formatDateTime, formatTime } from "@/lib/format";

/**
 * What the customer is expecting, as opposed to what we plan to do.
 *
 * Two independent signals, both arriving in the payload and neither previously
 * shown anywhere:
 *
 *   - `deliveryMethod` — `happy_hour` means the customer took a cheaper
 *     delivery fee for less control over timing, so they are *not* waiting on
 *     a precise moment. `pickup` means they collect it themselves.
 *   - `deliveryTimeType` + `requestedDeliveryTime` — whether they want it as
 *     soon as possible or at a stated time.
 *
 * Display only; nothing branches on these beyond keeping customer-pickup out
 * of rider hands. See docs/workflow-decisions.md D5.
 */

type Expectation = {
  deliveryMethod: string;
  deliveryTimeType: string;
  requestedDeliveryTime: string;
};

const CHIP =
  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide";

export function DeliveryMethodBadge({ order }: { order: Pick<Expectation, "deliveryMethod"> }) {
  const { t } = useTranslation();
  if (order.deliveryMethod === "happy_hour") {
    return (
      <span className={`${CHIP} bg-accent/20 text-accent-foreground`} data-testid="badge-happy-hour">
        <Tag className="size-3" /> {t("delivery.method_happy_hour")}
      </span>
    );
  }
  if (order.deliveryMethod === "pickup") {
    return (
      <span className={`${CHIP} bg-primary/15 text-primary`} data-testid="badge-customer-pickup">
        <ShoppingBag className="size-3" /> {t("delivery.method_pickup")}
      </span>
    );
  }
  // Plain delivery is the default; a badge for it would be noise.
  return null;
}

/**
 * When the customer asked for it. ASAP orders show the label alone — their
 * requested time is an estimate, not a promise, so printing a clock time
 * would imply a commitment nobody made.
 */
export function RequestedTimeLabel({
  order,
  lang,
  withDate = false,
}: {
  order: Pick<Expectation, "deliveryTimeType" | "requestedDeliveryTime">;
  lang: string;
  withDate?: boolean;
}) {
  const { t } = useTranslation();
  const asap = order.deliveryTimeType === "asap";
  const otherDay = order.deliveryTimeType === "other_day";
  const showDate = withDate || otherDay;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      data-testid="label-requested-time"
    >
      {asap ? <Zap className="size-3" /> : <CalendarClock className="size-3" />}
      {asap ? (
        t("delivery.timeType_asap")
      ) : (
        <span className="tabular-nums">
          {showDate
            ? formatDateTime(order.requestedDeliveryTime, lang)
            : formatTime(order.requestedDeliveryTime, lang)}
        </span>
      )}
    </span>
  );
}
