/**
 * LoginPage — Real Supabase Email/Password Auth
 *
 * Two tabs: Sign In / Sign Up
 * Uses supabase.auth under the hood (via authStore).
 * NT Corporate Identity: White / Yellow (#ffd100) / Gray (#545659).
 *
 * Rate limiting: handled by Supabase built-in (server-side).
 * Frontend shows appropriate message when 429 / rate limit error received.
 */

import { useState, type FormEvent } from "react";
import { Navigate, Link, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { supabase } from "../api/supabaseClient";
import Spinner from "../components/Spinner";
import { useT } from "../i18n";

type Tab = "login" | "register";

function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    if (pw.length >= 12) score++;

    if (score <= 1) return { score, label: "pwStrengthWeak", color: "bg-red-500" };
    if (score === 2) return { score, label: "pwStrengthFair", color: "bg-orange-400" };
    if (score === 3) return { score, label: "pwStrengthGood", color: "bg-yellow-400" };
    if (score === 4) return { score, label: "pwStrengthStrong", color: "bg-emerald-400" };
    return { score, label: "pwStrengthVeryStrong", color: "bg-emerald-600" };
}

function validatePassword(pw: string): string | null {
    if (pw.length < 8) return "passwordTooShort";
    if (!/[A-Z]/.test(pw)) return "passwordNeedUpper";
    if (!/[0-9]/.test(pw)) return "passwordNeedNumber";
    if (!/[^A-Za-z0-9]/.test(pw)) return "passwordNeedSpecial";
    return null;
}

