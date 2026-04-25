/**
 * ApprovalsPage — Support/Admin user approval dashboard
 *
 * Shows pending users + approval history with who approved and when.
 */

import { useState, useEffect, useCallback } from "react";
import { useToastStore } from "../store/toastStore";
import { adminApi } from "../api/endpoints";
import { getApiError } from "../utils/apiError";
import type { PendingUser, ApprovedUser } from "../types";
import { useT } from "../i18n";

export default function ApprovalsPage() {
    const t = useT();
    const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
    const [approvedUsers, setApprovedUsers] = useState<ApprovedUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [approvedLoading, setApprovedLoading] = useState(true);
    const [approvingId, setApprovingId] = useState<string | null>(null);
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const toast = useToastStore((s) => s.addToast);

    const loadUsers = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await adminApi.listPending();
            setPendingUsers(data || []);
        } catch (err) {
            console.error("[Approvals] Failed to load pending users:", err);
            toast("error", t("approvals.loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [toast, t]);

    const loadApproved = useCallback(async () => {
        setApprovedLoading(true);
        try {
            const { data } = await adminApi.listApproved();
            setApprovedUsers(data || []);
        } catch (err) {
            console.error("[Approvals] Failed to load approved users:", err);
        } finally {
            setApprovedLoading(false);
        }
    }, []);

    useEffect(() => { loadUsers(); loadApproved(); }, [loadUsers, loadApproved]);

    const handleApprove = async (userId: string) => {
        setApprovingId(userId);
        try {
            await adminApi.approve(userId);
            toast("success", t("approvals.approveSuccess"));
            await loadUsers();
            await loadApproved();
        } catch (err: unknown) {
            console.error("[Approvals] Approve failed:", err);
            toast("error", getApiError(err, t("approvals.approveFailed")));
        } finally {
            setApprovingId(null);
        }
    };

    const handleReject = async (userId: string) => {
        if (!confirm(t("approvals.rejectConfirm"))) return;
        setRejectingId(userId);
        try {
            await adminApi.reject(userId);
            toast("success", t("approvals.rejectSuccess"));
            await loadUsers();
        } catch (err: unknown) {
            console.error("[Approvals] Reject failed:", err);
            toast("error", getApiError(err, t("approvals.rejectFailed")));
        } finally {
            setRejectingId(null);
        }
    };

    const formatDate = (d: string | null) => {
        if (!d || isNaN(new Date(d).getTime())) return "—";
        return new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    };

    return (
        <div className="animate-fade-in">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-steel-900 tracking-tight">
                    {t("approvals.title")}
                </h1>
                <p className="text-sm text-steel-500 mt-1">
                    {t("approvals.desc")}
                </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                    <p className="text-2xl font-bold text-amber-700">{loading ? "—" : pendingUsers.length}</p>
                    <p className="text-sm text-amber-600">{t("approvals.pending")}</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-2xl p-5">
                    <p className="text-2xl font-bold text-green-700">{approvedLoading ? "—" : approvedUsers.length}</p>
                    <p className="text-sm text-green-600">{t("approvals.approved")}</p>
                </div>
            </div>

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center py-12">
                    <div className="flex items-center gap-3 text-steel-400">
                        <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span className="text-sm">{t("common.loading")}</span>
                    </div>
                </div>
            )}

            {/* Pending List */}
            {!loading && (
                <div className="bg-white rounded-2xl border border-steel-100 overflow-hidden mb-6">
                    <div className="px-6 py-4 border-b border-steel-100">
                        <h2 className="text-sm font-semibold text-steel-800">{t("approvals.pendingUsers")}</h2>
                    </div>

                    {pendingUsers.length === 0 ? (
                        <div className="px-6 py-12 text-center">
                            <p className="text-steel-400 text-sm">{t("approvals.noPending")}</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-steel-100">
                            {pendingUsers.map((user) => (
                                <div key={user.id} className="px-6 py-4 flex items-center gap-4 hover:bg-steel-50 transition-colors">
                                    <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm shrink-0">
                                        {([user.first_name, user.last_name].filter(Boolean).join(" ") || user.email)?.[0]?.toUpperCase() || "?"}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-steel-800">{[user.first_name, user.last_name].filter(Boolean).join(" ") || t("common.noName")}</p>
                                        <p className="text-xs text-steel-400">{user.email}</p>
                                    </div>
                                    <span className="text-xs text-steel-400 shrink-0 hidden sm:block">
                                        {formatDate(user.created_at)}
                                    </span>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleApprove(user.id)}
                                            disabled={approvingId === user.id || rejectingId === user.id}
                                            className="px-4 py-2 bg-brand-400 text-steel-900 text-xs font-bold rounded-xl hover:bg-brand-500 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                                        >
                                            {approvingId === user.id ? t("common.processing") : t("approvals.approve")}
                                        </button>
                                        <button
                                            onClick={() => handleReject(user.id)}
                                            disabled={approvingId === user.id || rejectingId === user.id}
                                            className="px-4 py-2 bg-red-100 text-red-700 text-xs font-bold rounded-xl hover:bg-red-200 transition-colors cursor-pointer disabled:opacity-50"
                                        >
                                            {rejectingId === user.id ? t("common.processing") : t("approvals.reject")}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Approved History */}
            {!approvedLoading && approvedUsers.length > 0 && (
                <div className="bg-white rounded-2xl border border-steel-100 overflow-hidden">
                    <div className="px-6 py-4 border-b border-steel-100">
                        <h2 className="text-sm font-semibold text-steel-800">{t("approvals.approvedHistory")}</h2>
                    </div>
                    <div className="divide-y divide-steel-100">
                        {approvedUsers.map((user) => (
                            <div key={user.id} className="px-6 py-4 flex items-center gap-4 hover:bg-steel-50 transition-colors">
                                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm shrink-0">
                                    {([user.first_name, user.last_name].filter(Boolean).join(" ") || user.email)?.[0]?.toUpperCase() || "?"}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-steel-800">
                                        {[user.first_name, user.last_name].filter(Boolean).join(" ") || t("common.noName")}
                                    </p>
                                    <p className="text-xs text-steel-400">{user.email}</p>
                                </div>
                                <div className="text-right shrink-0 hidden sm:block">
                                    {user.approved_by_email ? (
                                        <>
                                            <p className="text-xs text-steel-500">{t("approvals.approvedBy")} {user.approved_by_email}</p>
                                            <p className="text-[11px] text-steel-400">{formatDate(user.approved_at)}</p>
                                        </>
                                    ) : (
                                        <p className="text-xs text-steel-400">{t("approvals.autoApproved")}</p>
                                    )}
                                </div>
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                                    {t("approvals.statusApproved")}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
