import { useTranslation } from "react-i18next";
import { Link, useParams } from "wouter";
import {
  useGetOrder,
  useListRestaurants,
  getGetOrderQueryKey,
  getListRestaurantsQueryKey,
  type OrderDetail,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ArrowLeft, Printer } from "lucide-react";
import { formatCurrency, formatDateTime, effectivePickup, formatTime } from "@/lib/format";

/**
 * The order receipt — primarily a kitchen document.
 *
 * The customer's formal invoice is emailed by the storefront, so this is not a
 * tax document and deliberately makes no VAT claim: none reaches us. Its main
 * job is the numbered item list, because the kitchen writes those numbers on
 * the packaging and matches them against this sheet.
 *
 * The financial block is kept as one self-contained section so an item-only
 * variant is a matter of not rendering it, rather than a rewrite.
 *
 * See docs/workflow-decisions.md D10.
 */

/** Everything below prints; the surrounding app chrome and controls do not. */
const PRINT_CSS = `
@media print {
  @page { margin: 12mm; }
  body { background: #fff !important; }
  .no-print, header, nav, aside { display: none !important; }
  .receipt-sheet {
    box-shadow: none !important;
    border: 0 !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    color: #000 !important;
  }
  .receipt-sheet * { color: #000 !important; }
}
`;

