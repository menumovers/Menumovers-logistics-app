import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import nl from "../locales/nl/translation.json";
import en from "../locales/en/translation.json";

const STORAGE_KEY = "bb_locale";

/**
 * Locale resolution priority (highest first):
 *   1. user.preferredLocale     — applied later by AuthProvider after /auth/me
 *   2. localStorage["bb_locale"] — last in-app choice (also used pre-auth)
 *   3. navigator.language        — browser hint, mapped to nl|en
 *   4. "nl"                      — product default
 *
 * The profile is canonical for authed users; AuthProvider calls
 * `i18n.changeLanguage(user.preferredLocale)` and we suppress the
 * languageChanged → localStorage write while `suppressStorageWrite` is true so
 * the profile choice doesn't get echoed into local storage on a different
 * device.
 */
function fromNavigator(): "nl" | "en" | null {
  if (typeof navigator === "undefined") return null;
  const langs = (navigator.languages?.length ? navigator.languages : [navigator.language]).filter(
    (l): l is string => typeof l === "string" && l.length > 0,
  );
  for (const raw of langs) {
    const tag = raw.toLowerCase();
    if (tag === "nl" || tag.startsWith("nl-")) return "nl";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return null;
}

function initialLng(): "nl" | "en" {
  if (typeof window === "undefined") return "nl";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "nl" || stored === "en") return stored;
  } catch {
    /* localStorage unavailable */
  }
  return fromNavigator() ?? "nl";
}

let suppressStorageWrite = false;

/**
 * Apply the authenticated user's preferred locale without persisting it to
 * localStorage. Called by AuthProvider once the /auth/me payload arrives.
 */
export function applyProfileLocale(locale: "nl" | "en" | null | undefined): void {
  if (!locale) return;
  if (i18n.resolvedLanguage === locale) return;
  suppressStorageWrite = true;
  try {
    void i18n.changeLanguage(locale);
  } finally {
    // Release after the synchronous languageChanged handler runs.
    queueMicrotask(() => {
      suppressStorageWrite = false;
    });
  }
}

i18n.use(initReactI18next).init({
  resources: {
    nl: { translation: nl },
    en: { translation: en },
  },
  lng: initialLng(),
  fallbackLng: "nl",
  supportedLngs: ["nl", "en"],
  interpolation: { escapeValue: false },
});

if (typeof window !== "undefined") {
  i18n.on("languageChanged", (lng) => {
    if (suppressStorageWrite) return;
    if (lng === "nl" || lng === "en") {
      try {
        window.localStorage.setItem(STORAGE_KEY, lng);
      } catch {
        /* ignore */
      }
    }
  });
}

export default i18n;
