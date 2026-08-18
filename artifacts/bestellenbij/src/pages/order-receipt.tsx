import { useTranslation } from "react-i18next";
import { Link, useParams } from "wouter";
import {
  useGetOrder,
  useListRestaurants,
  getGetOrderQueryKey,
  getListRestaurantsQueryKey,
  DeliveryTimeType,
  type OrderDetail,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ArrowLeft, Printer } from "lucide-react";
import { formatCurrency, effectivePickup, formatTime } from "@/lib/format";

/**
 * The order receipt — primarily a kitchen document.
 *
 * The customer's formal invoice is emailed by the storefront, so this is not a
 * tax document and deliberately makes no VAT claim: none reaches us. It is a
 * sheet of paper the kitchen works from — and sometimes writes on: staff may
 * hand-number packaging and mark the matching lines here.
 *
 * That annotation is deliberately NOT pre-printed. Numbering the lines
 * ourselves would imply every item is labelled, which the restaurant does not
 * always do, and would set an expectation for the customer that the packaging
 * then fails to meet. Lines are spaced to be written on and left otherwise
 * blank.
 *
 * The item table and the money rows below it share one ledger, the way a
 * printed till receipt does — mirroring the plain, table-based print view
 * this replaces (menumovers.tech's restaurant order print). The financial
 * rows are still produced by one function, so an item-only receipt is a
 * matter of not rendering it, not a rewrite.
 *
 * Layout order is deliberate: a short greeting/order/pickup header up top,
 * the ledger, the kitchen note right under it (kitchen-relevant, read before
 * anything else), then customer/timing detail, with both addresses and the
 * delivery instructions pushed to the very bottom — this is a kitchen
 * document first, not the rider's routing paperwork. Both addresses stay
 * unconditionally for now; per-restaurant toggles for what prints are a
 * later addition, not built here.
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

function deliveryTimeEmoji(type: DeliveryTimeType): string {
  return type === DeliveryTimeType.asap ? "⚡" : "🕒";
}

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
        className="receipt-sheet mx-auto max-w-[80ch] border border-border bg-card p-6 text-sm"
        data-testid="receipt-sheet"
      >
        <img src="/bestellenbij-logo-bw.svg" alt="" className="h-10 w-auto mb-3" />
        <ReceiptHeader order={o} restaurantName={restaurant?.name} lang={lang} />
        <ReceiptLedger order={o} lang={lang} />
        <KitchenNote order={o} />
        <ReceiptDetails order={o} restaurantAddress={restaurant?.address} lang={lang} />
        <ReceiptFooter />
      </article>
    </div>
  );
}

function ReceiptHeader({
  order,
  restaurantName,
  lang,
}: {
  order: OrderDetail;
  restaurantName: string | undefined;
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <header className="space-y-1 pb-3 mb-3 border-b border-border">
      <p className="text-lg">{t("receipt.thankYou")}</p>
      <p className="text-lg font-bold">{restaurantName ?? "—"}</p>

      <h1 className="text-base font-bold pt-2" data-testid="text-receipt-order-id">
        {t("receipt.orderNumber")}: #{order.externalOrderId}
      </h1>
      <p>
        {t("pickup.label")}:{" "}
        <span className="font-bold tabular-nums">{formatTime(effectivePickup(order).iso, lang)}</span>
      </p>
    </header>
  );
}

function Row({ label, value, tabular = false }: { label: string; value: string; tabular?: boolean }) {
  return (
    <p>
      {label}: <span className={tabular ? "tabular-nums" : ""}>{value}</span>
    </p>
  );
}

/**
 * One ledger: item lines followed by the money rows, laid out as a single
 * striped table the way a printed till receipt reads — rather than an item
 * list with a separately-boxed totals section below it.
 *
 * Item rows are deliberately unnumbered (see file header). The `#` column
 * holds quantity, not a running index.
 */
