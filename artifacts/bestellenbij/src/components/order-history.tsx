import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  useListOrderHistory,
  getListOrderHistoryQueryKey,
  type OrderHistoryItem,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/status-badge";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { EyeOff, MapPin, Phone } from "lucide-react";
import { formatCurrency, formatDateTime, localDayBoundaryIso } from "@/lib/format";

/**
 * Shared history list for the restaurant and rider apps. Data is already
 * scoped and privacy-redacted server-side (GET /orders/history) — this
 * component only handles the date filter, pagination, and rendering.
 */
export function OrderHistoryView({ basePath }: { basePath: "/rider" | "/restaurant" }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "nl";
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const dateFromIso = localDayBoundaryIso(dateFrom, "start");
  const dateToIso = localDayBoundaryIso(dateTo, "end");
  const params = {
    ...(dateFromIso ? { dateFrom: dateFromIso } : {}),
    ...(dateToIso ? { dateTo: dateToIso } : {}),
    page,
  };

  const history = useListOrderHistory(params, {
    query: { queryKey: getListOrderHistoryQueryKey(params) },
  });

  function applyDateFrom(value: string) {
    setDateFrom(value);
    setPage(1);
  }
  function applyDateTo(value: string) {
    setDateTo(value);
    setPage(1);
  }
  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  const data = history.data;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t("history.title")}</h1>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div>
            <Label className="text-xs text-muted-foreground">{t("history.dateFrom")}</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => applyDateFrom(e.target.value)}
              className="tabular-nums"
              data-testid="input-history-date-from"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("history.dateTo")}</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => applyDateTo(e.target.value)}
              className="tabular-nums"
              data-testid="input-history-date-to"
            />
          </div>
          {dateFrom || dateTo ? (
            <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-history-clear-filters">
              {t("history.clearFilters")}
            </Button>
          ) : null}
          {data ? (
            <div className="ml-auto text-sm text-muted-foreground tabular-nums" data-testid="text-history-count">
              {t("history.totalCount", { count: data.total })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {history.isLoading ? (
        <div className="grid place-items-center py-20">
          <Spinner className="size-6 text-primary" />
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">{t("history.noOrders")}</CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {data.items.map((o) => (
              <HistoryRow key={o.id} order={o} lang={lang} basePath={basePath} />
            ))}
          </div>

          {data.totalPages > 1 ? (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (data.page > 1) setPage(data.page - 1);
                    }}
                    className={data.page <= 1 ? "pointer-events-none opacity-50" : undefined}
                    data-testid="button-history-prev-page"
                  />
                </PaginationItem>
                <PaginationItem>
                  <span className="px-3 text-sm text-muted-foreground tabular-nums" data-testid="text-history-page">
                    {t("history.pageInfo", { page: data.page, totalPages: data.totalPages })}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (data.page < data.totalPages) setPage(data.page + 1);
                    }}
                    className={data.page >= data.totalPages ? "pointer-events-none opacity-50" : undefined}
                    data-testid="button-history-next-page"
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          ) : null}
        </>
      )}
    </div>
  );
}

function HistoryRow({
  order,
  lang,
  basePath,
}: {
  order: OrderHistoryItem;
  lang: string;
  basePath: "/rider" | "/restaurant";
}) {
  const { t } = useTranslation();
  return (
    <Link href={`${basePath}/orders/${order.id}`}>
      <Card
        className="hover:border-primary/40 hover:shadow-md transition cursor-pointer"
        data-testid={`card-history-order-${order.id}`}
      >
        <CardContent className="py-3 space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-muted-foreground tabular-nums shrink-0">#{order.externalOrderId}</span>
              <span className="font-semibold truncate">{order.restaurantName}</span>
              {order.riderName ? (
                <span className="text-muted-foreground truncate">· {order.riderName}</span>
              ) : null}
            </span>
            <StatusBadge status={order.status} />
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0">
              {order.piiRedacted ? (
                <span
                  className="inline-flex items-center gap-1 text-muted-foreground italic"
                  data-testid={`text-history-redacted-${order.id}`}
                  title={t("history.redactedExplain")}
                >
                  <EyeOff className="size-3.5 shrink-0" />
                  {t("history.redacted")}
                </span>
              ) : (
                <span className="truncate">{order.customerName}</span>
              )}
            </span>
            <span className="tabular-nums text-muted-foreground shrink-0">
              {formatCurrency(order.totalAmount, lang)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 min-w-0">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{order.deliveryAddress}</span>
            </span>
            <span className="flex items-center gap-3 shrink-0">
              {!order.piiRedacted && order.customerPhone ? (
                <span className="flex items-center gap-1">
                  <Phone className="size-3" />
                  {order.customerPhone}
                </span>
              ) : null}
              <span className="tabular-nums">{formatDateTime(order.updatedAt, lang)}</span>
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
