/**
 * SUNDAE Frontend — App.tsx (Role-Based Routing + Auth Lifecycle)
 *
 * AuthProvider wraps the app and listens to Supabase onAuthStateChange.
 * On mount, restores the session from localStorage if present.
 */

import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { supabase } from "./api/supabaseClient";
import { useAuthStore } from "./store/authStore";
import { useOrgStore } from "./store/orgStore";

// Layouts
import DashboardLayout from "./layouts/DashboardLayout";
import AuthLayout from "./layouts/AuthLayout";

// Route Guard
import ProtectedRoute from "./components/ProtectedRoute";

// Global UI
import ToastContainer from "./components/ToastContainer";

// Pages
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";
import BotsPage from "./pages/BotsPage";
import InboxPage from "./pages/InboxPage";
import ApprovalsPage from "./pages/ApprovalsPage";
import WebChatPage from "./pages/WebChatPage";
import IntegrationPage from "./pages/IntegrationPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import CreateOrgPage from "./pages/CreateOrgPage";
import OrganizationPage from "./pages/OrganizationPage";
import ProfilePage from "./pages/ProfilePage";

// ── Auth Lifecycle Provider ─────────────────────────────────────

function AuthProvider({ children }: { children: React.ReactNode }) {
    const setSession = useAuthStore((s) => s.setSession);
    const fetchProfile = useAuthStore((s) => s.fetchProfile);
    const setLoading = useAuthStore((s) => s.setLoading);

    useEffect(() => {
        // Safety timeout — never block longer than 5 seconds (accounts for slow networks)
        const timeout = setTimeout(() => {
            console.warn("[Auth] Session check timed out — proceeding without auth");
            setLoading(false);
        }, 5000);

        // Use onAuthStateChange exclusively (Supabase v2 recommended pattern).
        // INITIAL_SESSION fires immediately on registration with the stored session,
        // avoiding the race condition between getSession() and onAuthStateChange.
        let initialized = false;
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (_event, session) => {
                setSession(session);
                if (session?.user) {
                    await fetchProfile(session.user.id);
                }
                // Finalize loading only once (after initial session is known)
                if (!initialized) {
                    initialized = true;
                    clearTimeout(timeout);
                    setLoading(false);
                }
            }
        );

        return () => {
            clearTimeout(timeout);
            subscription.unsubscribe();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return <>{children}</>;
}

// ── Loading Screen ──────────────────────────────────────────────

function LoadingScreen() {
    return (
        <div className="min-h-screen bg-steel-50 flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-brand-400 flex items-center justify-center text-steel-900 text-lg font-bold shadow-md animate-pulse">
                S
            </div>
            <p className="text-sm text-steel-400">กำลังตรวจสอบเซสชัน...</p>
        </div>
    );
}

// ── Role-based Home Redirect ─────────────────────────────────────

function HomeRedirect() {
    const role = useAuthStore((s) => s.user?.role);
    const orgRole = useOrgStore((s) => s.activeOrgRole);
    const hasFetched = useOrgStore((s) => s.hasFetched);

    // Wait for org data before deciding (prevent premature redirect)
    if (role === "user" && !hasFetched) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center text-sm text-steel-400">
                กำลังโหลดข้อมูลองค์กร...
            </div>
        );
    }

    // Org owners see dashboard (stats overview); regular members go to chatbot
    if (role === "user" && orgRole !== "owner") {
        return <Navigate to="/chat" replace />;
    }
    return <DashboardPage />;
}

// ── App ─────────────────────────────────────────────────────────

export default function App() {
    const isLoading = useAuthStore((s) => s.isLoading);

    // BrowserRouter is ALWAYS mounted so React Router context is never lost.
    // Only the Routes (and LoadingScreen) are conditionally rendered.
    return (
        <BrowserRouter>
            <AuthProvider>
                {isLoading ? (
                    <LoadingScreen />
                ) : (
                    <Routes>
                        {/* ── Public Routes ──────────────────────────── */}
                        <Route element={<AuthLayout />}>
                            <Route path="/login" element={<LoginPage />} />
                            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                            <Route path="/reset-password" element={<ResetPasswordPage />} />
                        </Route>

                        {/* ── Protected Routes (all roles) ───────────── */}
                        <Route element={<ProtectedRoute />}>
                            <Route element={<DashboardLayout />}>
                                <Route path="/" element={<HomeRedirect />} />

                                {/* Web Chat — all roles */}
                                <Route path="/chat" element={<WebChatPage />} />

                                {/* Create org — for approved users with no orgs */}
                                <Route path="/create-org" element={<CreateOrgPage />} />

                                {/* Profile — all roles */}
                                <Route path="/profile" element={<ProfilePage />} />

                                {/* Admin + User (owner) — content management pages */}
                                <Route element={<ProtectedRoute allowedRoles={["user", "admin"]} />}>
                                    <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
                                    <Route path="/bots" element={<BotsPage />} />
                                    <Route path="/inbox" element={<InboxPage />} />
                                    <Route path="/integration" element={<IntegrationPage />} />
                                </Route>

                                {/* Organization settings — all roles */}
                                <Route element={<ProtectedRoute allowedRoles={["user", "support", "admin"]} />}>
                                    <Route path="/organization" element={<OrganizationPage />} />
                                </Route>

                                {/* Support + Admin only */}
                                <Route element={<ProtectedRoute allowedRoles={["support", "admin"]} />}>
                                    <Route path="/approvals" element={<ApprovalsPage />} />
                                </Route>
                            </Route>
                        </Route>

                        {/* Catch-all: redirect unknown URLs to home */}
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                )}
                <ToastContainer />
            </AuthProvider>
        </BrowserRouter>
    );
}
