import { setBaseUrl, setAuthTokenGetter, ApiError } from "@workspace/api-client-react";

export { ApiError };

const TOKEN_KEY = "bb_token";

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
  const base = import.meta.env.BASE_URL.replace(/\/+$/, "");
  setBaseUrl(base || null);
  setAuthTokenGetter(() => getToken());
}
