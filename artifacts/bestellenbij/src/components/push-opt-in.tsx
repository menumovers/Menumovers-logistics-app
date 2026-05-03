import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  useGetVapidPublicKey,
  useSubscribePush,
  getGetVapidPublicKeyQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Bell, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

const DISMISS_KEY = "bb_push_prompt_dismissed";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function dismissKey(userId: string | undefined): string {
  return userId ? `${DISMISS_KEY}:${userId}` : DISMISS_KEY;
}

export function PushOptInPrompt() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [pathname] = useLocation();
  // Avoid double-prompt: rider-order page already renders its own PushCard.
  const suppressedRoute = pathname.startsWith("/rider/orders/");
  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  const vapid = useGetVapidPublicKey({
    query: { queryKey: getGetVapidPublicKeyQueryKey(), enabled: supported },
  });
  const subscribe = useSubscribePush();

  const [hidden, setHidden] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!supported) return;
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        if (Notification.permission !== "default") return;
        if (localStorage.getItem(dismissKey(user.id)) === "1") return;
        const reg = await navigator.serviceWorker.ready.catch(() => null);
        if (!reg) return;
        const existing = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (!existing) setHidden(false);
      } catch {
        /* keep hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, user]);

  if (hidden) return null;
  if (suppressedRoute) return null;
  if (!user) return null;
  if (!supported) return null;
  if (!vapid.data?.configured || !vapid.data.publicKey) return null;

  function close(persist: boolean) {
    if (persist && user) {
      try {
        localStorage.setItem(dismissKey(user.id), "1");
      } catch {
        /* ignore */
      }
    }
    setHidden(true);
  }

  async function enable() {
    setWorking(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast({ title: t("push.promptDenied"), variant: "destructive" });
        close(true);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const key = urlBase64ToUint8Array(vapid.data!.publicKey!);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key.buffer.slice(
          key.byteOffset,
          key.byteOffset + key.byteLength,
        ) as ArrayBuffer,
      });
      const json = sub.toJSON();
      subscribe.mutate(
        {
          data: {
            endpoint: sub.endpoint,
            keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
            userAgent: navigator.userAgent,
          },
        },
        {
          onSuccess: () => {
            toast({ title: t("rider.pushEnable") });
            close(true);
          },
          onError: () => {
            toast({ title: t("errors.generic"), variant: "destructive" });
            setWorking(false);
          },
        },
      );
    } catch {
      toast({ title: t("errors.generic"), variant: "destructive" });
      setWorking(false);
    }
  }

  return (
    <div
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-lg border border-border bg-card p-4 shadow-xl shadow-primary/10 md:left-auto md:right-4"
      role="dialog"
      aria-labelledby="push-prompt-title"
      data-testid="banner-push-opt-in"
    >
      <div className="flex items-start gap-3">
        <div className="grid place-items-center size-9 rounded-full bg-primary/10 text-primary shrink-0">
          <Bell className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div id="push-prompt-title" className="font-semibold">
            {t("push.promptTitle")}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{t("push.promptBody")}</p>
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              onClick={enable}
              disabled={working}
              data-testid="button-push-prompt-enable"
            >
              {t("push.promptEnable")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => close(true)}
              data-testid="button-push-prompt-later"
            >
              {t("push.promptLater")}
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => close(false)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={t("common.dismiss")}
          data-testid="button-push-prompt-close"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
