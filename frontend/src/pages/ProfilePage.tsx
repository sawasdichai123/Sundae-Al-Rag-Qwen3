/**
 * ProfilePage — User profile, org memberships, and pending invitations
 *
 * Sections:
 * A. Profile info (name, email, role badge)
 * B. My organizations (with "leave" button for members)
 * C. Pending invitations (accept/decline)
 */

import { useState, useEffect } from "react";
import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";
import { useToastStore } from "../store/toastStore";
import { orgApi } from "../api/endpoints";
import type { MyInvitation } from "../types";
import Spinner from "../components/Spinner";

export default function ProfilePage() {
    const user = useAuthStore((s) => s.user);
    const orgs = useOrgStore((s) => s.orgs);
    const fetchOrgs = useOrgStore((s) => s.fetchOrgs);
    const toast = useToastStore((s) => s.addToast);

    const [invitations, setInvitations] = useState<MyInvitation[]>([]);
    const [loadingInvites, setLoadingInvites] = useState(true);
    const [acceptingId, setAcceptingId] = useState<string | null>(null);
    const [decliningId, setDecliningId] = useState<string | null>(null);
    const [leavingOrgId, setLeavingOrgId] = useState<string | null>(null);

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

    const handleAccept = async (invitationId: string) => {
        setAcceptingId(invitationId);
        try {
            await orgApi.acceptInvitation(invitationId);
            toast("success", "เข้าร่วมองค์กรสำเร็จ");
            setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
            await fetchOrgs();
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "เข้าร่วมองค์กรไม่สำเร็จ";
            toast("error", msg);
        } finally {
            setAcceptingId(null);
        }
    };

    const handleDecline = async (invitationId: string) => {
        if (!confirm("ปฏิเสธคำเชิญนี้?")) return;
        setDecliningId(invitationId);
        try {
            await orgApi.declineInvitation(invitationId);
            toast("success", "ปฏิเสธคำเชิญแล้ว");
            setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "ปฏิเสธคำเชิญไม่สำเร็จ";
            toast("error", msg);
        } finally {
            setDecliningId(null);
        }
    };

    const handleLeave = async (orgId: string, orgName: string) => {
        if (!confirm(`ออกจากองค์กร "${orgName}"? การดำเนินการนี้ไม่สามารถย้อนกลับได้`)) return;
        setLeavingOrgId(orgId);
        try {
            await orgApi.leave(orgId);
            toast("success", `ออกจาก "${orgName}" แล้ว`);
            await fetchOrgs();
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "ออกจากองค์กรไม่สำเร็จ";
            toast("error", msg);
        } finally {
            setLeavingOrgId(null);
        }
    };

    const roleBadge = (role: string) => {
        const styles: Record<string, string> = {
            admin: "bg-red-100 text-red-700",
            support: "bg-amber-100 text-amber-700",
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
                <h1 className="text-2xl font-bold text-steel-900 tracking-tight">โปรไฟล์</h1>
                <p className="text-sm text-steel-500 mt-1">ข้อมูลส่วนตัวและการเป็นสมาชิกองค์กร</p>
            </div>

            {/* Section A: Profile Info */}
            <div className="bg-white rounded-2xl border border-steel-100 p-6 mb-6">
                <h2 className="text-sm font-semibold text-steel-800 mb-4">ข้อมูลส่วนตัว</h2>
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-xl shrink-0">
                        {(user?.first_name || user?.email)?.[0]?.toUpperCase() || "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <p className="text-base font-semibold text-steel-900 truncate">
                                {[user?.first_name, user?.last_name].filter(Boolean).join(" ") || "ไม่ระบุชื่อ"}
                            </p>
                            {user?.role && roleBadge(user.role)}
                        </div>
                        <p className="text-sm text-steel-500">{user?.email}</p>
                    </div>
                </div>
            </div>

            {/* Section B: My Organizations */}
            <div className="bg-white rounded-2xl border border-steel-100 mb-6 overflow-hidden">
                <div className="px-6 py-4 border-b border-steel-100">
                    <h2 className="text-sm font-semibold text-steel-800">องค์กรของฉัน ({orgs.length})</h2>
                </div>
                {orgs.length === 0 ? (
                    <div className="px-6 py-8 text-center">
                        <p className="text-sm text-steel-400">ยังไม่ได้เป็นสมาชิกขององค์กรใด</p>
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
                                    org.org_role === "owner"
                                        ? "bg-brand-100 text-brand-700"
                                        : "bg-steel-100 text-steel-500"
                                }`}>
                                    {org.org_role}
                                </span>
                                {org.org_role === "member" && (
                                    <button
                                        onClick={() => handleLeave(org.id, org.name)}
                                        disabled={leavingOrgId === org.id}
                                        className="px-3 py-1.5 bg-red-100 text-red-700 text-xs font-bold rounded-xl hover:bg-red-200 transition-colors cursor-pointer disabled:opacity-50"
                                    >
                                        {leavingOrgId === org.id ? "..." : "ออกจากองค์กร"}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Section C: Pending Invitations */}
            <div className="bg-white rounded-2xl border border-steel-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-steel-100">
                    <h2 className="text-sm font-semibold text-steel-800">
                        คำเชิญที่ได้รับ {!loadingInvites && invitations.length > 0 && `(${invitations.length})`}
                    </h2>
                </div>
                {loadingInvites ? (
                    <div className="flex items-center gap-2 text-steel-400 px-6 py-6">
                        <Spinner /> <span className="text-sm">กำลังโหลด...</span>
                    </div>
                ) : invitations.length === 0 ? (
                    <div className="px-6 py-8 text-center">
                        <p className="text-sm text-steel-400">ไม่มีคำเชิญที่รอดำเนินการ</p>
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
                                        {isNaN(new Date(inv.created_at).getTime()) ? "" : new Date(inv.created_at).toLocaleDateString("th-TH")}
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleAccept(inv.id)}
                                        disabled={acceptingId === inv.id || decliningId === inv.id}
                                        className="px-4 py-2 bg-brand-400 text-steel-900 text-xs font-bold rounded-xl hover:bg-brand-500 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                                    >
                                        {acceptingId === inv.id ? "กำลัง..." : "เข้าร่วม"}
                                    </button>
                                    <button
                                        onClick={() => handleDecline(inv.id)}
                                        disabled={acceptingId === inv.id || decliningId === inv.id}
                                        className="px-4 py-2 bg-red-100 text-red-700 text-xs font-bold rounded-xl hover:bg-red-200 transition-colors cursor-pointer disabled:opacity-50"
                                    >
                                        {decliningId === inv.id ? "กำลัง..." : "ปฏิเสธ"}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
