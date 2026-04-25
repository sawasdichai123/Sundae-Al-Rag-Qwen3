/**
 * DangerZonePage — Organization deletion management
 *
 * - Org Admin can request deletion
 * - Support/Admin can confirm or cancel deletion
 * - Org Admin can cancel their own request
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useToastStore } from "../store/toastStore";
import { useOrgStore, selectIsOrgAdmin } from "../store/orgStore";
import { useAuthStore } from "../store/authStore";
import { orgApi } from "../api/endpoints";
import { getApiError } from "../utils/apiError";
import Spinner from "../components/Spinner";
import { useT } from "../i18n";

export default function DangerZonePage() {
    const t = useT();
    const navigate = useNavigate();
    const toast = useToastStore((s) => s.addToast);
    const activeOrgId = useOrgStore((s) => s.activeOrgId);
    const isOrgAdmin = useOrgStore(selectIsOrgAdmin);
    const user = useAuthStore((s) => s.user);
    const userRole = user?.role;
    const fetchOrgs = useOrgStore((s) => s.fetchOrgs);

    const canRequestDeletion = isOrgAdmin;
    const canConfirmDeletion = userRole === "support" || userRole === "admin";

    const [orgName, setOrgName] = useState("");
    const [orgSlug, setOrgSlug] = useState<string | null>(null);
    const [orgStatus, setOrgStatus] = useState("active");
    const [loading, setLoading] = useState(true);

    const [requestingDeletion, setRequestingDeletion] = useState(false);
    const [confirmingDeletion, setConfirmingDeletion] = useState(false);
    const [cancellingDeletion, setCancellingDeletion] = useState(false);

    const loadData = useCallback(async () => {
        if (!activeOrgId) return;
        setLoading(true);
        try {
            const { data } = await orgApi.get(activeOrgId);
            setOrgName(data.name);
            setOrgSlug(data.slug ?? null);
            setOrgStatus(data.status);
        } catch (err) {
            console.error("[DangerZone] Load failed:", err);
            toast("error", t("org.loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [activeOrgId, toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleRequestDeletion = async () => {
        if (!activeOrgId) return;
        if (!confirm(t("dangerZone.requestConfirm"))) return;
        setRequestingDeletion(true);
        try {
            await orgApi.requestDeletion(activeOrgId);
            toast("success", t("dangerZone.requestSuccess"));
            await loadData();
        } catch (err: unknown) {
            const msg = getApiError(err, t("dangerZone.requestFailed"));
            toast("error", msg);
        } finally {
            setRequestingDeletion(false);
        }
    };

    const handleCancelDeletion = async () => {
        if (!activeOrgId) return;
        if (!confirm(t("dangerZone.cancelConfirm"))) return;
        setCancellingDeletion(true);
        try {
            await orgApi.cancelDeletion(activeOrgId);
            toast("success", t("dangerZone.cancelSuccess"));
            await loadData();
        } catch (err: unknown) {
            const msg = getApiError(err, t("dangerZone.cancelFailed"));
            toast("error", msg);
        } finally {
            setCancellingDeletion(false);
        }
    };

    const handleConfirmDeletion = async () => {
        if (!activeOrgId) return;
        if (!confirm(t("dangerZone.confirmPrompt"))) return;
        setConfirmingDeletion(true);
        try {
            await orgApi.confirmDeletion(activeOrgId);
            toast("success", t("dangerZone.confirmSuccess"));
            await fetchOrgs();
            navigate("/create-org", { replace: true });
        } catch (err: unknown) {
            const msg = getApiError(err, t("dangerZone.confirmFailed"));
            toast("error", msg);
        } finally {
            setConfirmingDeletion(false);
        }
    };

    if (!activeOrgId) {
        return (
            <div className="animate-fade-in text-center py-12">
                <p className="text-steel-400">{t("common.selectOrgFirst")}</p>
            </div>
        );
    }

    return (
        <div className="animate-fade-in max-w-2xl">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-red-700 tracking-tight">
                    {t("dangerZone.title")}
                </h1>
                <p className="text-sm text-steel-500 mt-1">
                    {t("dangerZone.desc")}
                </p>
            </div>

            {loading && (
                <div className="flex items-center justify-center py-12">
                    <Spinner />
                </div>
            )}

            {!loading && activeOrgId === "ef9d44af-d9ad-4a24-8336-7f99d5737d33" && (
                <div className="bg-white rounded-2xl border border-steel-100 p-6">
                    <h2 className="text-sm font-semibold text-steel-800 mb-1">{t("dangerZone.deleteOrg")} "{orgName}"</h2>
                    <p className="text-xs text-steel-400">{t("dangerZone.mainOrgNotice")}</p>
                </div>
            )}

            {!loading && (canRequestDeletion || canConfirmDeletion) && orgSlug !== "sundae" && (
                <div className="bg-white rounded-2xl border border-red-200 p-6">
                    <h2 className="text-sm font-semibold text-red-700 mb-2">
                        {t("dangerZone.deleteOrg")} {orgName && `"${orgName}"`}
                    </h2>
                    <p className="text-xs text-steel-500 mb-4">
                        {t("dangerZone.deleteNotice")}
                    </p>
                    {orgStatus === "pending_deletion" ? (
                        <div className="flex items-center gap-3">
                            {canConfirmDeletion && (
                                <button
                                    onClick={handleConfirmDeletion}
                                    disabled={confirmingDeletion}
                                    className="px-5 py-2.5 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-700 transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    {confirmingDeletion ? <Spinner /> : t("dangerZone.confirmDeletion")}
                                </button>
                            )}
                            {(canRequestDeletion || canConfirmDeletion) && (
                                <button
                                    onClick={handleCancelDeletion}
                                    disabled={cancellingDeletion}
                                    className="px-5 py-2.5 bg-steel-100 text-steel-700 text-sm font-bold rounded-xl hover:bg-steel-200 transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    {cancellingDeletion ? <Spinner /> : t("dangerZone.cancelDeletion")}
                                </button>
                            )}
                            {!canConfirmDeletion && !canRequestDeletion && (
                                <div className="text-xs text-steel-500">
                                    {t("dangerZone.pendingInfo")}
                                </div>
                            )}
                        </div>
                    ) : (
                        canRequestDeletion ? (
                            <button
                                onClick={handleRequestDeletion}
                                disabled={requestingDeletion}
                                className="px-5 py-2.5 bg-red-100 text-red-700 text-sm font-bold rounded-xl hover:bg-red-200 transition-colors cursor-pointer disabled:opacity-50"
                            >
                                {requestingDeletion ? <Spinner /> : t("dangerZone.requestDeletion")}
                            </button>
                        ) : (
                            <div className="text-xs text-steel-500">
                                {t("dangerZone.ownerOnly")}
                            </div>
                        )
                    )}
                </div>
            )}

        </div>
    );
}
