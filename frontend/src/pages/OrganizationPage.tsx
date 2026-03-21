/**
 * OrganizationPage — Org settings and deletion
 *
 * Shows:
 * 1. Org settings (name edit) — owner only
 * 2. Danger zone — request/confirm deletion
 *
 * Members and invitations are managed from DashboardPage.
 */

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { useToastStore } from "../store/toastStore";
import { useOrgStore, selectIsOrgOwner } from "../store/orgStore";
import { useAuthStore } from "../store/authStore";
import { orgApi } from "../api/endpoints";
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
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Deletion
    const [requestingDeletion, setRequestingDeletion] = useState(false);
    const [confirmingDeletion, setConfirmingDeletion] = useState(false);

    const loadData = useCallback(async () => {
        if (!activeOrgId) return;
        setLoading(true);
        try {
            const { data } = await orgApi.get(activeOrgId);
            setOrgName(data.name);
            setOrgStatus(data.status);
        } catch (err) {
            console.error("[Org] Load failed:", err);
            toast("error", "โหลดข้อมูลองค์กรไม่สำเร็จ");
        } finally {
            setLoading(false);
        }
    }, [activeOrgId, toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

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
                    ตั้งค่าองค์กร
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

            {/* 2. Danger Zone */}
            {!loading && (canRequestDeletion || canConfirmDeletion) && (
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