export default function OrderReceiptPage() {
  const { id } = useParams();
  const orderId = id!;
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const order = useGetOrder(orderId, {
    query: { queryKey: getGetOrderQueryKey(orderId), enabled: !!orderId },
  });
  const restaurants = useListRestaurants({
    query: { queryKey: getListRestaurantsQueryKey() },
  });

  if (order.isLoading || !order.data) {
    return <div className="grid place-items-center py-20"><Spinner className="size-6 text-primary" /></div>;
  }
  const o = order.data;
  const restaurant = restaurants.data?.find((r) => r.id === o.restaurantId);

  return (
    <div className="space-y-4">
      <style>{PRINT_CSS}</style>

      <div className="flex items-center justify-between gap-3 no-print">
        <Link
          href={`/coordinator/orders/${o.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          data-testid="link-back-from-receipt"
        >
          <ArrowLeft className="size-4" /> {t("common.back")}
        </Link>
        <Button onClick={() => window.print()} data-testid="button-print-receipt">
          <Printer className="size-4 mr-2" /> {t("receipt.print")}
        </Button>
      </div>

      <article
        className="receipt-sheet mx-auto max-w-[80ch] rounded-lg border border-border bg-card p-6 space-y-5"
        data-testid="receipt-sheet"
      >
        <ReceiptHeader order={o} restaurantName={restaurant?.name} restaurantAddress={restaurant?.address} lang={lang} />
        <ItemLines order={o} lang={lang} />
        <MoneyBlock order={o} lang={lang} />
        <ReceiptFooter />
      </article>
    </div>
  );
}

function ReceiptHeader({
  order,
  restaurantName,
  restaurantAddress,
  lang,
}: {
  order: OrderDetail;
  restaurantName: string | undefined;
  restaurantAddress: string | undefined;
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <header className="space-y-3 border-b border-border pb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-lg font-bold">{restaurantName ?? "—"}</div>
          {restaurantAddress ? (
            <div className="text-xs text-muted-foreground">{restaurantAddress}</div>
          ) : null}
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("receipt.orderNumber")}
          </div>
          <div className="text-xl font-bold tabular-nums" data-testid="text-receipt-order-id">
            #{order.externalOrderId}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <Row label={t("receipt.customer")} value={order.customerName} />
        <Row label={t("common.phone")} value={order.customerPhone} tabular />
        <Row label={t("common.address")} value={order.deliveryAddress} />
        <Row
          label={t("pickup.label")}
          value={formatTime(effectivePickup(order).iso, lang)}
          tabular
        />
        <Row label={t("receipt.ordered")} value={formatDateTime(order.sourceCreatedAt, lang)} tabular />
        {order.deliveryInstructions ? (
          <Row label={t("common.notes")} value={order.deliveryInstructions} />
        ) : null}
      </dl>

      {order.kitchenNotes ? (
        <div className="rounded border border-border px-3 py-2 text-sm" data-testid="text-receipt-kitchen-notes">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("restaurant.kitchenNotes")}:
          </span>{" "}
          {order.kitchenNotes}
        </div>
      ) : null}
    </header>
  );
}

function Row({ label, value, tabular = false }: { label: string; value: string; tabular?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground shrink-0">{label}:</dt>
      <dd className={tabular ? "tabular-nums" : ""}>{value}</dd>
    </div>
  );
}

/**
 * The point of the document. Each line carries a printed number so the kitchen
 * can write the same number on the packaging and check the two against each
 * other at handover.
 */
function ItemLines({ order, lang }: { order: OrderDetail; lang: string }) {
  const { t } = useTranslation();
  return (
    <section>
      <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
        {t("receipt.items", { count: order.items.length })}
      </h2>
      <ol className="divide-y divide-border">
        {order.items.map((it, i) => (
          <li key={i} className="flex items-start gap-3 py-2" data-testid={`receipt-line-${i}`}>
            <span
              className="grid size-7 shrink-0 place-items-center rounded border border-foreground text-sm font-bold tabular-nums"
              aria-label={t("receipt.lineNumber", { number: i + 1 })}
            >
              {i + 1}
            </span>
            <span className="flex-1 min-w-0">
              <span className="font-medium">
                <span className="tabular-nums">{it.quantity}×</span> {it.name}
              </span>
              {it.notes ? (
                <span className="block text-xs text-muted-foreground">{it.notes}</span>
              ) : null}
              {it.externalId ? (
                <span className="block text-[10px] font-mono text-muted-foreground">
                  {it.externalId}
                </span>
              ) : null}
            </span>
            <span className="tabular-nums shrink-0">
              {formatCurrency(it.totalPrice ?? it.price, lang)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Self-contained financial block. Some restaurants will eventually want an
 * item-only receipt — that is this section not rendering, nothing more.
 *
 * `totalAmount` is what the customer was charged and is never recomputed, so
 * when items were changed after ordering the difference is shown on its own
 * line rather than quietly reconciled away.
 */
function MoneyBlock({ order, lang }: { order: OrderDetail; lang: string }) {
  const { t } = useTranslation();
  const lines: Array<[string, string]> = [
    [t("receipt.deliveryFee"), order.deliveryFee],
    [t("receipt.tipRider"), order.tipRider],
    [t("receipt.tipRestaurant"), order.tipRestaurant],
    [t("receipt.supTotal"), order.supTotal],
    [t("receipt.statiegeld"), order.statiegeldTotal],
    [t("receipt.administration"), order.administrationCosts],
  ].filter(([, v]) => v != null && v !== "" && v !== "0" && v !== "0.00") as Array<[string, string]>;

  return (
    <section className="border-t border-border pt-3 space-y-1 text-sm">
      {lines.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3">
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular-nums">{formatCurrency(value, lang)}</span>
        </div>
      ))}

      {order.itemsAdjustment ? (
        <div
          className="flex justify-between gap-3 border-t border-dashed border-border pt-1 mt-1"
          data-testid="text-receipt-adjustment"
        >
          <span className="text-muted-foreground">{t("receipt.adjustment")}</span>
          <span className="tabular-nums">{formatCurrency(order.itemsAdjustment, lang)}</span>
        </div>
      ) : null}

      <div className="flex justify-between gap-3 border-t border-border pt-2 mt-2 text-base font-bold">
        <span>{t("receipt.charged")}</span>
        <span className="tabular-nums" data-testid="text-receipt-total">
          {formatCurrency(order.totalAmount, lang)}
        </span>
      </div>

      {order.itemsAdjustment ? (
        <p className="text-xs text-muted-foreground pt-1">{t("receipt.adjustmentNote")}</p>
      ) : null}
    </section>
  );
}

function ReceiptFooter() {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-border pt-3 text-xs text-muted-foreground">
      {t("receipt.invoiceNote")}
    </footer>
  );
}
