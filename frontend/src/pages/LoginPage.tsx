/**
 * LoginPage — Real Supabase Email/Password Auth
 *
 * Two tabs: Sign In / Sign Up
 * Uses supabase.auth under the hood (via authStore).
 * NT Corporate Identity: White / Yellow (#ffd100) / Gray (#545659).
 */

import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { supabase } from "../api/supabaseClient";

type Tab = "login" | "register";

export default function LoginPage() {
    const { signIn, isAuthenticated, isLoading, authError, clearError } = useAuthStore();
    const [tab, setTab] = useState<Tab>("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [fullName, setFullName] = useState("");
    const [registerMsg, setRegisterMsg] = useState("");
    const [registerLoading, setRegisterLoading] = useState(false);

    // Already logged in → redirect to dashboard
    if (isAuthenticated) {
        return <Navigate to="/" replace />;
    }

    const switchTab = (t: Tab) => {
        setTab(t);
        clearError();
        setRegisterMsg("");
    };

    // ── Sign In ─────────────────────────────────────────────────
    const handleLogin = async (e: FormEvent) => {
        e.preventDefault();
        if (!email.trim() || !password.trim()) return;
        await signIn(email.trim(), password.trim());
    };

    // ── Sign Up ─────────────────────────────────────────────────
    const handleRegister = async (e: FormEvent) => {
        e.preventDefault();
        if (!email.trim() || !password.trim()) return;
        setRegisterLoading(true);
        setRegisterMsg("");
        clearError();

        // 1. Create auth user
        const { data, error } = await supabase.auth.signUp({
            email: email.trim(),
            password: password.trim(),
            options: {
                data: { full_name: fullName.trim() || null },
            },
        });

        if (error) {
            const msg = error.message.includes("already registered") || error.message.includes("User already registered")
                ? "อีเมลนี้มีผู้ใช้งานแล้ว กรุณาใช้อีเมลอื่น"
                : error.message.includes("Password should be")
                    ? "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"
                    : `❌ ${error.message}`;
            setRegisterMsg(msg);
            setRegisterLoading(false);
            return;
        }

        // user_profiles row ถูกสร้างอัตโนมัติโดย DB trigger (handle_new_auth_user)
        // ไม่ต้อง insert ตรงนี้ — trigger ใช้ SECURITY DEFINER bypass RLS ได้

        setRegisterMsg("✅ สมัครสำเร็จ! กรุณาเข้าสู่ระบบด้านล่าง (รอ Admin อนุมัติก่อนใช้งาน)");
        setRegisterLoading(false);
        setPassword("");
        // Auto-switch to login tab after 1.5s
        setTimeout(() => { setTab("login"); setRegisterMsg(""); }, 1500);
    };

    return (
        <div className="animate-fade-in">
            {/* Brand Header */}
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-brand-400 flex items-center justify-center text-steel-900 text-sm font-bold shadow-sm">
                    S
                </div>
                <div>
                    <h2 className="text-lg font-bold text-steel-900">
                        {tab === "login" ? "เข้าสู่ระบบ" : "สมัครใช้งาน"}
                    </h2>
                    <p className="text-xs text-steel-400">SUNDAE Admin Dashboard</p>
                </div>
            </div>

            {/* Tab Switcher */}
            <div className="flex bg-steel-100 rounded-xl p-1 mb-5">
                <button
                    onClick={() => switchTab("login")}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${tab === "login"
                            ? "bg-white text-steel-900 shadow-sm"
                            : "text-steel-500 hover:text-steel-700"
                        }`}
                >
                    เข้าสู่ระบบ
                </button>
                <button
                    onClick={() => switchTab("register")}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${tab === "register"
                            ? "bg-white text-steel-900 shadow-sm"
                            : "text-steel-500 hover:text-steel-700"
                        }`}
                >
                    สมัครใช้งาน
                </button>
            </div>

            {/* Error / Success Messages */}
            {authError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                    <span className="text-red-500 text-sm mt-0.5">⚠</span>
                    <p className="text-sm text-red-700 flex-1">{authError}</p>
                    <button onClick={clearError} className="text-red-400 hover:text-red-600 text-sm cursor-pointer">✕</button>
                </div>
            )}
            {registerMsg && (
                <div className={`mb-4 p-3 rounded-xl border text-sm ${registerMsg.startsWith("✅")
                        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                        : "bg-red-50 border-red-200 text-red-700"
                    }`}>
                    {registerMsg}
                </div>
            )}

            {/* ── Login Form ──────────────────────────────────── */}
            {tab === "login" && (
                <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                        <label htmlFor="login-email" className="block text-xs font-medium text-steel-600 mb-1.5">อีเมล</label>
                        <input
                            id="login-email" type="email" value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="name@company.com" required autoComplete="email" autoFocus
                            disabled={isLoading}
                            className="w-full px-4 py-2.5 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                        />
                    </div>
                    <div>
                        <label htmlFor="login-password" className="block text-xs font-medium text-steel-600 mb-1.5">รหัสผ่าน</label>
                        <input
                            id="login-password" type="password" value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••" required autoComplete="current-password"
                            disabled={isLoading}
                            className="w-full px-4 py-2.5 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={isLoading || !email.trim() || !password.trim()}
                        className="w-full bg-brand-400 text-steel-900 py-3 rounded-xl font-bold text-sm hover:bg-brand-500 transition-colors cursor-pointer shadow-md shadow-brand-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isLoading ? (
                            <><Spinner /> กำลังเข้าสู่ระบบ...</>
                        ) : (
                            "เข้าสู่ระบบ"
                        )}
                    </button>
                </form>
            )}

            {/* ── Register Form ───────────────────────────────── */}
            {tab === "register" && (
                <form onSubmit={handleRegister} className="space-y-4">
                    <div>
                        <label htmlFor="reg-name" className="block text-xs font-medium text-steel-600 mb-1.5">ชื่อ-นามสกุล</label>
                        <input
                            id="reg-name" type="text" value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            placeholder="สมชาย ใจดี" autoComplete="name" autoFocus
                            disabled={registerLoading}
                            className="w-full px-4 py-2.5 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                        />
                    </div>
                    <div>
                        <label htmlFor="reg-email" className="block text-xs font-medium text-steel-600 mb-1.5">อีเมล</label>
                        <input
                            id="reg-email" type="email" value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="name@company.com" required autoComplete="email"
                            disabled={registerLoading}
                            className="w-full px-4 py-2.5 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                        />
                    </div>
                    <div>
                        <label htmlFor="reg-password" className="block text-xs font-medium text-steel-600 mb-1.5">รหัสผ่าน (อย่างน้อย 6 ตัว)</label>
                        <input
                            id="reg-password" type="password" value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••" required autoComplete="new-password"
                            minLength={6}
                            disabled={registerLoading}
                            className="w-full px-4 py-2.5 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={registerLoading || !email.trim() || !password.trim()}
                        className="w-full bg-steel-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-steel-700 transition-colors cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {registerLoading ? (
                            <><Spinner /> กำลังสมัคร...</>
                        ) : (
                            "สมัครใช้งาน"
                        )}
                    </button>
                    <p className="text-[10px] text-steel-400 text-center">
                        สมัครแล้วต้องรอ Admin อนุมัติก่อนจึงจะใช้ฟีเจอร์ทั้งหมดได้
                    </p>
                </form>
            )}

            <p className="text-[10px] text-steel-400 text-center mt-6">
                © 2025 SUNDAE · Powered by Supabase Auth
            </p>
        </div>
    );
}

function Spinner() {
    return (
        <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
    );
}
