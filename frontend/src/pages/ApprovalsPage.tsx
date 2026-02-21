/**
 * ApprovalsPage — Support/Admin user approval dashboard
 *
 * Connected to Supabase user_profiles table via RLS.
 * Support/Admin can view pending users and approve them.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../api/supabaseClient";
import type { UserProfile } from "../types";

export default function ApprovalsPage() {
    const [pendingUsers, setPendingUsers] = useState<UserProfile[]>([]);
    const [approvedUsers, setApprovedUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [approvingId, setApprovingId] = useState<string | null>(null);

    // ── Load users from Supabase ────────────────────────────────
    const loadUsers = useCallback(async () => {
        setLoading(true);
        try {
            // Pending users
            const { data: pending, error: pendingErr } = await supabase
                .from("user_profiles")
                .select("*")
                .eq("is_approved", false)
                .order("created_at", { ascending: false });

            if (pendingErr) {
                console.error("[Approvals] Failed to load pending users:", pendingErr);
            } else {
                setPendingUsers(pending || []);
            }

            // Recently approved (last 20)
            const { data: approved, error: approvedErr } = await supabase
                .from("user_profiles")
                .select("*")
                .eq("is_approved", true)
                .order("created_at", { ascending: false })
                .limit(20);

            if (approvedErr) {
                console.error("[Approvals] Failed to load approved users:", approvedErr);
            } else {
                setApprovedUsers(approved || []);
            }
        } catch (err) {
            console.error("[Approvals] Unexpected error:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    // ── Approve handler (real DB update) ────────────────────────
    const handleApprove = async (userId: string) => {
        setApprovingId(userId);
        try {
            const { error } = await supabase
                .from("user_profiles")
                .update({ is_approved: true })
                .eq("id", userId);

            if (error) {
                console.error("[Approvals] Approve failed:", error);
                alert("อนุมัติไม่สำเร็จ: " + error.message);
                return;
            }

            // Refresh lists
            await loadUsers();
        } catch (err) {
            console.error("[Approvals] Unexpected error:", err);
            alert("เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
        } finally {
            setApprovingId(null);
        }
    };

    // ── Render ───────────────────────────────────────────────────
    return (
        <div className="animate-fade-in">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-steel-900 tracking-tight">
                    อนุมัติผู้ใช้งาน
                </h1>
                <p className="text-sm text-steel-500 mt-1">
                    ตรวจสอบและอนุมัติผู้ใช้ที่สมัครเข้าระบบ
                </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                    <p className="text-2xl font-bold text-amber-700">{loading ? "—" : pendingUsers.length}</p>
                    <p className="text-sm text-amber-600">รออนุมัติ</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
                    <p className="text-2xl font-bold text-emerald-700">{loading ? "—" : approvedUsers.length}</p>
                    <p className="text-sm text-emerald-600">อนุมัติแล้ว</p>
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
                        <span className="text-sm">กำลังโหลด...</span>
                    </div>
                </div>
            )}

            {/* Pending List */}
            {!loading && (
                <div className="bg-white rounded-2xl border border-steel-100 overflow-hidden">
                    <div className="px-6 py-4 border-b border-steel-100">
                        <h2 className="text-sm font-semibold text-steel-800">ผู้ใช้ที่รออนุมัติ</h2>
                    </div>

                    {pendingUsers.length === 0 ? (
                        <div className="px-6 py-12 text-center">
                            <p className="text-steel-400 text-sm">ไม่มีผู้ใช้ที่รออนุมัติ ✓</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-steel-100">
                            {pendingUsers.map((user) => (
                                <div key={user.id} className="px-6 py-4 flex items-center gap-4 hover:bg-steel-50 transition-colors">
                                    <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm shrink-0">
                                        {(user.full_name || user.email)?.[0]?.toUpperCase() || "?"}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-steel-800">{user.full_name || "ไม่ระบุชื่อ"}</p>
                                        <p className="text-xs text-steel-400">{user.email}</p>
                                    </div>
                                    <span className="text-xs text-steel-400 shrink-0 hidden sm:block">
                                        {new Date(user.created_at).toLocaleDateString("th-TH")}
                                    </span>
                                    <button
                                        onClick={() => handleApprove(user.id)}
                                        disabled={approvingId === user.id}
                                        className="px-4 py-2 bg-brand-400 text-steel-900 text-xs font-bold rounded-xl hover:bg-brand-500 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                                    >
                                        {approvingId === user.id ? "กำลัง..." : "อนุมัติ"}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Approved Users */}
            {!loading && approvedUsers.length > 0 && (
                <div className="mt-6 bg-white rounded-2xl border border-steel-100 overflow-hidden">
                    <div className="px-6 py-4 border-b border-steel-100">
                        <h2 className="text-sm font-semibold text-steel-800">อนุมัติแล้ว (ล่าสุด)</h2>
                    </div>
                    <div className="divide-y divide-steel-100">
                        {approvedUsers.map((user) => (
                            <div key={user.id} className="px-6 py-4 flex items-center gap-4 opacity-70">
                                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-sm shrink-0">
                                    ✓
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-steel-800">{user.full_name || "ไม่ระบุชื่อ"}</p>
                                    <p className="text-xs text-steel-400">{user.email}</p>
                                </div>
                                <span className="text-xs text-steel-400 hidden sm:block">
                                    {user.role}
                                </span>
                                <span className="text-xs text-emerald-600 font-medium">อนุมัติแล้ว</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
