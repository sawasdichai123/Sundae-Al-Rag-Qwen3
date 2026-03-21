/**
 * ForgotPasswordPage — Send password reset email via Supabase
 *
 * User enters email → Supabase sends reset link → redirect to /reset-password
 */

import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../api/supabaseClient";
import Spinner from "../components/Spinner";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!email.trim()) return;
        setLoading(true);
        setError("");

        const { error: err } = await supabase.auth.resetPasswordForEmail(
            email.trim(),
            { redirectTo: `${window.location.origin}/reset-password` },
        );

        if (err) {
            setError(
                err.message.includes("rate limit")
                    ? "ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่"
                    : "ไม่สามารถส่งอีเมลได้ กรุณาลองใหม่อีกครั้ง",
            );
            setLoading(false);
            return;
        }

        setSent(true);
        setLoading(false);
    };

    return (
        <div className="animate-fade-in">
            {/* Brand Header */}
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-brand-400 flex items-center justify-center text-steel-900 text-sm font-bold shadow-sm">
                    S
                </div>
                <div>
                    <h2 className="text-lg font-bold text-steel-900">ลืมรหัสผ่าน</h2>
                    <p className="text-xs text-steel-400">SUNDAE Admin Dashboard</p>
                </div>
            </div>

            {sent ? (
                /* ── Success State ──────────────────────────────── */
                <div className="space-y-4">
                    <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                        <p className="text-sm text-emerald-700 font-medium mb-1">
                            ส่งลิงก์รีเซ็ตรหัสผ่านแล้ว
                        </p>
                        <p className="text-xs text-emerald-600">
                            กรุณาตรวจสอบอีเมล <span className="font-semibold">{email}</span> แล้วกดลิงก์ในอีเมลเพื่อตั้งรหัสผ่านใหม่
                        </p>
                    </div>
                    <Link
                        to="/login"
                        className="block w-full text-center bg-steel-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-steel-700 transition-colors"
                    >
                        กลับไปหน้าเข้าสู่ระบบ
                    </Link>
                </div>
            ) : (
                /* ── Form State ─────────────────────────────────── */
                <>
                    <p className="text-sm text-steel-500 mb-5">
                        กรอกอีเมลที่ใช้สมัครสมาชิก ระบบจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้
                    </p>

                    {error && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                            <span className="text-red-500 text-sm mt-0.5">!</span>
                            <p className="text-sm text-red-700 flex-1">{error}</p>
                            <button onClick={() => setError("")} className="text-red-400 hover:text-red-600 text-sm cursor-pointer">x</button>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="reset-email" className="block text-xs font-medium text-steel-600 mb-1.5">
                                อีเมล
                            </label>
                            <input
                                id="reset-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="name@company.com"
                                required
                                autoComplete="email"
                                autoFocus
                                disabled={loading}
                                className="w-full px-4 py-2.5 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading || !email.trim()}
                            className="w-full bg-brand-400 text-steel-900 py-3 rounded-xl font-bold text-sm hover:bg-brand-500 transition-colors cursor-pointer shadow-md shadow-brand-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <><Spinner /> กำลังส่ง...</>
                            ) : (
                                "ส่งลิงก์รีเซ็ตรหัสผ่าน"
                            )}
                        </button>
                    </form>

                    <Link
                        to="/login"
                        className="block text-center text-sm text-steel-400 hover:text-brand-500 transition-colors mt-4"
                    >
                        กลับไปหน้าเข้าสู่ระบบ
                    </Link>
                </>
            )}

            <p className="text-[10px] text-steel-400 text-center mt-6">
                &copy; 2025 SUNDAE &middot; Powered by Supabase Auth
            </p>
        </div>
    );
}

