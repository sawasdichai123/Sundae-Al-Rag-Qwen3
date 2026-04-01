/**
 * OrganizationPage — Org settings + member management
 *
 * Shows:
 * 1. Org settings (name edit) — owner/admin only
 * 2. Member list + invite + transfer/remove
 *
 * Danger Zone moved to DangerZonePage.
 */

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useToastStore } from "../store/toastStore";
import { useOrgStore, selectIsOrgAdmin } from "../store/orgStore";
import { useAuthStore } from "../store/authStore";
import { orgApi } from "../api/endpoints";
import type { OrgMember } from "../types";
import Spinner from "../components/Spinner";
import { useT } from "../i18n";

// ── Member Management Section ──────────────────────────────────

function MemberManagement({ orgId, isProtectedOrg }: { orgId: string; isProtectedOrg: boolean }) {
    const t = useT();
    const toast = useToastStore((s) => s.addToast);
    const fetchOrgs = useOrgStore((s) => s.fetchOrgs);
    const isOrgAdmin = useOrgStore(selectIsOrgAdmin);
    const userRole = useAuthStore((s) => s.user?.role);
    const canManage = isOrgAdmin && !isProtectedOrg;
    const [members, setMembers] = useState<OrgMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviting, setInviting] = useState(false);
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [promotingId, setPromotingId] = useState<string | null>(null);
    const [demotingId, setDemotingId] = useState<string | null>(null);

    const loadMembers = useCallback(async () => {
        try {
            const { data } = await orgApi.listMembers(orgId);
            setMembers(data || []);
        } catch (err) {
            console.error("[Org] Failed to load members:", err);
        } finally {
            setLoading(false);
        }
    }, [orgId]);

    useEffect(() => { loadMembers(); }, [loadMembers]);

    const handleInvite = async (e: FormEvent) => {
        e.preventDefault();
        if (!inviteEmail.trim()) return;
        setInviting(true);
        try {
            await orgApi.invite(orgId, inviteEmail.trim());
            toast("success", t("org.inviteSuccess").replace("{email}", inviteEmail.trim()));
            setInviteEmail("");
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("org.inviteFailed");
            toast("error", msg);
        } finally {
            setInviting(false);
        }
        loadMembers().catch(() => {});
    };

    const handlePromote = async (userId: string, name: string) => {
        if (!confirm(t("org.promoteConfirm").replace("{name}", name))) return;
        setPromotingId(userId);
        try {
            await orgApi.promoteMember(orgId, userId);
            toast("success", t("org.promoteSuccess").replace("{name}", name));
            await fetchOrgs();
            await loadMembers();
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("org.promoteFailed");
            toast("error", msg);
        } finally {
            setPromotingId(null);
        }
    };

    const handleDemote = async (userId: string, name: string) => {
        if (!confirm(t("org.demoteConfirm").replace("{name}", name))) return;
        setDemotingId(userId);
        try {
            await orgApi.demoteMember(orgId, userId);
            toast("success", t("org.demoteSuccess").replace("{name}", name));
            await fetchOrgs();
            await loadMembers();
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("org.demoteFailed");
            toast("error", msg);
        } finally {
            setDemotingId(null);
        }
    };

    const handleRemove = async (userId: string, name: string) => {
        if (!confirm(t("org.removeConfirm").replace("{name}", name))) return;
        setRemovingId(userId);
        try {
            await orgApi.removeMember(orgId, userId);
            toast("success", t("org.removeSuccess"));
            await loadMembers();
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("org.removeFailed");
            toast("error", msg);
        } finally {
            setRemovingId(null);
        }
    };

    return (
        <div className="bg-white rounded-2xl border border-steel-100 p-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-steel-800">
                    {t("org.members")} ({loading ? "..." : members.length})
                </h2>
            </div>

            {/* Member List */}
            {loading ? (
                <div className="flex items-center gap-2 text-steel-400 py-4">
                    <Spinner /> <span className="text-sm">{t("common.loading")}</span>
                </div>
            ) : (
                <div className="divide-y divide-steel-100 mb-5">
                    {members.map((m) => (
                        <div key={m.user_id} className="flex items-center gap-3 py-3">
                            <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-xs shrink-0">
                                {([m.first_name, m.last_name].filter(Boolean).join(" ") || m.email)?.[0]?.toUpperCase() || "?"}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-steel-800 truncate">
                                    {[m.first_name, m.last_name].filter(Boolean).join(" ") || t("common.noName")}
                                </p>
                                <p className="text-xs text-steel-400 truncate">{m.email}</p>
                            </div>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                m.org_role === "admin"
                                    ? "bg-brand-100 text-brand-700"
                                    : m.role === "admin"
                                        ? "bg-red-100 text-red-700"
                                        : m.role === "support"
                                            ? "bg-violet-100 text-violet-700"
                                            : "bg-steel-100 text-steel-500"
                            }`}>
                                {m.role === "admin" ? "admin" : m.role === "support" ? "support" : m.org_role === "admin" ? t("role.adminOrg") : m.org_role}
                            </span>
                            {canManage && m.role !== "admin" && m.role !== "support" && (
                                <div className="flex items-center gap-2">
                                    {/* Promote member → Org Admin */}
                                    {m.org_role === "member" && (
                                        <button
                                            onClick={() => handlePromote(m.user_id, [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email)}
                                            disabled={promotingId === m.user_id}
                                            className="text-xs text-brand-600 hover:text-brand-800 transition-colors cursor-pointer disabled:opacity-50"
                                            title={t("org.promoteTitle")}
                                        >
                                            {promotingId === m.user_id ? "..." : t("org.promote")}
                                        </button>
                                    )}
                                    {/* Demote Org Admin → member (only if >1 admins) */}
                                    {m.org_role === "admin" && members.filter(x => x.org_role === "admin").length > 1 && (
                                        <button
                                            onClick={() => handleDemote(m.user_id, [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email)}
                                            disabled={demotingId === m.user_id}
                                            className="text-xs text-amber-600 hover:text-amber-800 transition-colors cursor-pointer disabled:opacity-50"
                                            title={t("org.demoteTitle")}
                                        >
                                            {demotingId === m.user_id ? "..." : t("org.demote")}
                                        </button>
                                    )}
                                    {/* Remove — only for members, not admins */}
                                    {m.org_role === "member" && (
                                        <button
                                            onClick={() => handleRemove(m.user_id, [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email)}
                                            disabled={removingId === m.user_id}
                                            className="text-xs text-red-500 hover:text-red-700 transition-colors cursor-pointer disabled:opacity-50"
                                        >
                                            {removingId === m.user_id ? "..." : t("common.delete")}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Invite Form */}
            <div className="border-t border-steel-100 pt-4">
                <p className="text-xs font-medium text-steel-600 mb-2">{t("org.invite")}</p>
                <form onSubmit={handleInvite} className="flex gap-2">
                    <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="email@example.com"
                        required
                        disabled={inviting}
                        className="flex-1 px-3 py-2 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                    />
                    <button
                        type="submit"
                        disabled={inviting || !inviteEmail.trim()}
                        className="px-4 py-2 bg-brand-400 text-steel-900 text-xs font-bold rounded-xl hover:bg-brand-500 transition-colors cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                    >
                        {inviting ? <><Spinner /> {t("org.inviteSending")}</> : t("org.sendInvite")}
                    </button>
                </form>
            </div>
        </div>
    );
}

// ── Page ────────────────────────────────────────────────────────

export default function OrganizationPage() {
    const t = useT();
    const toast = useToastStore((s) => s.addToast);
    const activeOrgId = useOrgStore((s) => s.activeOrgId);
    const isOrgAdmin = useOrgStore(selectIsOrgAdmin);
    const userRole = useAuthStore((s) => s.user?.role);
    const fetchOrgs = useOrgStore((s) => s.fetchOrgs);
    const userId = useAuthStore((s) => s.user?.id);

    const canManage = isOrgAdmin;
    const navigate = useNavigate();

    // Org details
    const [orgName, setOrgName] = useState("");
    const [orgSlug, setOrgSlug] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [leaving, setLeaving] = useState(false);
    const [saving, setSaving] = useState(false);

    const isProtectedOrg = orgSlug === "sundae";

    const loadData = useCallback(async () => {
        if (!activeOrgId) return;
        setLoading(true);
        try {
            const { data } = await orgApi.get(activeOrgId);
            setOrgName(data.name);
            setOrgSlug(data.slug ?? null);
        } catch (err) {
            console.error("[Org] Load failed:", err);
            toast("error", t("org.loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [activeOrgId, toast, t]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleLeave = async () => {
        if (!activeOrgId || !userId) return;
        if (!confirm(t("org.leaveConfirm"))) return;
        setLeaving(true);
        try {
            await orgApi.leave(activeOrgId);
            toast("success", t("org.leaveSuccess"));
            await fetchOrgs();
            navigate("/create-org", { replace: true });
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("org.leaveFailed");
            toast("error", msg);
        } finally {
            setLeaving(false);
        }
    };

    const handleUpdateName = async (e: FormEvent) => {
        e.preventDefault();
        if (!activeOrgId || !orgName.trim()) return;
        setSaving(true);
        try {
            await orgApi.update(activeOrgId, orgName.trim());
            toast("success", t("org.updateSuccess"));
            await fetchOrgs();
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || t("org.updateFailed");
            toast("error", msg);
        } finally {
            setSaving(false);
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
        <div className="animate-fade-in">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-steel-900 tracking-tight">
                    {t("org.title")}
                </h1>
                <p className="text-sm text-steel-500 mt-1">
                    {t("org.desc")}
                </p>
            </div>

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center py-12">
                    <Spinner />
                </div>
            )}

            {/* 1. Org Settings */}
            {!loading && canManage && (
                <div className="bg-white rounded-2xl border border-steel-100 p-6 mb-6">
                    <h2 className="text-sm font-semibold text-steel-800 mb-4">{t("org.settings")}</h2>
                    <form onSubmit={handleUpdateName} className="flex gap-3">
                        <input
                            type="text"
                            value={orgName}
                            onChange={(e) => setOrgName(e.target.value)}
                            className="flex-1 px-4 py-2.5 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                            disabled={saving}
                        />
                        <button
                            type="submit"
                            disabled={saving || !orgName.trim()}
                            className="px-5 py-2.5 bg-brand-400 text-steel-900 text-sm font-bold rounded-xl hover:bg-brand-500 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                        >
                            {saving ? <Spinner /> : t("common.save")}
                        </button>
                    </form>
                </div>
            )}

            {/* 2. Member Management — Org Admin OR platform staff (can invite, cannot promote/demote/remove) */}
            {!loading && (isOrgAdmin || userRole === "admin" || userRole === "support") && (
                <MemberManagement orgId={activeOrgId} isProtectedOrg={isProtectedOrg} />
            )}

            {/* 3. Leave Organization — hide for platform staff who aren't actual org members, and hide for protected org */}
            {!loading && !isProtectedOrg && !(( userRole === "admin" || userRole === "support") && !isOrgAdmin) && (
                <div className="mt-6 bg-white rounded-2xl border border-steel-100 p-6">
                    <h2 className="text-sm font-semibold text-steel-800 mb-1">{t("org.leaveTitle")}</h2>
                    <p className="text-xs text-steel-500 mb-4">{t("org.leaveDesc")}</p>
                    <button
                        onClick={handleLeave}
                        disabled={leaving}
                        className="px-5 py-2.5 bg-red-100 text-red-700 text-sm font-bold rounded-xl hover:bg-red-200 transition-colors cursor-pointer disabled:opacity-50"
                    >
                        {leaving ? <Spinner /> : t("org.leave")}
                    </button>
                </div>
            )}
        </div>
    );
}
