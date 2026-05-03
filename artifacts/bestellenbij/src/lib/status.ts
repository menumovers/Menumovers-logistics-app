import type { OrderStatus } from "@workspace/api-client-react";

export const STATUS_CLASS: Record<OrderStatus, string> = {
  pending: "bg-muted text-foreground border-border",
  driver_assigned: "bg-primary/12 text-primary border-primary/30",
  en_route_to_restaurant: "bg-chart-2/15 text-chart-2 border-chart-2/40",
  picked_up: "bg-chart-3/15 text-chart-3 border-chart-3/40",
  en_route_to_customer: "bg-chart-4/15 text-chart-4 border-chart-4/40",
  delivered: "bg-chart-5/15 text-chart-5 border-chart-5/40",
  failed: "bg-destructive/12 text-destructive border-destructive/40",
};

export const URGENCY_CLASS: Record<"neutral" | "warn" | "danger" | "late", string> = {
  neutral: "bg-muted text-foreground",
  warn: "bg-accent/15 text-accent-foreground border border-accent/40",
  danger: "bg-destructive/15 text-destructive border border-destructive/40",
  late: "bg-destructive text-destructive-foreground",
};

export function statusI18nKey(status: OrderStatus): string {
  return `orderStatus.${status}`;
}
