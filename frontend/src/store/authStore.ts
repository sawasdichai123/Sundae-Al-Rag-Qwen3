/**
 * SUNDAE Frontend — Auth Store (Zustand + Supabase)
 *
 * Manages real Supabase auth session lifecycle:
 *   - signIn / signOut via Supabase
 *   - onAuthStateChange listener (called from AuthProvider)
 *   - Fetches user_profiles row for role & is_approved
 *   - Triggers orgStore.fetchOrgs() after profile load
 */

import { create } from "zustand";
import { supabase } from "../api/supabaseClient";
import { useOrgStore } from "./orgStore";
import { getT } from "../i18n";
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
                const t = getT();
                const errMsg = error.message;
                set({
                    authError: errMsg === "Invalid login credentials"
                        ? t("auth.invalidCredentials")
                        : errMsg.toLowerCase().includes("email not confirmed")
                            ? t("auth.emailNotConfirmed")
                            : errMsg.includes("Failed to fetch")
                                ? t("auth.connectionFailed")
                                : errMsg,
                });
                return;
            }

            if (data.session) {
                set({ session: data.session });
                await get().fetchProfile(data.session.user.id);
                if (get().user) {
                    set({ isAuthenticated: true });
                } else {
                    set({ session: null, isAuthenticated: false });
                }
            }
        } catch (err) {
            console.error("[Auth] signIn error:", err);
            set({ session: null, isAuthenticated: false, authError: getT()("auth.connectionFailed") });
        } finally {
            set({ isLoading: false });
        }
    },

    // ── Sign Out ────────────────────────────────────────────────
    signOut: async () => {
        // Clear local state FIRST — never block the user waiting for the API.
        set({
            user: null,
            organization: null,
            session: null,
            isAuthenticated: false,
            authError: null,
        });
        // Clear org store
        useOrgStore.getState().clearOrgs();
        // Clear stale Supabase tokens from both storages
        // (session is in sessionStorage per SEC-F07, but clean localStorage too for safety)
        try {
            for (const storage of [sessionStorage, localStorage]) {
                Object.keys(storage).forEach((key) => {
                    if (key.startsWith("sb-")) storage.removeItem(key);
                });
            }
        } catch { /* ignore storage errors */ }
        // Await server-side token invalidation — prevents token reuse after sign out
        try {
            await supabase.auth.signOut();
        } catch { /* ignore network errors — local state already cleared */ }
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
            set({ authError: getT()("auth.profileNotFound"), isLoading: false });
            return;
        }

        // Email: prefer user_profiles table, fallback to auth session
        const session = get().session;
        const email = profile.email || session?.user?.email || "";

        const userProfile: UserProfile = {
            id: profile.id,
            organization_id: profile.organization_id,
            email,
            first_name: profile.first_name ?? null,
            last_name: profile.last_name ?? null,
            avatar_url: profile.avatar_url ?? null,
            role: profile.role as UserRole,
            is_approved: profile.is_approved ?? false,
            created_at: profile.created_at,
        };

        set({ user: userProfile });

        // Fetch organization if user has one (backward compat)
        if (profile.organization_id) {
            try {
                const { data: org, error: orgError } = await supabase
                    .from("organizations")
                    .select("id,name,slug,status,created_at,updated_at")
                    .eq("id", profile.organization_id)
                    .maybeSingle();

                if (orgError) {
                    console.warn("[Auth] Failed to fetch organization:", orgError.message);
                } else if (org) {
                    set({
                        organization: {
                            id: org.id,
                            name: org.name,
                            slug: org.slug ?? "",
                            status: org.status ?? "active",
                            created_at: org.created_at,
                            updated_at: org.updated_at ?? org.created_at,
                        },
                    });
                }
            } catch (err) {
                console.warn("[Auth] Organization fetch error:", err);
            }
        }

        // Fetch user's orgs from org_members (multi-tenant)
        if (userProfile.is_approved) {
            useOrgStore.getState().fetchOrgs();
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
    return (role === "user" || role === "support" || role === "admin") && (state.user?.is_approved ?? false);
};

export const selectIsSupport = (state: AuthState): boolean =>
    state.user?.role === "support";

export const selectIsAdmin = (state: AuthState): boolean =>
    state.user?.role === "admin";
