/**
 * ResetPasswordPage — Set new password after clicking email reset link
 *
 * Flow:
 * 1. Supabase redirects here with recovery token in URL hash
 * 2. detectSessionInUrl (supabaseClient) processes the hash → establishes session
 * 3. onAuthStateChange fires PASSWORD_RECOVERY → we know session is ready
 * 4. User enters new password → supabase.auth.updateUser({ password })
 *
 * If the link is expired/invalid, Supabase puts error info in the URL hash.
 * We detect this and show a friendly message.
 */

import { useState, useEffect, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../api/supabaseClient";
import Spinner from "../components/Spinner";

type PageState = "loading" | "ready" | "expired";

export default function ResetPasswordPage() {
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [pageState, setPageState] = useState<PageState>("loading");

    useEffect(() => {
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const errorCode = params.get("error_code");
        const errorDesc = params.get("error_description");

        console.log("[ResetPassword] URL hash:", hash);
        console.log("[ResetPassword] error_code:", errorCode, "error_description:", errorDesc);

        // ── Case 1: URL hash has explicit error from Supabase ──
        if (errorCode || params.get("error")) {
            console.log("[ResetPassword] Supabase returned error in URL hash");

            // But still check if there's somehow a valid session (edge case)
            supabase.auth.getSession().then(({ data }) => {
                if (data.session) {
                    console.log("[ResetPassword] Session found despite URL error — showing form");
                    setPageState("ready");
                } else {
                    const msg = errorCode === "otp_expired" || errorDesc?.includes("expired")
                        ? "ลิงก์รีเซ็ตรหัสผ่านหมดอายุแล้ว กรุณาขอลิงก์ใหม่"
                        : "ลิงก์ไม่ถูกต้องหรือถูกใช้งานไปแล้ว กรุณาขอลิงก์ใหม่";
                    setError(msg);
                    setPageState("expired");
                }
            });
            return;
        }

        // ── Case 2: No error in URL — wait for recovery session ──
        // detectSessionInUrl processes the hash asynchronously, so listen for
        // PASSWORD_RECOVERY event or check session after a short delay.
        let resolved = false;

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            console.log("[ResetPassword] onAuthStateChange:", event, !!session);
            if (resolved) return;
            if (event === "PASSWORD_RECOVERY" && session) {
                resolved = true;
                setPageState("ready");
            }
        });

        // Also check existing session (in case event already fired before listener)
        supabase.auth.getSession().then(({ data }) => {
            console.log("[ResetPassword] getSession:", !!data.session);
            if (resolved) return;
            if (data.session) {
                resolved = true;
                setPageState("ready");
            }
        });

        // Timeout: if no session after 8 seconds, assume expired
        const timeout = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            console.log("[ResetPassword] Timeout — no recovery session found");
            setError("ลิงก์หมดอายุหรือไม่ถูกต้อง กรุณาขอลิงก์ใหม่");
            setPageState("expired");
        }, 8000);

        return () => {
            subscription.unsubscribe();
            clearTimeout(timeout);
        };
    }, []);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!password.trim() || !confirmPassword.trim()) return;

        if (password !== confirmPassword) {
            setError("รหัสผ่านไม่ตรงกัน กรุณากรอกใหม่");
            return;
        }
        if (password.length < 6) {
            setError("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
            return;
        }

        setLoading(true);
        setError("");

        // Timeout guard — 30s for slow Supabase free-tier
        const timeout = new Promise<{ error: { message: string } }>((resolve) =>
            setTimeout(() => resolve({ error: { message: "session_timeout" } }), 30000),
        );

        const result = await Promise.race([
            supabase.auth.updateUser({ password }),
            timeout,
        ]);

        const err = result.error;
        if (err) {
            const msg = err.message;
            if (msg === "session_timeout" || msg.includes("session")) {
                setError("ลิงก์หมดอายุหรือไม่ถูกต้อง กรุณาขอลิงก์ใหม่");
                setPageState("expired");
            } else if (msg.includes("same password")) {
                setError("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม");
            } else {
                console.error("[ResetPassword] updateUser error:", msg);
                setError(`ไม่สามารถเปลี่ยนรหัสผ่านได้: ${msg}`);
            }
            setLoading(false);
            return;
        }

        // Password changed — redirect then sign out
        window.location.href = "/login?reset=success";
        supabase.auth.signOut().catch(() => {});
    };

    return (
        <div className="animate-fade-in">
            {/* Brand Header */}
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-brand-400 flex items-center justify-center text-steel-900 text-sm font-bold shadow-sm">
                    S
                </div>
                <div>
                    <h2 className="text-lg font-bold text-steel-900">ตั้งรหัสผ่านใหม่</h2>
                    <p className="text-xs text-steel-400">SUNDAE Admin Dashboard</p>
                </div>
            </div>

            {pageState === "loading" ? (
                /* ── Loading State — waiting for recovery session ── */
                <div className="flex items-center justify-center gap-2 py-12 text-steel-400">
                    <Spinner /> <span className="text-sm">กำลังตรวจสอบลิงก์...</span>
                </div>
            ) : pageState === "expired" ? (
                /* ── Expired/Invalid Link State ────────────────── */
                <div className="space-y-4">
                    <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                        <p className="text-sm text-red-700 font-medium mb-1">
                            {error || "ลิงก์หมดอายุหรือไม่ถูกต้อง กรุณาขอลิงก์ใหม่"}
                        </p>
                        <p className="text-xs text-red-600">
                            ลิงก์รีเซ็ตรหัสผ่านมีอายุจำกัด กรุณาขอลิงก์ใหม่แล้วกดลิงก์ทันที
                        </p>
                    </div>
                    <Link
                        to="/forgot-password"
                        className="block w-full text-center bg-brand-400 text-steel-900 py-3 rounded-xl font-bold text-sm hover:bg-brand-500 transition-colors shadow-md shadow-brand-200"
                    >
                        ขอลิงก์รีเซ็ตใหม่
                    </Link>
                    <Link
                        to="/login"
                        className="block text-center text-sm text-steel-400 hover:text-brand-500 transition-colors"
                    >
                        กลับไปหน้าเข้าสู่ระบบ
                    </Link>
                </div>
            ) : (
                /* ── Form State ─────────────────────────────────── */
                <>
                    <p className="text-sm text-steel-500 mb-5">
                        กรอกรหัสผ่านใหม่ที่ต้องการใช้งาน (อย่างน้อย 6 ตัวอักษร)
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
                            <label htmlFor="new-password" className="block text-xs font-medium text-steel-600 mb-1.5">
                                รหัสผ่านใหม่
                            </label>
                            <input
                                id="new-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="อย่างน้อย 6 ตัวอักษร"
                                required
                                minLength={6}
                                autoComplete="new-password"
                                autoFocus
                                disabled={loading}
                                className="w-full px-4 py-2.5 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                            />
                        </div>
                        <div>
                            <label htmlFor="confirm-password" className="block text-xs font-medium text-steel-600 mb-1.5">
                                ยืนยันรหัสผ่านใหม่
                            </label>
                            <input
                                id="confirm-password"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="กรอกรหัสผ่านอีกครั้ง"
                                required
                                minLength={6}
                                autoComplete="new-password"
                                disabled={loading}
                                className="w-full px-4 py-2.5 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading || !password.trim() || !confirmPassword.trim()}
                            className="w-full bg-brand-400 text-steel-900 py-3 rounded-xl font-bold text-sm hover:bg-brand-500 transition-colors cursor-pointer shadow-md shadow-brand-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <><Spinner /> กำลังเปลี่ยนรหัสผ่าน...</>
                            ) : (
                                "ตั้งรหัสผ่านใหม่"
                            )}
                        </button>
                    </form>
                </>
            )}

            <p className="text-[10px] text-steel-400 text-center mt-6">
                &copy; 2026 SUNDAE &middot; Powered by Supabase Auth
            </p>
        </div>
    );
}
