import { createRoot } from "react-dom/client";
import App from "./App";
import { getContextForPath } from "./lib/app-context";
import "./index.css";

const stored = (() => {
  try {
    return localStorage.getItem("bb_theme");
  } catch {
    return null;
  }
})();
if (stored === "dark") document.documentElement.classList.add("dark");

// Two installable PWAs share one bundle: pick the right manifest based on the
// path the user landed on. Browsers read <link rel="manifest"> at navigation
// time, so swapping it once at boot is enough — SPA routing keeps the user
// inside the manifest's scope from there on.
(() => {
  const ctx = getContextForPath(window.location.pathname);
  const manifestEl = document.getElementById("app-manifest") as
    | HTMLLinkElement
    | null;
  if (manifestEl) {
    manifestEl.href =
      ctx === "restaurant"
        ? "/manifest-restaurant.webmanifest"
        : "/manifest-rider.webmanifest";
  }
})();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(swUrl, { scope: import.meta.env.BASE_URL })
      .catch(() => {
        // ignore registration failures
      });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
