import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const stored = (() => {
  try {
    return localStorage.getItem("bb_theme");
  } catch {
    return null;
  }
})();
if (stored === "dark") document.documentElement.classList.add("dark");

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(swUrl, { scope: import.meta.env.BASE_URL }).catch(() => {
      // ignore registration failures
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
