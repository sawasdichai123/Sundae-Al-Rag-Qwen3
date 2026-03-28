import { useLocaleStore } from "../i18n";

export default function LanguageToggle() {
    const { locale, toggleLocale } = useLocaleStore();
    return (
        <button
            onClick={toggleLocale}
            className="flex items-center bg-steel-100 rounded-full p-0.5 text-[11px] font-bold leading-none select-none cursor-pointer transition-colors hover:bg-steel-200"
            title="Switch language"
        >
            <span className={`px-2 py-1 rounded-full transition-colors ${locale === "th" ? "bg-white text-steel-900 shadow-sm" : "text-steel-400"}`}>TH</span>
            <span className={`px-2 py-1 rounded-full transition-colors ${locale === "en" ? "bg-white text-steel-900 shadow-sm" : "text-steel-400"}`}>EN</span>
        </button>
    );
}
