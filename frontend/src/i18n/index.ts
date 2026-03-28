import { useCallback } from "react";
import { create } from "zustand";
import thJson from "./th.json";
import enJson from "./en.json";

const LOCALE_KEY = "sundae_locale";
const stored = typeof window !== "undefined" ? localStorage.getItem(LOCALE_KEY) : null;

type Locale = "th" | "en";

interface LocaleState {
    locale: Locale;
    setLocale: (l: Locale) => void;
    toggleLocale: () => void;
}

const translations: Record<Locale, Record<string, string>> = {
    th: thJson as Record<string, string>,
    en: enJson as Record<string, string>,
};

export const useLocaleStore = create<LocaleState>((set, get) => ({
    locale: stored === "en" ? "en" : "th",
    setLocale: (l) => {
        localStorage.setItem(LOCALE_KEY, l);
        set({ locale: l });
    },
    toggleLocale: () => {
        const next = get().locale === "th" ? "en" : "th";
        localStorage.setItem(LOCALE_KEY, next);
        set({ locale: next });
    },
}));

export function useT() {
    const locale = useLocaleStore((s) => s.locale);
    return useCallback(
        (key: string): string => translations[locale]?.[key] ?? key,
        [locale],
    );
}