function ReceiptLedger({ order, lang }: { order: OrderDetail; lang: string }) {
  const { t } = useTranslation();
  const moneyLines: Array<[string, string]> = [
    [t("receipt.deliveryFee"), order.deliveryFee],
    [t("receipt.tipRider"), order.tipRider],
    [t("receipt.tipRestaurant"), order.tipRestaurant],
    [t("receipt.supTotal"), order.supTotal],
    [t("receipt.statiegeld"), order.statiegeldTotal],
    [t("receipt.administration"), order.administrationCosts],
  ].filter(([, v]) => v != null && v !== "" && v !== "0" && v !== "0.00") as Array<[string, string]>;

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b-2 border-border text-left">
          <th className="w-10 py-1 font-bold">#</th>
          <th className="py-1 font-bold">{t("receipt.description")}</th>
          <th className="py-1 pl-3 text-right font-bold">{t("receipt.charged")}</th>
        </tr>
      </thead>
      <tbody>
        {order.items.map((it, i) => (
          <tr key={i} className="odd:bg-muted/50 align-top" data-testid={`receipt-line-${i}`}>
            <td className="py-2 tabular-nums">{it.quantity}×</td>
            <td className="py-2">
              {it.name}
              {it.notes ? (
                // Not split into separate lines: the real delimiter this field
                // uses for multiple adjustments isn't confirmed yet (neither
                // comma nor <br> hold up — see PR discussion). Shown as one
                // line until that's known, rather than guessing again.
                <span className="block text-xs text-muted-foreground">{it.notes}</span>
              ) : null}
            </td>
            <td className="py-2 pl-3 text-right tabular-nums">{formatCurrency(it.totalPrice ?? it.price, lang)}</td>
          </tr>
        ))}

        {moneyLines.map(([label, value]) => (
          <tr key={label} className="border-t border-border text-muted-foreground">
            <td className="py-1" />
            <td className="py-1">{label}</td>
            <td className="py-1 pl-3 text-right tabular-nums">{formatCurrency(value, lang)}</td>
          </tr>
        ))}

        {order.itemsAdjustment ? (
          <tr className="border-t border-dashed border-border text-muted-foreground" data-testid="text-receipt-adjustment">
            <td className="py-1" />
            <td className="py-1">{t("receipt.adjustment")}</td>
            <td className="py-1 pl-3 text-right tabular-nums">{formatCurrency(order.itemsAdjustment, lang)}</td>
          </tr>
        ) : null}

        <tr className="border-t-2 border-border font-bold">
          <td className="py-2" />
          <td className="py-2">{t("receipt.charged")}</td>
          <td className="py-2 pl-3 text-right tabular-nums" data-testid="text-receipt-total">
            {formatCurrency(order.totalAmount, lang)}
          </td>
        </tr>

        {order.itemsAdjustment ? (
          <tr>
            <td className="py-0" />
            <td colSpan={2} className="pb-1 text-xs font-normal text-muted-foreground">
              {t("receipt.adjustmentNote")}
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

/** Order-level kitchen remarks — kept right under the ledger, read before the customer/timing detail below it. */
function KitchenNote({ order }: { order: OrderDetail }) {
  const { t } = useTranslation();
  if (!order.kitchenNotes) return null;
  return (
    <p className="pt-3" data-testid="text-receipt-kitchen-notes">
      <span className="font-bold">{t("restaurant.kitchenNotes")}:</span> {order.kitchenNotes}
    </p>
  );
}

/**
 * Customer identity and timing, followed by both addresses and the delivery
 * instructions at the very bottom — this document is read by kitchen staff
 * first, so what they need (name, phone, when) comes before where anything
 * goes. Both addresses print unconditionally for now; per-restaurant toggles
 * for what prints are a later addition, not built here.
 */
function ReceiptDetails({
  order,
  restaurantAddress,
  lang,
}: {
  order: OrderDetail;
  restaurantAddress: string | undefined;
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="pt-3 mt-3 border-t border-border space-y-1">
      <Row label={t("receipt.customer")} value={order.customerName} />
      <Row label={t("receipt.customerPhone")} value={order.customerPhone} tabular />
      <Row label={t("receipt.ordered")} value={formatTime(order.sourceCreatedAt, lang)} tabular />
      <Row
        label={t("receipt.deliveryEstimate")}
        value={`${formatTime(order.requestedDeliveryTime, lang)} ${deliveryTimeEmoji(order.deliveryTimeType)}`}
        tabular
      />

      {restaurantAddress ? <Row label={t("receipt.restaurantAddress")} value={restaurantAddress} /> : null}
      <Row label={t("common.address")} value={order.deliveryAddress} />
      {order.deliveryInstructions ? <Row label={t("common.notes")} value={order.deliveryInstructions} /> : null}
    </div>
  );
}

function ReceiptFooter() {
  const { t } = useTranslation();
  return (
    <footer className="pt-3 mt-3 border-t border-border text-xs text-muted-foreground">
      {t("receipt.invoiceNote")}
    </footer>
  );
}
