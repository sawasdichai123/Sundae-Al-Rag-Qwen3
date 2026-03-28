/**
 * DangerZonePage — Organization deletion management
 *
 * - Owner can request deletion
 * - Support/Admin can confirm or cancel deletion
 * - Owner can cancel their own request
 */

import { useState, useEffect, useCallback } from "react";
import { useToastStore } from "../store/toastStore";
import { useOrgStore, selectIsOrgOwner } from "../store/orgStore";
import { useAuthStore } from "../store/authStore";
import { orgApi } from "../api/endpoints";
import Spinner from "../components/Spinner";

export default function DangerZonePage() {
    const toast = useToastStore((s) => s.addToast);
    const activeOrgId = useOrgStore((s) => s.activeOrgId);
    const isOwner = useOrgStore(selectIsOrgOwner);
    const user = useAuthStore((s) => s.user);
    const userRole = user?.role;
    const fetchOrgs = useOrgStore((s) => s.fetchOrgs);

    // Main org = user's home org (organization_id) — cannot be deleted
    const isMainOrg = !!user?.organization_id && activeOrgId === user.organization_id;

    const canRequestDeletion = isOwner && !isMainOrg;
    const canConfirmDeletion = (userRole === "support" || userRole === "admin") && !isMainOrg;

    const [orgName, setOrgName] = useState("");
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
            setOrgStatus(data.status);
        } catch (err) {
            console.error("[DangerZone] Load failed:", err);
            toast("error", "โหลดข้อมูลองค์กรไม่สำเร็จ");
        } finally {
            setLoading(false);
        }
    }, [activeOrgId, toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

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

    const handleCancelDeletion = async () => {
        if (!activeOrgId) return;
        if (!confirm("ยกเลิกคำขอลบองค์กร?")) return;
        setCancellingDeletion(true);
        try {
            await orgApi.cancelDeletion(activeOrgId);
            toast("success", "ยกเลิกคำขอลบองค์กรสำเร็จ");
            await loadData();
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "ยกเลิกไม่สำเร็จ";
            toast("error", msg);
        } finally {
            setCancellingDeletion(false);
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
                <h1 className="text-2xl font-bold text-red-700 tracking-tight">
                    Danger Zone
                </h1>
                <p className="text-sm text-steel-500 mt-1">
                    การดำเนินการที่ไม่สามารถย้อนกลับได้
                </p>
            </div>

            {loading && (
                <div className="flex items-center justify-center py-12">
                    <Spinner />
                </div>
            )}

            {!loading && isMainOrg && (
                <div className="bg-white rounded-2xl border border-steel-200 p-6">
                    <h2 className="text-sm font-semibold text-steel-700 mb-2">
                        ลบองค์กร {orgName && `"${orgName}"`}
                    </h2>
                    <p className="text-xs text-steel-500">
                        ไม่สามารถลบองค์กรนี้ได้เนื่องจากเป็นองค์กรหลักของระบบ
                    </p>
                </div>
            )}

            {!loading && !isMainOrg && (canRequestDeletion || canConfirmDeletion) && (
                <div className="bg-white rounded-2xl border border-red-200 p-6">
                    <h2 className="text-sm font-semibold text-red-700 mb-2">
                        ลบองค์กร {orgName && `"${orgName}"`}
                    </h2>
                    <p className="text-xs text-steel-500 mb-4">
                        การลบองค์กรต้องได้รับการยืนยันจากทั้ง Admin ORG และ Support/Admin
                    </p>
                    {orgStatus === "pending_deletion" ? (
                        <div className="flex items-center gap-3">
                            {canConfirmDeletion && (
                                <button
                                    onClick={handleConfirmDeletion}
                                    disabled={confirmingDeletion}
                                    className="px-5 py-2.5 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-700 transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    {confirmingDeletion ? <Spinner /> : "ยืนยันการลบองค์กร"}
                                </button>
                            )}
                            {(canRequestDeletion || canConfirmDeletion) && (
                                <button
                                    onClick={handleCancelDeletion}
                                    disabled={cancellingDeletion}
                                    className="px-5 py-2.5 bg-steel-100 text-steel-700 text-sm font-bold rounded-xl hover:bg-steel-200 transition-colors cursor-pointer disabled:opacity-50"
                                >
                                    {cancellingDeletion ? <Spinner /> : "ยกเลิกคำขอลบ"}
                                </button>
                            )}
                            {!canConfirmDeletion && !canRequestDeletion && (
                                <div className="text-xs text-steel-500">
                                    มีคำขอลบองค์กรแล้ว — รอ Support/Admin ยืนยัน
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
                                {requestingDeletion ? <Spinner /> : "ขอลบองค์กร"}
                            </button>
                        ) : (
                            <div className="text-xs text-steel-500">
                                เฉพาะ Admin ORG เท่านั้นที่ส่งคำขอลบองค์กรได้
                            </div>
                        )
                    )}
                </div>
            )}

        </div>
    );
}
