/**
 * OrganizationPage — Org settings + member management
 *
 * Shows:
 * 1. Org settings (name edit) — Org Admin only
 * 2. Member list + invite + promote/demote/remove
 *
 * Danger Zone moved to DangerZonePage.
 */

import { useState, useEffect, useCallback, useRef, type FormEvent } from "react";
import { useToastStore } from "../store/toastStore";
import { useOrgStore, selectIsOrgAdmin } from "../store/orgStore";
import { useAuthStore } from "../store/authStore";
import { orgApi } from "../api/endpoints";
import { getApiError } from "../utils/apiError";
import type { OrgMember, OrgInvitation } from "../types";
import Spinner from "../components/Spinner";
import { useT } from "../i18n";

const LOGO_ALLOWED = ["jpg", "jpeg", "png", "webp"];
const LOGO_MAGIC: Record<string, { bytes: number[]; length: number }> = {
    jpg:  { bytes: [0xff, 0xd8, 0xff], length: 3 },
    jpeg: { bytes: [0xff, 0xd8, 0xff], length: 3 },
    png:  { bytes: [0x89, 0x50, 0x4e, 0x47], length: 4 },
    webp: { bytes: [0x52, 0x49, 0x46, 0x46], length: 4 },
};

// ── Member Management Section ──────────────────────────────────

