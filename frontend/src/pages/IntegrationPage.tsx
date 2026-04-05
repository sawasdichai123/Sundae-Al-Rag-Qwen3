/**
 * IntegrationPage — Channel Integration Management
 *
 * LINE section: loads real config from API, allows setting credentials,
 * shows Webhook URL to copy into LINE Developers Console, and toggles
 * is_line_enabled per org.
 *
 * Website section: UI-only toggle (web chat is always available via /chat).
 */

import { useState, useEffect, useCallback } from "react";
import { useOrgStore } from "../store/orgStore";
import { useToastStore } from "../store/toastStore";
import { orgApi } from "../api/endpoints";
import { getApiError } from "../utils/apiError";
import Spinner from "../components/Spinner";
import { useT } from "../i18n";

// ── Icons ───────────────────────────────────────────────────────

function LineIcon() {
    return (
        <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center text-white text-lg font-bold shrink-0 shadow-sm">
            L
        </div>
    );
}

function WebIcon() {
    return (
        <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center text-white shrink-0 shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Zm8.72-2.72a.75.75 0 0 1 1.06 0l3.44 3.44a.75.75 0 1 1-1.06 1.06L14 4.94v4.31a.75.75 0 0 1-1.5 0V4.94l-2.41 2.34a.75.75 0 1 1-1.06-1.06l3.44-3.44Z" clipRule="evenodd" />
            </svg>
        </div>
    );
}

// ── Toggle Switch ───────────────────────────────────────────────