export default function LoginPage() {
    const { signIn, isAuthenticated, isLoading, authError, clearError } = useAuthStore();
    const [searchParams, setSearchParams] = useSearchParams();
    const t = useT();
    const resetSuccess = searchParams.get("reset") === "success";
    const [tab, setTab] = useState<Tab>("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [registerMsg, setRegisterMsg] = useState("");
    const [registerSuccess, setRegisterSuccess] = useState(false);
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [showLoginPassword, setShowLoginPassword] = useState(false);
    const [registerLoading, setRegisterLoading] = useState(false);

    // Already logged in → redirect to dashboard
    if (isAuthenticated) {
        return <Navigate to="/" replace />;
    }

    const isRateLimited = !!authError && (
        authError.toLowerCase().includes("rate") ||
        authError.toLowerCase().includes("too many") ||
        authError.toLowerCase().includes("429")
    );

    const switchTab = (newTab: Tab) => {
        setTab(newTab);
        clearError();
        setRegisterMsg("");
        setRegisterSuccess(false);
        if (resetSuccess) setSearchParams({}, { replace: true });
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
        if (!firstName.trim() || !lastName.trim()) {
            setRegisterMsg(t("login.nameRequired"));
            setRegisterSuccess(false);
            return;
        }
        if (!email.trim() || !password.trim()) return;
        if (password !== confirmPassword) {
            setRegisterMsg(t("login.passwordMismatch"));
            setRegisterSuccess(false);
            return;
        }
        const pwError = validatePassword(password.trim());
        if (pwError) {
            setRegisterMsg(t(`login.${pwError}`));
            setRegisterSuccess(false);
            return;
        }
        setRegisterLoading(true);
        setRegisterMsg("");
        clearError();

        const { error } = await supabase.auth.signUp({
            email: email.trim(),
            password: password.trim(),
            options: { data: { first_name: firstName.trim() || null, last_name: lastName.trim() || null } },
        });

        if (error) {
            let msg: string;
            if (error.message.includes("already registered") || error.message.includes("User already registered")) {
                msg = t("login.emailTaken");
            } else if (error.message.includes("password") && (error.message.includes("short") || error.message.includes("length") || error.message.includes("least"))) {
                msg = t("login.passwordTooShort");
            } else {
                msg = error.message;
            }
            setRegisterMsg(msg);
            setRegisterSuccess(false);
            setRegisterLoading(false);
            return;
        }

        setRegisterMsg(t("login.registerSuccess"));
        setRegisterSuccess(true);
        setRegisterLoading(false);
        setPassword("");
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
                        {tab === "login" ? t("login.signIn") : t("login.signUp")}
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
                    {t("login.signIn")}
                </button>
                <button
                    onClick={() => switchTab("register")}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${tab === "register"
                            ? "bg-white text-steel-900 shadow-sm"
                            : "text-steel-500 hover:text-steel-700"
                        }`}
                >
                    {t("login.signUp")}
                </button>
            </div>

            {/* Reset Password Success */}
            {resetSuccess && (
                <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
                    {t("login.resetSuccess")}
                </div>
            )}

            {/* Rate Limited Warning */}
            {isRateLimited && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                    {t("login.rateLimited")}
                </div>
            )}

            {/* Error / Success Messages */}
            {authError && !isRateLimited && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                    <p className="text-sm text-red-700 flex-1">{authError}</p>
                    <button onClick={clearError} className="text-red-400 hover:text-red-600 text-sm cursor-pointer">&times;</button>
                </div>
            )}
            {registerMsg && (
                <div className={`mb-4 p-3 rounded-xl border text-sm ${registerSuccess
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
                        <label htmlFor="login-email" className="block text-xs font-medium text-steel-600 mb-1.5">{t("login.email")}</label>
                        <input
                            id="login-email" type="email" value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="name@company.com" required autoComplete="email" autoFocus
                            disabled={isLoading}
                            className="w-full px-4 py-2.5 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                        />
                    </div>
                    <div>
                        <label htmlFor="login-password" className="block text-xs font-medium text-steel-600 mb-1.5">{t("login.password")}</label>
                        <div className="relative">
                            <input
                                id="login-password" type={showLoginPassword ? "text" : "password"} value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••" required autoComplete="current-password"
                                disabled={isLoading}
                                className="w-full px-4 py-2.5 pr-10 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                            />
                            <button type="button" tabIndex={-1} onClick={() => setShowLoginPassword(!showLoginPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-steel-400 hover:text-steel-600 cursor-pointer">
                                {showLoginPassword ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                )}
                            </button>
                        </div>
                        <div className="mt-1.5 text-right">
                            <Link to="/forgot-password" className="text-xs text-steel-400 hover:text-brand-500 transition-colors">
                                {t("login.forgotPassword")}
                            </Link>
                        </div>
                    </div>
                    <button
                        type="submit"
                        disabled={isLoading || !email.trim() || !password.trim()}
                        className="w-full bg-brand-400 text-steel-900 py-3 rounded-xl font-bold text-sm hover:bg-brand-500 transition-colors cursor-pointer shadow-md shadow-brand-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isLoading ? (
                            <><Spinner /> {t("login.signingIn")}</>
                        ) : (
                            t("login.signIn")
                        )}
                    </button>
                </form>
            )}

            {/* ── Register Form ───────────────────────────────── */}
            {tab === "register" && (
                <form onSubmit={handleRegister} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="reg-firstname" className="block text-xs font-medium text-steel-600 mb-1.5">{t("login.firstName")}</label>
                            <input
                                id="reg-firstname" type="text" value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                placeholder={t("login.firstNamePlaceholder")} autoComplete="given-name" autoFocus
                                required disabled={registerLoading}
                                className="w-full px-4 py-2.5 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                            />
                        </div>
                        <div>
                            <label htmlFor="reg-lastname" className="block text-xs font-medium text-steel-600 mb-1.5">{t("login.lastName")}</label>
                            <input
                                id="reg-lastname" type="text" value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                placeholder={t("login.lastNamePlaceholder")} autoComplete="family-name"
                                required disabled={registerLoading}
                                className="w-full px-4 py-2.5 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                            />
                        </div>
                    </div>
                    <div>
                        <label htmlFor="reg-email" className="block text-xs font-medium text-steel-600 mb-1.5">{t("login.email")}</label>
                        <input
                            id="reg-email" type="email" value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="name@company.com" required autoComplete="email"
                            disabled={registerLoading}
                            className="w-full px-4 py-2.5 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                        />
                    </div>
                    <div>
                        <label htmlFor="reg-password" className="block text-xs font-medium text-steel-600 mb-1.5">{t("login.passwordRequirements")}</label>
                        <div className="relative">
                            <input
                                id="reg-password" type={showPassword ? "text" : "password"} value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••" required autoComplete="new-password"
                                minLength={8}
                                disabled={registerLoading}
                                className="w-full px-4 py-2.5 pr-10 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                            />
                            <button type="button" tabIndex={-1} onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-steel-400 hover:text-steel-600 cursor-pointer">
                                {showPassword ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                )}
                            </button>
                        </div>
                        {password && (() => {
                            const strength = getPasswordStrength(password);
                            const checks = [
                                { pass: password.length >= 8, key: "pwRuleLength" },
                                { pass: /[A-Z]/.test(password), key: "pwRuleUpper" },
                                { pass: /[0-9]/.test(password), key: "pwRuleNumber" },
                                { pass: /[^A-Za-z0-9]/.test(password), key: "pwRuleSpecial" },
                            ];
                            return (
                                <div className="mt-2 space-y-1.5">
                                    <div className="flex gap-1 mb-1">
                                        {[1, 2, 3, 4, 5].map((i) => (
                                            <div
                                                key={i}
                                                className={`h-1.5 flex-1 rounded-full transition-all ${
                                                    i <= strength.score ? strength.color : "bg-steel-200"
                                                }`}
                                            />
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-steel-500">{t(`login.${strength.label}`)}</p>
                                    <ul className="space-y-0.5">
                                        {checks.map((c) => (
                                            <li key={c.key} className={`text-[10px] flex items-center gap-1.5 ${c.pass ? "text-emerald-600" : "text-steel-400"}`}>
                                                <span>{c.pass ? "✓" : "○"}</span>
                                                <span>{t(`login.${c.key}`)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            );
                        })()}
                    </div>
                    <div>
                        <label htmlFor="reg-confirm-password" className="block text-xs font-medium text-steel-600 mb-1.5">{t("login.confirmPassword")}</label>
                        <div className="relative">
                            <input
                                id="reg-confirm-password" type={showConfirmPassword ? "text" : "password"} value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="••••••••" required autoComplete="new-password"
                                disabled={registerLoading}
                                className="w-full px-4 py-2.5 pr-10 bg-steel-50 border border-steel-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-all disabled:opacity-50"
                            />
                            <button type="button" tabIndex={-1} onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-steel-400 hover:text-steel-600 cursor-pointer">
                                {showConfirmPassword ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                )}
                            </button>
                        </div>
                        {confirmPassword && password !== confirmPassword && (
                            <p className="text-[10px] text-red-500 mt-1">{t("login.passwordMismatch")}</p>
                        )}
                    </div>
                    <button
                        type="submit"
                        disabled={registerLoading || !email.trim() || !password.trim() || !confirmPassword || password !== confirmPassword || !firstName.trim() || !lastName.trim()}
                        className="w-full bg-steel-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-steel-700 transition-colors cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {registerLoading ? (
                            <><Spinner /> {t("login.signingUp")}</>
                        ) : (
                            t("login.signUp")
                        )}
                    </button>
                    <p className="text-[10px] text-steel-400 text-center">
                        {t("login.signUpNote")}
                    </p>
                </form>
            )}

            <p className="text-[10px] text-steel-400 text-center mt-6">
                © 2026 SUNDAE · Powered by Supabase Auth
            </p>
        </div>
    );
}
