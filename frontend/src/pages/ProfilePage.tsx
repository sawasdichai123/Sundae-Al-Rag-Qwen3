/**
 * ProfilePage — User profile, org memberships, and pending invitations
 *
 * Sections:
 * A. Profile info (name, email, role badge, avatar upload) — user role can edit
 * B. My organizations (with "leave" button for members)
 * C. Pending invitations (accept/decline)
 */

import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";
import { useToastStore } from "../store/toastStore";
import { orgApi } from "../api/endpoints";
import { getApiError } from "../utils/apiError";
import { supabase } from "../api/supabaseClient";
import type { MyInvitation } from "../types";
import Spinner from "../components/Spinner";
import { useT } from "../i18n";

export default function ProfilePage() {
    const t = useT();
    const navigate = useNavigate();
    const user = useAuthStore((s) => s.user);
    const fetchProfile = useAuthStore((s) => s.fetchProfile);
    const orgs = useOrgStore((s) => s.orgs);
    const fetchOrgs = useOrgStore((s) => s.fetchOrgs);
    const setActiveOrg = useOrgStore((s) => s.setActiveOrg);
    const toast = useToastStore((s) => s.addToast);

    const [invitations, setInvitations] = useState<MyInvitation[]>([]);
    const [loadingInvites, setLoadingInvites] = useState(true);
    const [acceptingId, setAcceptingId] = useState<string | null>(null);
    const [decliningId, setDecliningId] = useState<string | null>(null);
    const [leavingOrgId, setLeavingOrgId] = useState<string | null>(null);
    const [lastAdminOrgId, setLastAdminOrgId] = useState<string | null>(null);

    // Edit name state
    const [editing, setEditing] = useState(false);
    const [editFirstName, setEditFirstName] = useState("");
    const [editLastName, setEditLastName] = useState("");
    const [saving, setSaving] = useState(false);

    // Avatar upload state
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isUser = user?.role === "user";

    // Load pending invitations
    useEffect(() => {
        (async () => {
            try {
                const { data } = await orgApi.myInvitations();
                setInvitations((data || []).filter((inv: MyInvitation) => inv.status === "pending"));
            } catch (err) {
                console.error("[Profile] Failed to load invitations:", err);
            } finally {
                setLoadingInvites(false);
            }
        })();
    }, []);

    const handleStartEdit = () => {
        setEditFirstName(user?.first_name || "");
        setEditLastName(user?.last_name || "");
        setEditing(true);
    };

    const handleCancelEdit = () => {
        setEditing(false);
    };

    const handleSaveProfile = async () => {
        if (!editFirstName.trim()) {
            toast("error", t("profile.firstNameRequired"));
            return;
        }
        setSaving(true);
        try {
            await orgApi.updateProfile(editFirstName.trim(), editLastName.trim());
            toast("success", t("profile.saveSuccess"));
            setEditing(false);
            // Refresh profile in store
            if (user?.id) await fetchProfile(user.id);
        } catch (err: unknown) {
            const msg = getApiError(err, t("profile.saveFailed"));
            toast("error", msg);
        } finally {
            setSaving(false);
        }
    };

    // ── Avatar Upload ───────────────────────────────────────────
    const handleAvatarClick = () => {
        fileInputRef.current?.click();
    };

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !user?.id) return;

        // Validate
        const MAX_SIZE = 2 * 1024 * 1024; // 2MB
        if (file.size > MAX_SIZE) {
            toast("error", t("profile.avatarTooBig"));
            return;
        }
        if (!file.type.startsWith("image/")) {
            toast("error", t("profile.avatarInvalid"));
            return;
        }

        setUploadingAvatar(true);
        try {
            // File path: avatars/{user_id}.{ext}
            const ext = file.name.split(".").pop() || "jpg";
            const filePath = `${user.id}.${ext}`;

            // Upload to Supabase Storage (upsert = overwrite if exists)
            const { error: uploadError } = await supabase.storage
                .from("avatars")
                .upload(filePath, file, { cacheControl: "3600", upsert: true });

            if (uploadError) throw uploadError;

            // Get public URL
            const { data: urlData } = supabase.storage
                .from("avatars")
                .getPublicUrl(filePath);

            const publicUrl = urlData.publicUrl + `?t=${Date.now()}`; // cache bust

            // Save URL to profile via API
            await orgApi.updateProfile(
                user.first_name || "",
                user.last_name || "",
                publicUrl,
            );

            toast("success", t("profile.avatarSuccess"));
            if (user.id) await fetchProfile(user.id);
        } catch (err: unknown) {
            console.error("[Profile] Avatar upload error:", err);
            toast("error", t("profile.avatarFailed"));
        } finally {
            setUploadingAvatar(false);
            // Reset file input
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleAccept = async (invitationId: string) => {
        setAcceptingId(invitationId);
        try {
            await orgApi.acceptInvitation(invitationId);
            toast("success", t("profile.acceptSuccess"));
            setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
            await fetchOrgs();
        } catch (err: unknown) {
            const msg = getApiError(err, t("profile.acceptFailed"));
            toast("error", msg);
        } finally {
            setAcceptingId(null);
        }
    };

    const handleDecline = async (invitationId: string) => {
        if (!confirm(t("profile.declineConfirm"))) return;
        setDecliningId(invitationId);
        try {
            await orgApi.declineInvitation(invitationId);
            toast("success", t("profile.declineSuccess"));
            setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
        } catch (err: unknown) {
            const msg = getApiError(err, t("profile.declineFailed"));
            toast("error", msg);
        } finally {
            setDecliningId(null);
        }
    };

    const handleLeave = async (orgId: string, orgName: string) => {
        if (!confirm(t("profile.leaveConfirm").replace("{name}", orgName))) return;
        setLeavingOrgId(orgId);
        try {
            await orgApi.leave(orgId);
            toast("success", t("profile.leaveSuccess").replace("{name}", orgName));
            await fetchOrgs();
        } catch (err: unknown) {
            const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            if (detail === "LAST_ORG_ADMIN") {
                setLastAdminOrgId(orgId);
            } else {
                toast("error", getApiError(err, t("profile.leaveFailed")));
            }
        } finally {
            setLeavingOrgId(null);
        }
    };

    const handleGoToDangerZone = (orgId: string) => {
        setLastAdminOrgId(null);
        setActiveOrg(orgId);
        navigate("/danger-zone");
    };

    const roleBadge = (role: string) => {
        const styles: Record<string, string> = {
            admin: "bg-red-100 text-red-700",
            support: "bg-violet-100 text-violet-700",
            user: "bg-steel-100 text-steel-600",
        };
        return (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${styles[role] || styles.user}`}>
                {role}
            </span>
        );
    };

    return (
        <div className="animate-fade-in max-w-2xl mx-auto">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-steel-900 tracking-tight">{t("profile.title")}</h1>
                <p className="text-sm text-steel-500 mt-1">{t("profile.desc")}</p>
            </div>

            {/* Section A: Profile Info */}
            <div className="bg-white rounded-2xl border border-steel-100 p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-steel-800">{t("profile.personalInfo")}</h2>
                    {isUser && !editing && (
                        <button
                            onClick={handleStartEdit}
                            className="text-xs font-medium text-brand-600 hover:text-brand-700 cursor-pointer"
                        >
                            {t("profile.edit")}
                        </button>
                    )}
                </div>

                {editing ? (
                    /* Edit Mode */
                    <div className="space-y-3">
                        {/* Avatar in edit mode */}
                        <div className="flex justify-center mb-2">
                            <button
                                type="button"
                                onClick={handleAvatarClick}
                                disabled={uploadingAvatar}
                                className="relative group cursor-pointer"
                            >
                                {user?.avatar_url ? (
                                    <img
                                        src={user.avatar_url}
                                        alt="avatar"
                                        className="w-20 h-20 rounded-full object-cover border-2 border-steel-200 group-hover:border-brand-400 transition-colors"
                                    />
                                ) : (
                                    <div className="w-20 h-20 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-2xl border-2 border-steel-200 group-hover:border-brand-400 transition-colors">
                                        {(user?.first_name || user?.email)?.[0]?.toUpperCase() || "?"}
                                    </div>
                                )}
                                <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    {uploadingAvatar ? (
                                        <Spinner />
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="white" className="w-5 h-5">
                                            <path d="M1 8a7 7 0 1 1 14 0A7 7 0 0 1 1 8Zm15.657-3.343a.75.75 0 0 0-1.061-1.061l-.707.707a.75.75 0 0 0 1.06 1.06l.708-.706ZM18 8a.75.75 0 0 0-.75-.75h-1a.75.75 0 0 0 0 1.5h1A.75.75 0 0 0 18 8ZM8 1a.75.75 0 0 0-.75.75v1a.75.75 0 0 0 1.5 0v-1A.75.75 0 0 0 8 1Z" />
                                        </svg>
                                    )}
                                </div>
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleAvatarUpload}
                                className="hidden"
                            />
                        </div>
                        <p className="text-center text-[10px] text-steel-400 -mt-1">{t("profile.avatarHint")}</p>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-steel-600 mb-1">{t("profile.firstName")}</label>
                                <input
                                    type="text"
                                    value={editFirstName}
                                    onChange={(e) => setEditFirstName(e.target.value)}
                                    className="w-full px-3 py-2 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all"
                                    placeholder={t("profile.firstName")}
                                    disabled={saving}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-steel-600 mb-1">{t("profile.lastName")}</label>
                                <input
                                    type="text"
                                    value={editLastName}
                                    onChange={(e) => setEditLastName(e.target.value)}
                                    className="w-full px-3 py-2 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all"
                                    placeholder={t("profile.lastName")}
                                    disabled={saving}
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-steel-500">
                            <span>{t("profile.email")}</span>
                            <span>{user?.email}</span>
                        </div>
                        <div className="flex gap-2 pt-1">
                            <button
                                onClick={handleSaveProfile}
                                disabled={saving}
                                className="px-4 py-2 bg-brand-400 text-steel-900 text-xs font-bold rounded-xl hover:bg-brand-500 transition-colors cursor-pointer disabled:opacity-50"
                            >
                                {saving ? <><Spinner /> {t("profile.saving")}</> : t("common.save")}
                            </button>
                            <button
                                onClick={handleCancelEdit}
                                disabled={saving}
                                className="px-4 py-2 bg-steel-100 text-steel-600 text-xs font-bold rounded-xl hover:bg-steel-200 transition-colors cursor-pointer disabled:opacity-50"
                            >
                                {t("common.cancel")}
                            </button>
                        </div>
                    </div>
                ) : (
                    /* View Mode */
                    <div className="flex items-center gap-4">
                        <div className="relative group">
                            {user?.avatar_url ? (
                                <img
                                    src={user.avatar_url}
                                    alt="avatar"
                                    className="w-14 h-14 rounded-full object-cover border-2 border-steel-100"
                                />
                            ) : (
                                <div className="w-14 h-14 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-xl shrink-0">
                                    {(user?.first_name || user?.email)?.[0]?.toUpperCase() || "?"}
                                </div>
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <p className="text-base font-semibold text-steel-900 truncate">
                                    {[user?.first_name, user?.last_name].filter(Boolean).join(" ") || t("common.noName")}
                                </p>
                                {user?.role && roleBadge(user.role)}
                            </div>
                            <p className="text-sm text-steel-500">{user?.email}</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Section B: My Organizations */}
            <div className="bg-white rounded-2xl border border-steel-100 mb-6 overflow-hidden">
                <div className="px-6 py-4 border-b border-steel-100">
                    <h2 className="text-sm font-semibold text-steel-800">{t("profile.myOrgs")} ({orgs.length})</h2>
                </div>
                {orgs.length === 0 ? (
                    <div className="px-6 py-8 text-center">
                        <p className="text-sm text-steel-400">{t("profile.noOrgs")}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-steel-100">
                        {orgs.map((org) => (
                            <div key={org.id} className="px-6 py-4 flex items-center gap-3">
                                <div className="w-8 h-8 rounded-md bg-brand-400/20 flex items-center justify-center text-brand-700 text-xs font-bold shrink-0">
                                    {org.name?.[0]?.toUpperCase() || "O"}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-steel-800 truncate">{org.name}</p>
                                </div>
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                    user?.role === "admin"
                                        ? "bg-red-100 text-red-700"
                                        : user?.role === "support"
                                            ? "bg-violet-100 text-violet-700"
                                            : org.org_role === "admin"
                                                ? "bg-brand-100 text-brand-700"
                                                : "bg-steel-100 text-steel-500"
                                }`}>
                                    {user?.role === "admin" ? "admin" : user?.role === "support" ? "support" : org.org_role === "admin" ? t("role.adminOrg") : org.org_role}
                                </span>
                                <button
                                    onClick={() => handleLeave(org.id, org.name)}
                                    disabled={leavingOrgId === org.id}
                                    className="px-3 py-1.5 bg-red-100 text-red-700 text-xs font-bold rounded-xl hover:bg-red-200 transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    {leavingOrgId === org.id ? "..." : t("profile.leaveOrg")}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Section C: Pending Invitations */}
            <div className="bg-white rounded-2xl border border-steel-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-steel-100">
                    <h2 className="text-sm font-semibold text-steel-800">
                        {t("profile.invitations")} {!loadingInvites && invitations.length > 0 && `(${invitations.length})`}
                    </h2>
                </div>
                {loadingInvites ? (
                    <div className="flex items-center gap-2 text-steel-400 px-6 py-6">
                        <Spinner /> <span className="text-sm">{t("common.loading")}</span>
                    </div>
                ) : invitations.length === 0 ? (
                    <div className="px-6 py-8 text-center">
                        <p className="text-sm text-steel-400">{t("profile.noInvitations")}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-steel-100">
                        {invitations.map((inv) => (
                            <div key={inv.id} className="px-6 py-4 flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm shrink-0">
                                    {inv.org_name?.[0]?.toUpperCase() || "O"}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-steel-800">{inv.org_name}</p>
                                    <p className="text-xs text-steel-400">
                                        {isNaN(new Date(inv.created_at).getTime()) ? "" : new Date(inv.created_at).toLocaleDateString()}
                                    </p>
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
                )}
            </div>

            {/* Last Admin Modal */}
            {lastAdminOrgId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
                        <h3 className="text-base font-bold text-steel-900 mb-2">{t("profile.lastAdminTitle")}</h3>
                        <p className="text-sm text-steel-500 mb-5">{t("profile.lastAdminDesc")}</p>
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setLastAdminOrgId(null)}
                                className="px-4 py-2 bg-steel-100 text-steel-600 text-xs font-bold rounded-xl hover:bg-steel-200 transition-colors cursor-pointer"
                            >
                                {t("common.cancel")}
                            </button>
                            <button
                                onClick={() => handleGoToDangerZone(lastAdminOrgId)}
                                className="px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-xl hover:bg-red-700 transition-colors cursor-pointer"
                            >
                                {t("profile.goToDangerZone")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
