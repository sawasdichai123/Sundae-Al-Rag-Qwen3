/**
 * SUNDAE Frontend — Auth Store (Zustand + Supabase)
 *
 * Manages real Supabase auth session lifecycle:
 *   - signIn / signOut via Supabase
 *   - onAuthStateChange listener (called from AuthProvider)
 *   - Fetches user_profiles row for role & is_approved
 */

import { create } from "zustand";
import { supabase } from "../api/supabaseClient";
import type { UserProfile, Organization, UserRole } from "../types";
import type { Session } from "@supabase/supabase-js";

interface AuthState {
    // State
    user: UserProfile | null;
    organization: Organization | null;
    session: Session | null;
    isAuthenticated: boolean;
    isLoading: boolean;       // true while checking initial session
    authError: string | null;

    // Actions
    signIn: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
    setSession: (session: Session | null) => void;
    fetchProfile: (userId: string) => Promise<void>;
    setLoading: (v: boolean) => void;
    clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
    user: null,
    organization: null,
    session: null,
    isAuthenticated: false,
    isLoading: true,  // starts true until initial check
    authError: null,

    // ── Sign In ─────────────────────────────────────────────────
    signIn: async (email, password) => {
        set({ authError: null, isLoading: true, user: null, organization: null });

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) {
                const errMsg = error.message;
                set({
                    authError: errMsg === "Invalid login credentials"
                        ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
                        : errMsg.toLowerCase().includes("email not confirmed")
                            ? "กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ (ตรวจสอบในกล่องอีเมลของท่าน)"
                            : errMsg,
                });
                return;
            }

            if (data.session) {
                set({ session: data.session, isAuthenticated: true });
                await get().fetchProfile(data.session.user.id);
            }
        } finally {
            // Always reset loading — even if fetchProfile throws or signInWithPassword hangs
            set({ isLoading: false });
        }
    },

    // ── Sign Out ────────────────────────────────────────────────
    signOut: async () => {
        // Clear local state FIRST — never block the user waiting for the API.
        // This ensures logout works even if Supabase is slow or unreachable.
        set({
            user: null,
            organization: null,
            session: null,
            isAuthenticated: false,
            authError: null,
        });
        // Clear stale Supabase tokens from localStorage
        try {
            Object.keys(localStorage).forEach((key) => {
                if (key.startsWith("sb-")) localStorage.removeItem(key);
            });
        } catch { /* ignore storage errors */ }
        // Fire-and-forget: invalidate token on the server
        supabase.auth.signOut().catch((err) => {
            console.warn("[Auth] signOut API error (local state already cleared):", err);
        });
    },

    // ── Set Session (from onAuthStateChange) ────────────────────
    setSession: (session) => {
        if (session) {
            set({ session, isAuthenticated: true });
        } else {
            set({
                session: null,
                isAuthenticated: false,
                user: null,
                organization: null,
            });
        }
    },

    // ── Fetch Profile from user_profiles table ──────────────────
    fetchProfile: async (userId: string) => {
        // Fetch user profile with role & is_approved
        const { data: profile, error: profileError } = await supabase
            .from("user_profiles")
            .select("*")
            .eq("id", userId)
            .single();

        if (profileError || !profile) {
            console.error("[Auth] Failed to fetch user profile:", profileError);
            set({
                authError: "ไม่พบโปรไฟล์ผู้ใช้ กรุณาติดต่อผู้ดูแลระบบ",
                isLoading: false,
            });
            return;
        }

        // Email: prefer user_profiles table, fallback to auth session
        const session = get().session;
        const email = profile.email || session?.user?.email || "";

        const userProfile: UserProfile = {
            id: profile.id,
            organization_id: profile.organization_id,
            email,
            full_name: profile.full_name ?? null,
            role: profile.role as UserRole,
            is_approved: profile.is_approved ?? false,
            created_at: profile.created_at,
        };

        // DEBUG: remove after testing
        console.log("[Auth] Profile loaded:", {
            role: userProfile.role,
            is_approved: userProfile.is_approved,
            email: userProfile.email,
        });

        set({ user: userProfile });

        // Fetch organization if user has one
        if (profile.organization_id) {
            const { data: org } = await supabase
                .from("organizations")
                .select("*")
                .eq("id", profile.organization_id)
                .single();

            if (org) {
                set({
                    organization: {
                        id: org.id,
                        name: org.name,
                        created_at: org.created_at,
                    },
                });
            }
        }
    },

    setLoading: (v) => set({ isLoading: v }),
    clearError: () => set({ authError: null }),
}));

// ── Role Selectors ──────────────────────────────────────────────

export const selectRole = (state: AuthState): UserRole =>
    state.user?.role ?? "user";

export const selectIsApproved = (state: AuthState): boolean =>
    state.user?.is_approved ?? false;

export const selectCanManageContent = (state: AuthState): boolean => {
    const role = state.user?.role;
    return (role === "user" || role === "admin") && (state.user?.is_approved ?? false);
};

export const selectIsSupport = (state: AuthState): boolean =>
    state.user?.role === "support";

export const selectIsAdmin = (state: AuthState): boolean =>
    state.user?.role === "admin";