function ToggleSwitch({ enabled, onChange, disabled }: { enabled: boolean; onChange: () => void; disabled?: boolean }) {
    return (
        <button
            onClick={onChange}
            disabled={disabled}
            className={`relative inline-flex items-center w-12 h-7 rounded-full transition-colors duration-200 shrink-0 ${enabled ? "bg-brand-400" : "bg-steel-300"} ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        >
            <span className={`inline-block w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200 ${enabled ? "translate-x-6" : "translate-x-1"}`} />
        </button>
    );
}

// ── Component ───────────────────────────────────────────────────

export default function IntegrationPage() {
    const t = useT();
    const toast = useToastStore((s) => s.addToast);
    const activeOrgId = useOrgStore((s) => s.activeOrgId);

    // LINE config state
    const [lineEnabled, setLineEnabled] = useState(false);
    const [hasCredentials, setHasCredentials] = useState(false);
    const [webhookUrl, setWebhookUrl] = useState("");
    const [loadingConfig, setLoadingConfig] = useState(true);
    const [toggling, setToggling] = useState(false);

    // Credential form state
    const [showCredForm, setShowCredForm] = useState(false);
    const [channelSecret, setChannelSecret] = useState("");
    const [accessToken, setAccessToken] = useState("");
    const [savingCreds, setSavingCreds] = useState(false);

    // Load LINE config on mount
    const loadLineConfig = useCallback(async () => {
        if (!activeOrgId) return;
        setLoadingConfig(true);
        try {
            const { data } = await orgApi.getLineConfig(activeOrgId);
            setLineEnabled(data.is_line_enabled);
            setHasCredentials(data.has_credentials);
            setWebhookUrl(data.webhook_url);
        } catch (err) {
            console.error("[Integration] Failed to load LINE config:", err);
        } finally {
            setLoadingConfig(false);
        }
    }, [activeOrgId]);

    useEffect(() => { loadLineConfig(); }, [loadLineConfig]);

    const handleToggleLine = async () => {
        if (!activeOrgId) return;
        setToggling(true);
        try {
            const { data } = await orgApi.updateLineConfig(activeOrgId, {
                is_line_enabled: !lineEnabled,
            });
            setLineEnabled(data.is_line_enabled);
            toast("success", data.is_line_enabled ? t("integration.lineEnabled") : t("integration.lineDisabled"));
        } catch (err: unknown) {
            const msg = getApiError(err, t("integration.toggleFailed"));
            toast("error", msg);
        } finally {
            setToggling(false);
        }
    };

    const handleSaveCredentials = async () => {
        if (!activeOrgId || !channelSecret.trim() || !accessToken.trim()) return;
        setSavingCreds(true);
        try {
            const { data } = await orgApi.updateLineConfig(activeOrgId, {
                line_channel_secret: channelSecret.trim(),
                line_access_token: accessToken.trim(),
            });
            setHasCredentials(data.has_credentials);
            setChannelSecret("");
            setAccessToken("");
            setShowCredForm(false);
            toast("success", t("integration.credsSaved"));
        } catch (err: unknown) {
            const msg = getApiError(err, t("integration.credsFailed"));
            toast("error", msg);
        } finally {
            setSavingCreds(false);
        }
    };

    const handleCopyWebhook = () => {
        navigator.clipboard.writeText(webhookUrl);
        toast("success", t("integration.webhookCopied"));
    };

    return (
        <div className="animate-fade-in">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-steel-900">{t("integration.title")}</h1>
                <p className="text-sm text-steel-500 mt-1">{t("integration.desc")}</p>
            </div>

            <div className="space-y-4 max-w-2xl">

                {/* ── LINE Card ────────────────────────────────── */}
                <div className="bg-white rounded-2xl border border-steel-200 p-6 hover:shadow-md hover:shadow-steel-100/50 transition-all duration-200">
                    <div className="flex items-start justify-between mb-4">
                        <div className="flex items-start gap-4 flex-1">
                            <LineIcon />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="text-base font-bold text-steel-900">LINE Messaging API</h3>
                                    {!loadingConfig && (
                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${hasCredentials && lineEnabled ? "bg-emerald-100 text-emerald-700" : hasCredentials ? "bg-amber-100 text-amber-700" : "bg-steel-100 text-steel-500"}`}>
                                            {hasCredentials && lineEnabled ? t("integration.statusConnected") : hasCredentials ? t("integration.statusDisabled") : t("integration.statusNotConfigured")}
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-steel-500 leading-relaxed">{t("integration.lineDesc")}</p>
                            </div>
                        </div>
                        {loadingConfig ? (
                            <Spinner />
                        ) : (
                            <ToggleSwitch enabled={lineEnabled} onChange={handleToggleLine} disabled={toggling || !hasCredentials} />
                        )}
                    </div>

                    {!loadingConfig && (
                        <div className="space-y-3 border-t border-steel-100 pt-4">

                            {/* Webhook URL */}
                            <div>
                                <p className="text-xs font-medium text-steel-600 mb-1.5">{t("integration.webhookUrl")}</p>
                                <div className="flex items-center gap-2">
                                    <code className="flex-1 px-3 py-2 bg-steel-50 border border-steel-200 rounded-xl text-xs text-steel-700 truncate">
                                        {webhookUrl}
                                    </code>
                                    <button
                                        onClick={handleCopyWebhook}
                                        className="px-3 py-2 bg-steel-100 text-steel-600 text-xs font-medium rounded-xl hover:bg-steel-200 transition-colors cursor-pointer shrink-0"
                                    >
                                        {t("common.copy")}
                                    </button>
                                </div>
                                <p className="text-[10px] text-steel-400 mt-1">{t("integration.webhookHint")}</p>
                            </div>

                            {/* Credentials */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${hasCredentials ? "bg-emerald-500" : "bg-steel-300"}`} />
                                    <span className="text-xs text-steel-600">
                                        {hasCredentials ? t("integration.credsConfigured") : t("integration.credsNotConfigured")}
                                    </span>
                                </div>
                                <button
                                    onClick={() => setShowCredForm((v) => !v)}
                                    className="text-xs font-medium text-brand-600 hover:text-brand-700 cursor-pointer"
                                >
                                    {showCredForm ? t("common.cancel") : hasCredentials ? t("integration.updateCreds") : t("integration.setCreds")}
                                </button>
                            </div>

                            {/* Credential Form */}
                            {showCredForm && (
                                <div className="bg-steel-50 rounded-xl p-4 space-y-3 border border-steel-200">
                                    <div>
                                        <label className="block text-xs font-medium text-steel-600 mb-1">{t("integration.channelSecret")}</label>
                                        <input
                                            type="password"
                                            value={channelSecret}
                                            onChange={(e) => setChannelSecret(e.target.value)}
                                            placeholder="Channel Secret"
                                            disabled={savingCreds}
                                            className="w-full px-3 py-2 bg-white border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-steel-600 mb-1">{t("integration.accessToken")}</label>
                                        <input
                                            type="password"
                                            value={accessToken}
                                            onChange={(e) => setAccessToken(e.target.value)}
                                            placeholder="Channel Access Token"
                                            disabled={savingCreds}
                                            className="w-full px-3 py-2 bg-white border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                                        />
                                    </div>
                                    <button
                                        onClick={handleSaveCredentials}
                                        disabled={savingCreds || !channelSecret.trim() || !accessToken.trim()}
                                        className="px-4 py-2 bg-brand-400 text-steel-900 text-xs font-bold rounded-xl hover:bg-brand-500 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                                    >
                                        {savingCreds ? <><Spinner /> {t("common.saving")}</> : t("common.save")}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Website Card (UI-only) ───────────────────── */}
                <div className="bg-white rounded-2xl border border-steel-200 p-6 hover:shadow-md hover:shadow-steel-100/50 transition-all duration-200">
                    <div className="flex items-start gap-4">
                        <WebIcon />
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-base font-bold text-steel-900">Website</h3>
                                <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                                    {t("integration.statusConnected")}
                                </span>
                            </div>
                            <p className="text-xs text-steel-500 leading-relaxed">{t("integration.webDesc")}</p>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
