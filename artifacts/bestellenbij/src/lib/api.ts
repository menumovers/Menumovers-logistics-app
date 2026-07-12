import { setBaseUrl, setAuthTokenGetter, ApiError } from "@workspace/api-client-react";
import type { OrderItem } from "@workspace/api-client-react";

export { ApiError };

const TOKEN_KEY = "bb_token";

export type OriginalOrderItemsResponse = {
  items: OrderItem[];
};

function apiBase(): string {
  return import.meta.env.BASE_URL.replace(/\/+$/, "");
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function configureApi(): void {
  const base = apiBase();
  setBaseUrl(base || null);
  setAuthTokenGetter(() => getToken());
}

export async function getOriginalOrderItems(orderId: string): Promise<OriginalOrderItemsResponse> {
  const res = await fetch(`${apiBase()}/api/orders/${orderId}/items/original`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load original items (${res.status})`);
  return (await res.json()) as OriginalOrderItemsResponse;
}

export async function unhideOrderItem(orderId: string, itemIndex: number): Promise<void> {
  const res = await fetch(`${apiBase()}/api/orders/${orderId}/items/hide/${itemIndex}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to unhide item (${res.status})`);
}