function MemberManagement({ orgId, isProtectedOrg }: { orgId: string; isProtectedOrg: boolean }) {
    const t = useT();
    const toast = useToastStore((s) => s.addToast);
    const fetchOrgs = useOrgStore((s) => s.fetchOrgs);
    const isOrgAdmin = useOrgStore(selectIsOrgAdmin);
    const userRole = useAuthStore((s) => s.user?.role);
    const currentUserId = useAuthStore((s) => s.user?.id);
    const canManage = isOrgAdmin && !isProtectedOrg;
    const [members, setMembers] = useState<OrgMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviting, setInviting] = useState(false);
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [promotingId, setPromotingId] = useState<string | null>(null);
    const [demotingId, setDemotingId] = useState<string | null>(null);
    const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
    const [invLoading, setInvLoading] = useState(true);

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

    const loadInvitations = useCallback(async () => {
        try {
            const { data } = await orgApi.listOrgInvitations(orgId);
            setInvitations(data || []);
        } catch (err) {
            console.error("[Org] Failed to load invitations:", err);
        } finally {
            setInvLoading(false);
        }
    }, [orgId]);

    useEffect(() => { loadMembers(); loadInvitations(); }, [loadMembers, loadInvitations]);

    const handleInvite = async (e: FormEvent) => {
        e.preventDefault();
        if (!inviteEmail.trim()) return;
        setInviting(true);
        try {
            await orgApi.invite(orgId, inviteEmail.trim());
            toast("success", t("org.inviteSuccess").replace("{email}", inviteEmail.trim()));
            setInviteEmail("");
        } catch (err: unknown) {
            const raw = getApiError(err, t("org.inviteFailed"));
            const msg = raw.includes("not registered") ? t("org.userNotFound") : raw;
            toast("error", msg);
        } finally {
            setInviting(false);
        }
        loadMembers().catch(() => {});
        loadInvitations().catch(() => {});
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
            const msg = getApiError(err, t("org.promoteFailed"));
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
            const msg = getApiError(err, t("org.demoteFailed"));
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
            const msg = getApiError(err, t("org.removeFailed"));
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
                                    {/* Demote Org Admin → member (only if >1 admins and not self) */}
                                    {m.org_role === "admin" && members.filter(x => x.org_role === "admin").length > 1 && m.user_id !== currentUserId && (
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

            {/* Invitation History */}
            <div className="border-t border-steel-100 pt-4 mt-4">
                <p className="text-xs font-medium text-steel-600 mb-3">{t("org.invitationHistory")}</p>
                {invLoading ? (
                    <div className="flex items-center gap-2 text-steel-400 py-2">
                        <Spinner /> <span className="text-sm">{t("common.loading")}</span>
                    </div>
                ) : invitations.length === 0 ? (
                    <p className="text-xs text-steel-400 py-2">{t("org.noInvitations")}</p>
                ) : (
                    <div className="space-y-2">
                        {invitations.map((inv) => {
                            const statusColors: Record<string, string> = {
                                pending: "bg-amber-100 text-amber-700",
                                accepted: "bg-green-100 text-green-700",
                                declined: "bg-red-100 text-red-700",
                                expired: "bg-steel-100 text-steel-500",
                                revoked: "bg-steel-100 text-steel-500",
                            };
                            const statusKey = `org.invStatus.${inv.status}` as const;
                            return (
                                <div key={inv.id} className="flex items-center gap-3 py-2 px-3 bg-steel-50 rounded-xl">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-steel-800 truncate">{inv.invited_email}</p>
                                        <p className="text-[11px] text-steel-400 truncate">
                                            {inv.invited_by_email && <>{t("org.invitedBy")} {inv.invited_by_email} · </>}
                                            {new Date(inv.created_at).toLocaleDateString()}
                                        </p>
                                    </div>
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${statusColors[inv.status] || "bg-steel-100 text-steel-500"}`}>
                                        {t(statusKey)}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
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

    const canManage = isOrgAdmin;

    // Org details
    const [orgName, setOrgName] = useState("");
    const [orgNameDraft, setOrgNameDraft] = useState("");
    const [editingName, setEditingName] = useState(false);
    const [orgSlug, setOrgSlug] = useState<string | null>(null);
    const [orgLogoUrl, setOrgLogoUrl] = useState<string | null>(null);
    const [orgCreatedAt, setOrgCreatedAt] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const logoInputRef = useRef<HTMLInputElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);

    const isProtectedOrg = orgSlug === "sundae";

    const loadData = useCallback(async () => {
        if (!activeOrgId) return;
        setLoading(true);
        try {
            const { data } = await orgApi.get(activeOrgId);
            setOrgName(data.name);
            setOrgNameDraft(data.name);
            setOrgSlug(data.slug ?? null);
            setOrgLogoUrl((data as any).logo_url ?? null);
            setOrgCreatedAt((data as any).created_at ?? null);
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

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !activeOrgId) return;

        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (!LOGO_ALLOWED.includes(ext)) {
            toast("error", "ไฟล์ต้องเป็น JPG, PNG หรือ WebP เท่านั้น");
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            toast("error", "ไฟล์ใหญ่เกิน 2MB");
            return;
        }

        // Magic bytes validation
        const magic = LOGO_MAGIC[ext];
        if (magic) {
            const valid = await new Promise<boolean>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const buf = new Uint8Array(reader.result as ArrayBuffer);
                    resolve(magic.bytes.every((b, i) => buf[i] === b));
                };
                reader.readAsArrayBuffer(file.slice(0, magic.length));
            });
            if (!valid) { toast("error", "ไฟล์ไม่ถูกต้อง"); return; }
        }

        setUploadingLogo(true);
        try {
            await orgApi.uploadLogo(activeOrgId, file);
            toast("success", "อัพโหลดโลโก้สำเร็จ");
            await loadData();
            await fetchOrgs();
        } catch (err: unknown) {
            toast("error", getApiError(err, "อัพโหลดโลโก้ล้มเหลว"));
        } finally {
            setUploadingLogo(false);
            if (logoInputRef.current) logoInputRef.current.value = "";
        }
    };

    const handleStartEdit = () => {
        setOrgNameDraft(orgName);
        setEditingName(true);
        setTimeout(() => nameInputRef.current?.focus(), 50);
    };

    const handleCancelEdit = () => {
        setOrgNameDraft(orgName);
        setEditingName(false);
    };

    const handleSaveName = async () => {
        if (!activeOrgId || !orgNameDraft.trim()) return;
        setSaving(true);
        try {
            await orgApi.update(activeOrgId, orgNameDraft.trim());
            setOrgName(orgNameDraft.trim());
            setEditingName(false);
            toast("success", t("org.updateSuccess"));
            await fetchOrgs();
        } catch (err: unknown) {
            const msg = getApiError(err, t("org.updateFailed"));
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

            {/* 1. Org Info */}
            {!loading && canManage && (
                <div className="bg-white rounded-2xl border border-steel-100 mb-6 overflow-hidden">
                    {/* Header band */}
                    <div className="h-20 bg-gradient-to-r from-brand-400/20 via-brand-400/10 to-transparent" />

                    <div className="px-6 pb-6 -mt-10">
                        <div className="flex items-end gap-5 mb-6">
                            {/* Logo — overlaps header band */}
                            <div
                                className="w-24 h-24 rounded-2xl border-4 border-white bg-steel-50 flex items-center justify-center overflow-hidden cursor-pointer relative group shadow-sm shrink-0"
                                onClick={() => logoInputRef.current?.click()}
                            >
                                {orgLogoUrl ? (
                                    <img src={orgLogoUrl} alt="org logo" className="w-full h-full object-cover" />
                                ) : (
                                    <span className="text-3xl font-bold text-steel-300">
                                        {orgName?.[0]?.toUpperCase() || "O"}
                                    </span>
                                )}
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="white" className="w-5 h-5">
                                        <path fillRule="evenodd" d="M1 8a2 2 0 0 1 2-2h.93a2 2 0 0 0 1.664-.89l.812-1.22A2 2 0 0 1 8.07 3h3.86a2 2 0 0 1 1.664.89l.812 1.22A2 2 0 0 0 16.07 6H17a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8Zm13.5 3a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM10 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
                                    </svg>
                                </div>
                                {uploadingLogo && (
                                    <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                                        <Spinner />
                                    </div>
                                )}
                            </div>
                            <input ref={logoInputRef} type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" onChange={handleLogoUpload} />

                            {/* Org Name */}
                            <div className="flex-1 min-w-0 pb-1">
                                {editingName ? (
                                    <div className="flex items-center gap-2">
                                        <input
                                            ref={nameInputRef}
                                            type="text"
                                            value={orgNameDraft}
                                            onChange={(e) => setOrgNameDraft(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(); if (e.key === "Escape") handleCancelEdit(); }}
                                            className="flex-1 px-3 py-1.5 bg-steel-50 border-2 border-brand-400 rounded-xl text-xl font-bold text-steel-900 focus:ring-2 focus:ring-brand-200 outline-none transition-all"
                                            disabled={saving}
                                            maxLength={100}
                                        />
                                        <button
                                            onClick={handleSaveName}
                                            disabled={saving || !orgNameDraft.trim()}
                                            className="w-9 h-9 flex items-center justify-center text-white bg-green-500 hover:bg-green-600 rounded-xl transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                                            title={t("common.save")}
                                        >
                                            {saving ? <Spinner /> : (
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                                                </svg>
                                            )}
                                        </button>
                                        <button
                                            onClick={handleCancelEdit}
                                            className="w-9 h-9 flex items-center justify-center text-steel-500 bg-steel-100 hover:bg-steel-200 rounded-xl transition-colors cursor-pointer shrink-0"
                                            title={t("common.cancel")}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                                            </svg>
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-xl font-bold text-steel-900 truncate">{orgName}</h3>
                                        <button
                                            onClick={handleStartEdit}
                                            className="p-1.5 text-steel-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-all cursor-pointer shrink-0"
                                            title={t("common.edit")}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                                <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
                                                <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z" />
                                            </svg>
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Info grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="bg-steel-50 rounded-xl px-4 py-3">
                                <p className="text-[10px] font-semibold text-steel-400 uppercase tracking-wider mb-1">Org ID</p>
                                <p className="text-xs text-steel-700 font-mono truncate" title={activeOrgId}>{activeOrgId}</p>
                            </div>
                            {orgSlug && (
                                <div className="bg-steel-50 rounded-xl px-4 py-3">
                                    <p className="text-[10px] font-semibold text-steel-400 uppercase tracking-wider mb-1">Slug</p>
                                    <p className="text-xs text-steel-700 font-mono">{orgSlug}</p>
                                </div>
                            )}
                            {orgCreatedAt && (
                                <div className="bg-steel-50 rounded-xl px-4 py-3">
                                    <p className="text-[10px] font-semibold text-steel-400 uppercase tracking-wider mb-1">{t("common.created")}</p>
                                    <p className="text-xs text-steel-700">{new Date(orgCreatedAt).toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })}</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 2. Member Management — Org Admin OR platform staff (can invite, cannot promote/demote/remove) */}
            {!loading && (isOrgAdmin || userRole === "admin" || userRole === "support") && (
                <MemberManagement orgId={activeOrgId} isProtectedOrg={isProtectedOrg} />
            )}

        </div>
    );
}
