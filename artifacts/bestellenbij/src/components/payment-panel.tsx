import { useTranslation } from "react-i18next";
import { Banknote, CreditCard, AlertTriangle } from "lucide-react";
import type { Order } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";

/**
 * What happens at the door.
 *
 * The whole payment side of the payload was stored, typed and rendered nowhere,
 * so a rider arrived without knowing whether to collect cash, how much, or what
 * change to carry.
 *
 * `cashPayment.label` is the storefront's own ready-made Dutch string and leads
 * the display: `type` is one of `exact | custom | tikkie | qr`, and the last two
 * are not cash at all, so deriving our own phrasing from `type` would risk
 * telling a rider to collect cash for a QR payment. The structured fields are
 * shown beneath it as support, never as the primary instruction.
 */

type PaymentOrder = Pick<Order, "paymentMethod" | "cashPayment" | "totalAmount">;

/** Compact marker for list cards — "is there cash involved at all?" */
export function PaymentBadge({ order }: { order: PaymentOrder }) {
  const { t } = useTranslation();
  if (!order.cashPayment) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-chart-4/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground"
      data-testid="badge-cash"
    >
      <Banknote className="size-3" /> {t("payment.cash")}
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
  const cash = order.cashPayment;

  if (!cash) {
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

  // "false"/"0"/"nee" all mean no change needed; anything else truthy means it is.
  const changeRequired =
    cash.changeRequired != null &&
    !["false", "0", "nee", "no", ""].includes(cash.changeRequired.trim().toLowerCase());

  return (
    <div
      className="rounded-md border-2 border-chart-4/50 bg-chart-4/[0.06] p-3 space-y-2"
      data-testid="panel-payment-cash"
    >
      <div className="flex items-center gap-2">
        <Banknote className="size-4 shrink-0" />
        <span className="text-sm font-bold uppercase tracking-wide">{t("payment.collect")}</span>
        <span className="ml-auto text-lg font-bold tabular-nums" data-testid="text-cash-total">
          {formatCurrency(order.totalAmount, lang)}
        </span>
      </div>

      {/* The storefront's own wording, verbatim — the safest instruction we have. */}
      {cash.label ? (
        <p className="text-sm font-medium" data-testid="text-cash-label">
          {cash.label}
        </p>
      ) : null}

      {changeRequired ? (
        <div
          className="flex items-start gap-2 rounded bg-background/60 px-2 py-1.5 text-sm"
          data-testid="text-change-required"
        >
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
          <span>
            {t("payment.changeNeeded")}
            {cash.changeAmount ? (
              <>
                {" "}
                <span className="font-semibold tabular-nums">
                  {formatCurrency(cash.changeAmount, lang)}
                </span>
              </>
            ) : null}
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{t("payment.method", { method: order.paymentMethod })}</span>
        {cash.type ? <span>{t("payment.type", { type: cash.type })}</span> : null}
      </div>
    </div>
  );
}
