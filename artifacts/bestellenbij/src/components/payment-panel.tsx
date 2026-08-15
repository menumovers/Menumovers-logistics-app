import { useTranslation } from "react-i18next";
import { Banknote, CreditCard, Smartphone, QrCode, AlertTriangle } from "lucide-react";
import type { Order } from "@workspace/api-client-react";
import { formatCurrency, moneyToCents, subtractMoney } from "@/lib/format";

/**
 * What the rider has to do at the door.
 *
 * `cashPayment` means "not paid online" — it is **not** a synonym for cash.
 * `type` says which of the on-delivery methods applies:
 *
 *   - `exact`  — physical cash, the customer has it exactly
 *   - `custom` — physical cash, the customer pays with more, so change is needed
 *   - `tikkie` — a payment request; nothing physical changes hands
 *   - `qr`     — scan to pay; nothing physical changes hands
 *
 * Only `exact` and `custom` involve carrying money, so change is the one thing
 * that must never be shown for the digital two.
 *
 * `changeAmount` is **the amount the customer will pay with**, not the change
 * owed — so the change the rider carries back is `changeAmount − totalAmount`.
 * Computed in integer cents, because amounts travel as strings precisely to
 * avoid float math.
 */

type PaymentOrder = Pick<Order, "paymentMethod" | "cashPayment" | "totalAmount">;

type OnDeliveryKind = "cash" | "tikkie" | "qr";

/** Physical money changes hands only for the cash kinds. */
function kindOf(type: string | null | undefined): OnDeliveryKind {
  const t = (type ?? "").trim().toLowerCase();
  if (t === "tikkie") return "tikkie";
  if (t === "qr") return "qr";
  // `exact`, `custom`, empty, or anything unrecognised: treat as physical cash.
  // Erring towards cash means a rider arrives prepared to handle money rather
  // than unprepared — the safer direction for an unknown value.
  return "cash";
}

const ICONS = { cash: Banknote, tikkie: Smartphone, qr: QrCode } as const;

/** Compact marker for list cards — what kind of collection is waiting. */
export function PaymentBadge({ order }: { order: PaymentOrder }) {
  const { t } = useTranslation();
  if (!order.cashPayment) return null;
  const kind = kindOf(order.cashPayment.type);
  const Icon = ICONS[kind];
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-chart-4/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground"
      data-testid={`badge-payment-${kind}`}
    >
      <Icon className="size-3" /> {t(`payment.kind_${kind}`)}
    </span>
  );
}

export function PaymentPanel({
  order,
  lang,
}: {
  order: PaymentOrder;
  lang: string;
}) {
  const { t } = useTranslation();
  const onDelivery = order.cashPayment;

  if (!onDelivery) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
        data-testid="panel-payment-prepaid"
      >
        <CreditCard className="size-4 shrink-0" />
        <span>{t("payment.prepaid")}</span>
        <span className="ml-auto tabular-nums">{formatCurrency(order.totalAmount, lang)}</span>
      </div>
    );
  }

  const kind = kindOf(onDelivery.type);
  const Icon = ICONS[kind];

  // "false"/"0"/"nee"/empty all mean no change needed.
  const flaggedChangeRequired =
    onDelivery.changeRequired != null &&
    !["false", "0", "nee", "no", ""].includes(
      onDelivery.changeRequired.trim().toLowerCase(),
    );

  // changeAmount is what the customer hands over; the difference is what the
  // rider carries back. Only meaningful for physical cash.
  const changeOwed = kind === "cash" ? subtractMoney(onDelivery.changeAmount, order.totalAmount) : null;
  const changeOwedCents = moneyToCents(changeOwed);

  return (
    <div
      className="rounded-md border-2 border-chart-4/50 bg-chart-4/[0.06] p-3 space-y-2"
      data-testid={`panel-payment-${kind}`}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0" />
        <span className="text-sm font-bold uppercase tracking-wide">
          {t(`payment.action_${kind}`)}
        </span>
        <span className="ml-auto text-lg font-bold tabular-nums" data-testid="text-payment-total">
          {formatCurrency(order.totalAmount, lang)}
        </span>
      </div>

      {/* The storefront's own wording, verbatim — it carries nuance the
          structured fields don't, so it stays even when we know the kind. */}
      {onDelivery.label ? (
        <p className="text-sm font-medium" data-testid="text-payment-label">
          {onDelivery.label}
        </p>
      ) : null}

      {kind === "cash" && changeOwedCents !== null && changeOwedCents > 0 ? (
        <div
          className="flex items-start gap-2 rounded bg-background/60 px-2 py-1.5 text-sm"
          data-testid="text-change-required"
        >
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
          <span>
            {t("payment.paysWith", {
              amount: formatCurrency(onDelivery.changeAmount, lang),
            })}{" "}
            <span className="font-semibold tabular-nums" data-testid="text-change-to-bring">
              {t("payment.bringChange", { amount: formatCurrency(changeOwed, lang) })}
            </span>
          </span>
        </div>
      ) : kind === "cash" && changeOwedCents !== null && changeOwedCents < 0 ? (
        // The customer is paying with less than the total. That is a data
        // problem, not an instruction — show it rather than a negative sum.
        <div
          className="flex items-start gap-2 rounded bg-destructive/10 px-2 py-1.5 text-sm text-destructive"
          data-testid="text-change-inconsistent"
        >
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
          <span>
            {t("payment.changeInconsistent", {
              amount: formatCurrency(onDelivery.changeAmount, lang),
            })}
          </span>
        </div>
      ) : kind === "cash" && changeOwedCents === null && flaggedChangeRequired ? (
        // Flagged as needing change but the amount is missing or unparseable.
        <div
          className="flex items-start gap-2 rounded bg-background/60 px-2 py-1.5 text-sm"
          data-testid="text-change-unknown"
        >
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
          <span>{t("payment.changeUnknown")}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{t("payment.method", { method: order.paymentMethod })}</span>
        {onDelivery.type ? <span>{t("payment.type", { type: onDelivery.type })}</span> : null}
      </div>
    </div>
  );
}
