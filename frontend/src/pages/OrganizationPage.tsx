/**
 * OrganizationPage — Org settings, members, invitations, deletion
 *
 * Replaces InviteMembersPage. Shows:
 * 1. Org settings (name edit) — owner only
 * 2. Members list with role badges — owner can remove
 * 3. Invite members — owner only
 * 4. Danger zone — request/confirm deletion
 */

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { useToastStore } from "../store/toastStore";
import { useOrgStore, selectIsOrgOwner } from "../store/orgStore";
import { useAuthStore } from "../store/authStore";
import { orgApi } from "../api/endpoints";
import type { OrgMember, OrgInvitation } from "../types";
import Spinner from "../components/Spinner";

export default function OrganizationPage() {
    const toast = useToastStore((s) => s.addToast);
    const activeOrgId = useOrgStore((s) => s.activeOrgId);
    const isOwner = useOrgStore(selectIsOrgOwner);
    const userRole = useAuthStore((s) => s.user?.role);
    const fetchOrgs = useOrgStore((s) => s.fetchOrgs);

    const canManage = isOwner || userRole === "admin";
    const canRequestDeletion = isOwner;
    const canConfirmDeletion = userRole === "support" || userRole === "admin";

    // Org details
    const [orgName, setOrgName] = useState("");
    const [orgStatus, setOrgStatus] = useState("active");
    const [saving, setSaving] = useState(false);

    // Members
    const [members, setMembers] = useState<OrgMember[]>([]);
    const [loadingMembers, setLoadingMembers] = useState(true);
    const [removingId, setRemovingId] = useState<string | null>(null);

    // Invitations
    const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviting, setInviting] = useState(false);

    // Deletion
    const [requestingDeletion, setRequestingDeletion] = useState(false);
    const [confirmingDeletion, setConfirmingDeletion] = useState(false);

    const loadData = useCallback(async () => {
        if (!activeOrgId) return;
        setLoadingMembers(true);
        try {
            const [orgRes, membersRes] = await Promise.all([
                orgApi.get(activeOrgId),
                orgApi.listMembers(activeOrgId),
            ]);
            setOrgName(orgRes.data.name);
            setOrgStatus(orgRes.data.status);
            setMembers(membersRes.data || []);
        } catch (err) {
            console.error("[Org] Load failed:", err);
            toast("error", "โหลดข้อมูลองค์กรไม่สำเร็จ");
        } finally {
            setLoadingMembers(false);
        }
    }, [activeOrgId, toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Load invitations separately (owner only)
    useEffect(() => {
        if (!activeOrgId || !canManage) return;
        // We don't have a list-by-org endpoint directly, but we can use the members/invitations from org router
        // For now, invitations are shown inline from the invite action
    }, [activeOrgId, canManage]);

    const handleUpdateName = async (e: FormEvent) => {
        e.preventDefault();
        if (!activeOrgId || !orgName.trim()) return;
        setSaving(true);
        try {
            await orgApi.update(activeOrgId, orgName.trim());
            toast("success", "อัปเดตชื่อองค์กรสำเร็จ");
            await fetchOrgs();
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "อัปเดตไม่สำเร็จ";
            toast("error", msg);
        } finally {
            setSaving(false);
        }
    };

    const handleInvite = async (e: FormEvent) => {
        e.preventDefault();
        if (!activeOrgId || !inviteEmail.trim()) return;
        setInviting(true);
        try {
            const { data } = await orgApi.invite(activeOrgId, inviteEmail.trim());
            toast("success", `ส่งคำเชิญไปยัง ${inviteEmail.trim()} สำเร็จ`);
            setInvitations((prev) => [...prev, data]);
            setInviteEmail("");
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "ส่งคำเชิญไม่สำเร็จ";
            toast("error", msg);
        } finally {
            setInviting(false);
        }
    };

    const handleRemoveMember = async (userId: string, name: string) => {
        if (!activeOrgId) return;
        if (!confirm(`ลบ ${name} ออกจากองค์กร?`)) return;
        setRemovingId(userId);
        try {
            await orgApi.removeMember(activeOrgId, userId);
            toast("success", "ลบสมาชิกสำเร็จ");
            await loadData();
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "ลบสมาชิกไม่สำเร็จ";
            toast("error", msg);
        } finally {
            setRemovingId(null);
        }
    };

    const handleRequestDeletion = async () => {
        if (!activeOrgId) return;
        if (!confirm("ขอลบองค์กร? การดำเนินการนี้ต้องได้รับการยืนยันจากอีกฝ่าย")) return;
        setRequestingDeletion(true);
        try {
            await orgApi.requestDeletion(activeOrgId);
            toast("success", "ส่งคำขอลบองค์กรสำเร็จ — รอการยืนยัน");
            await loadData();
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "ส่งคำขอไม่สำเร็จ";
            toast("error", msg);
        } finally {
            setRequestingDeletion(false);
        }
    };

    const handleConfirmDeletion = async () => {
        if (!activeOrgId) return;
        if (!confirm("ยืนยันการลบองค์กร? การดำเนินการนี้ไม่สามารถย้อนกลับได้")) return;
        setConfirmingDeletion(true);
        try {
            await orgApi.confirmDeletion(activeOrgId);
            toast("success", "ลบองค์กรสำเร็จ");
            await fetchOrgs();
            window.location.href = "/create-org";
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "ยืนยันการลบไม่สำเร็จ";
            toast("error", msg);
        } finally {
            setConfirmingDeletion(false);
        }
    };

    if (!activeOrgId) {
        return (
            <div className="animate-fade-in text-center py-12">
                <p className="text-steel-400">กรุณาเลือกองค์กรก่อน</p>
            </div>
        );
    }

    return (
        <div className="animate-fade-in max-w-2xl">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-steel-900 tracking-tight">
                    จัดการองค์กร
                </h1>
                <p className="text-sm text-steel-500 mt-1">
                    ตั้งค่าองค์กร สมาชิก และคำเชิญ
                </p>
            </div>

            {/* 1. Org Settings */}
            {canManage && (
                <div className="bg-white rounded-2xl border border-steel-100 p-6 mb-6">
                    <h2 className="text-sm font-semibold text-steel-800 mb-4">ตั้งค่าองค์กร</h2>
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
                            {saving ? <Spinner /> : "บันทึก"}
                        </button>
                    </form>
                </div>
            )}

            {/* 2. Members */}
            <div className="bg-white rounded-2xl border border-steel-100 mb-6 overflow-hidden">
                <div className="px-6 py-4 border-b border-steel-100">
                    <h2 className="text-sm font-semibold text-steel-800">สมาชิก ({members.length})</h2>
                </div>
                {loadingMembers ? (
                    <div className="px-6 py-8 text-center">
                        <Spinner />
                    </div>
                ) : members.length === 0 ? (
                    <div className="px-6 py-8 text-center text-sm text-steel-400">
                        ไม่มีสมาชิก
                    </div>
                ) : (
                    <div className="divide-y divide-steel-100">
                        {members.map((m) => (
                            <div key={m.user_id} className="px-6 py-3 flex items-center gap-4 hover:bg-steel-50 transition-colors">
                                <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-xs shrink-0">
                                    {(m.full_name || m.email)?.[0]?.toUpperCase() || "?"}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-steel-800">{m.full_name || m.email}</p>
                                    <p className="text-xs text-steel-400">{m.email}</p>
                                </div>
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                    m.org_role === "owner"
                                        ? "bg-brand-100 text-brand-700"
                                        : "bg-steel-100 text-steel-600"
                                }`}>
                                    {m.org_role}
                                </span>
                                {canManage && m.org_role !== "owner" && (
                                    <button
                                        onClick={() => handleRemoveMember(m.user_id, m.full_name || m.email)}
                                        disabled={removingId === m.user_id}
                                        className="text-xs text-red-500 hover:text-red-700 transition-colors cursor-pointer disabled:opacity-50"
                                    >
                                        {removingId === m.user_id ? "..." : "ลบ"}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 3. Invite */}
            {canManage && (
                <div className="bg-white rounded-2xl border border-steel-100 p-6 mb-6">
                    <h2 className="text-sm font-semibold text-steel-800 mb-4">เชิญสมาชิก</h2>
                    <form onSubmit={handleInvite} className="flex gap-3">
                        <input
                            type="email"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="email@example.com"
                            required
                            disabled={inviting}
                            className="flex-1 px-4 py-2.5 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                        />
                        <button
                            type="submit"
                            disabled={inviting || !inviteEmail.trim()}
                            className="px-5 py-2.5 bg-brand-400 text-steel-900 text-sm font-bold rounded-xl hover:bg-brand-500 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                        >
                            {inviting ? <Spinner /> : "ส่งคำเชิญ"}
                        </button>
                    </form>

                    {/* Recently sent invitations */}
                    {invitations.length > 0 && (
                        <div className="mt-4 space-y-2">
                            {invitations.map((inv) => (
                                <div key={inv.id} className="flex items-center gap-3 px-3 py-2 bg-steel-50 rounded-xl text-xs">
                                    <span className="text-steel-600 flex-1">{inv.invited_email}</span>
                                    <span className={`px-2 py-0.5 rounded-full font-medium ${
                                        inv.status === "pending"
                                            ? "bg-amber-100 text-amber-700"
                                            : inv.status === "accepted"
                                                ? "bg-emerald-100 text-emerald-700"
                                                : "bg-steel-200 text-steel-500"
                                    }`}>
                                        {inv.status}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 4. Danger Zone */}
            {(canRequestDeletion || canConfirmDeletion) && (
                <div className="bg-white rounded-2xl border border-red-200 p-6">
                    <h2 className="text-sm font-semibold text-red-700 mb-2">Danger Zone</h2>
                    <p className="text-xs text-steel-500 mb-4">
                        การลบองค์กรต้องได้รับการยืนยันจากทั้ง Owner และ Support/Admin
                    </p>
                    {orgStatus === "pending_deletion" ? (
                        canConfirmDeletion ? (
                            <button
                                onClick={handleConfirmDeletion}
                                disabled={confirmingDeletion}
                                className="px-5 py-2.5 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-700 transition-colors cursor-pointer disabled:opacity-50"
                            >
                                {confirmingDeletion ? <Spinner /> : "ยืนยันการลบองค์กร"}
                            </button>
                        ) : (
                            <div className="text-xs text-steel-500">
                                มีคำขอลบองค์กรแล้ว — รอ Support/Admin ยืนยัน
                            </div>
                        )
                    ) : (
                        canRequestDeletion ? (
                            <button
                                onClick={handleRequestDeletion}
                                disabled={requestingDeletion}
                                className="px-5 py-2.5 bg-red-100 text-red-700 text-sm font-bold rounded-xl hover:bg-red-200 transition-colors cursor-pointer disabled:opacity-50"
                            >
                                {requestingDeletion ? <Spinner /> : "ขอลบองค์กร"}
                            </button>
                        ) : (
                            <div className="text-xs text-steel-500">
                                เฉพาะ Owner เท่านั้นที่ส่งคำขอลบองค์กรได้
                            </div>
                        )
                    )}
                </div>
            )}
        </div>
    );
}
