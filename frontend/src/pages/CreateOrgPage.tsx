/**
 * CreateOrgPage — Repurposed by role
 *
 * - Support/Admin: Create org form + pending invitations
 * - Regular user with invitations: Show invitations (accept/decline)
 * - Regular user without invitations + no org: "Contact admin" message
 */

import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useToastStore } from "../store/toastStore";
import { useOrgStore } from "../store/orgStore";
import { useAuthStore } from "../store/authStore";
import { orgApi } from "../api/endpoints";
import { getApiError } from "../utils/apiError";
import type { MyInvitation } from "../types";
import Spinner from "../components/Spinner";
import { useT } from "../i18n";

export default function CreateOrgPage() {
    const t = useT();
    const navigate = useNavigate();
    const toast = useToastStore((s) => s.addToast);
    const fetchOrgs = useOrgStore((s) => s.fetchOrgs);
    const role = useAuthStore((s) => s.user?.role);

    const [orgName, setOrgName] = useState("");
    const [creating, setCreating] = useState(false);
    const [invitations, setInvitations] = useState<MyInvitation[]>([]);
    const [loadingInvites, setLoadingInvites] = useState(true);
    const [acceptingId, setAcceptingId] = useState<string | null>(null);
    const [decliningId, setDecliningId] = useState<string | null>(null);

    const isAdmin = role === "support" || role === "admin";

    // Load pending invitations
    useEffect(() => {
        (async () => {
            try {
                const { data } = await orgApi.myInvitations();
                setInvitations((data || []).filter((inv: MyInvitation) => inv.status === "pending"));
            } catch (err) {
                console.error("[CreateOrg] Failed to load invitations:", err);
            } finally {
                setLoadingInvites(false);
            }
        })();
    }, []);

    const handleCreate = async (e: FormEvent) => {
        e.preventDefault();
        if (!orgName.trim()) return;
        setCreating(true);
        try {
            await orgApi.create(orgName.trim());
            toast("success", t("createOrg.createSuccess"));
            await fetchOrgs();
            navigate("/", { replace: true });
        } catch (err: unknown) {
            console.error("[CreateOrg] Failed:", err);
            const msg = getApiError(err, t("createOrg.createFailed"));
            toast("error", msg);
        } finally {
            setCreating(false);
        }
    };

    const handleAccept = async (invitationId: string) => {
        setAcceptingId(invitationId);
        try {
            await orgApi.acceptInvitation(invitationId);
            toast("success", t("createOrg.acceptSuccess"));
            await fetchOrgs();
            navigate("/", { replace: true });
        } catch (err: unknown) {
            console.error("[CreateOrg] Accept failed:", err);
            const msg = getApiError(err, t("createOrg.acceptFailed"));
            toast("error", msg);
        } finally {
            setAcceptingId(null);
        }
    };

    const handleDecline = async (invitationId: string) => {
        if (!confirm(t("createOrg.declineConfirm"))) return;
        setDecliningId(invitationId);
        try {
            await orgApi.declineInvitation(invitationId);
            toast("success", t("createOrg.declineSuccess"));
            setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
        } catch (err: unknown) {
            console.error("[CreateOrg] Decline failed:", err);
            const msg = getApiError(err, t("createOrg.declineFailed"));
            toast("error", msg);
        } finally {
            setDecliningId(null);
        }
    };

    const hasInvitations = !loadingInvites && invitations.length > 0;
    const showContactAdmin = !isAdmin && !loadingInvites && invitations.length === 0;

    return (
        <div className="animate-fade-in max-w-lg mx-auto">
            <div className="mb-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-brand-100 flex items-center justify-center text-3xl mx-auto mb-4">
                    🏢
                </div>
                <h1 className="text-2xl font-bold text-steel-900">
                    {isAdmin ? t("createOrg.titleAdmin") : t("createOrg.titleUser")}
                </h1>
                <p className="text-sm text-steel-500 mt-1">
                    {isAdmin
                        ? t("createOrg.descAdmin")
                        : hasInvitations
                            ? t("createOrg.descInvite")
                            : t("createOrg.descWait")}
                </p>
            </div>

            {/* Loading */}
            {loadingInvites && (
                <div className="flex items-center justify-center py-12">
                    <div className="flex items-center gap-3 text-steel-400">
                        <Spinner />
                        <span className="text-sm">{t("common.loading")}</span>
                    </div>
                </div>
            )}

            {/* Pending Invitations */}
            {hasInvitations && (
                <div className="bg-white rounded-2xl border border-steel-100 mb-6 overflow-hidden">
                    <div className="px-6 py-4 border-b border-steel-100">
                        <h2 className="text-sm font-semibold text-steel-800">{t("createOrg.pendingInvitations")}</h2>
                    </div>
                    <div className="divide-y divide-steel-100">
                        {invitations.map((inv) => (
                            <div key={inv.id} className="px-6 py-4 flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm shrink-0 overflow-hidden">
                                    {inv.org_logo_url
                                        ? <img src={inv.org_logo_url} alt={inv.org_name} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; e.currentTarget.parentElement!.textContent = inv.org_name?.[0]?.toUpperCase() || "O"; }} />
                                        : (inv.org_name?.[0]?.toUpperCase() || "O")}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-steel-800">{inv.org_name}</p>
                                    <p className="text-xs text-steel-400">{t("createOrg.invitedTo").replace("{email}", inv.invited_email)}</p>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleAccept(inv.id)}
                                        disabled={acceptingId === inv.id || decliningId === inv.id}
                                        className="px-4 py-2 bg-brand-400 text-steel-900 text-xs font-bold rounded-xl hover:bg-brand-500 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                                    >
                                        {acceptingId === inv.id ? t("common.processing") : t("profile.accept")}
                                    </button>
                                    <button
                                        onClick={() => handleDecline(inv.id)}
                                        disabled={acceptingId === inv.id || decliningId === inv.id}
                                        className="px-4 py-2 bg-red-100 text-red-700 text-xs font-bold rounded-xl hover:bg-red-200 transition-colors cursor-pointer disabled:opacity-50"
                                    >
                                        {decliningId === inv.id ? t("common.processing") : t("profile.decline")}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Contact Admin Message — regular users without invitations */}
            {showContactAdmin && (
                <div className="bg-white rounded-2xl border border-steel-100 p-8 text-center">
                    <div className="w-12 h-12 rounded-full bg-steel-100 flex items-center justify-center text-steel-400 text-xl mx-auto mb-4">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                            <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 9a.75.75 0 0 0-1.5 0v2.25H9a.75.75 0 0 0 0 1.5h2.25V15a.75.75 0 0 0 1.5 0v-2.25H15a.75.75 0 0 0 0-1.5h-2.25V9Z" clipRule="evenodd" />
                        </svg>
                    </div>
                    <h3 className="text-sm font-semibold text-steel-800 mb-2">
                        {t("createOrg.noInvitations")}
                    </h3>
                    <p className="text-xs text-steel-500 leading-relaxed">
                        {t("createOrg.contactAdmin")}
                    </p>
                </div>
            )}

            {/* Create Org Form — support/admin only */}
            {isAdmin && !loadingInvites && (
                <div className="bg-white rounded-2xl border border-steel-100 p-6">
                    <h2 className="text-sm font-semibold text-steel-800 mb-4">{t("createOrg.createNew")}</h2>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div>
                            <label htmlFor="org-name" className="block text-xs font-medium text-steel-600 mb-1.5">
                                {t("createOrg.orgName")}
                            </label>
                            <input
                                id="org-name"
                                type="text"
                                value={orgName}
                                onChange={(e) => setOrgName(e.target.value)}
                                placeholder={t("createOrg.namePlaceholder")}
                                required
                                disabled={creating}
                                autoFocus
                                className="w-full px-4 py-2.5 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={creating || !orgName.trim()}
                            className="w-full bg-brand-400 text-steel-900 py-3 rounded-xl font-bold text-sm hover:bg-brand-500 transition-colors cursor-pointer shadow-md shadow-brand-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {creating ? <><Spinner /> {t("createOrg.creating")}</> : t("createOrg.createButton")}
                        </button>
                    </form>
                </div>
            )}
        </div>
    );
}
