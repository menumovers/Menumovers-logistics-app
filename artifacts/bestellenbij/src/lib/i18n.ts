import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import nl from "../locales/nl/translation.json";
import en from "../locales/en/translation.json";

const STORAGE_KEY = "bb_locale";

function initialLng(): "nl" | "en" {
  if (typeof window === "undefined") return "nl";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "nl" || stored === "en") return stored;
  return "nl";
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
    if (lng === "nl" || lng === "en") {
      window.localStorage.setItem(STORAGE_KEY, lng);
    }
  });
}

export default i18n;
