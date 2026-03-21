/**
 * SUNDAE Frontend — Axios Client with Supabase JWT Interceptor
 *
 * Token protection strategy (3 layers):
 *   Layer 1: Request interceptor  — refreshes if token expires within 5 min
 *   Layer 2: Response interceptor — retries once on 401 with fresh token
 *   Layer 3: Periodic refresh     — every 30 min in supabaseClient.ts
 *
 * IMPORTANT: All token refresh calls go through a single mutex to prevent
 * concurrent refreshSession() from invalidating the refresh token.
 */

import axios from "axios";
import { supabase, refreshOnce } from "./supabaseClient";

const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:8001",
    headers: {
        "Content-Type": "application/json",
    },
    timeout: 30000,
});

// ── Refresh Token — delegates to the single mutex in supabaseClient.ts ──
// This prevents dual refreshPromise variables from causing concurrent
// refreshSession() calls that invalidate the refresh token.
export async function refreshTokenOnce(): Promise<string | null> {
    try {
        await refreshOnce();
        const { data: { session } } = await supabase.auth.getSession();
        return session?.access_token ?? null;
    } catch {
        return null;
    }
}

// ── In-memory token cache ─────────────────────────────────────────
// Prevents multiple concurrent API calls from all calling getSession()
// which causes lock contention and timeouts.
let _cachedToken: string | null = null;
let _cachedTokenExpiresAt = 0;

// Update cache whenever Supabase auth state changes
supabase.auth.onAuthStateChange((_event, session) => {
    if (session) {
        _cachedToken = session.access_token;
        _cachedTokenExpiresAt = session.expires_at ?? 0;
    } else {
        _cachedToken = null;
        _cachedTokenExpiresAt = 0;
    }
});

// ── Helper: Read token directly from localStorage (no lock needed) ──
function readTokenFromStorage(): { token: string; expiresAt: number } | null {
    try {
        const storageKey = Object.keys(localStorage).find(
            (k) => k.startsWith("sb-") && k.endsWith("-auth-token")
        );
        if (!storageKey) return null;
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const token = parsed?.access_token;
        const expiresAt = parsed?.expires_at ?? 0;
        if (!token) return null;
        return { token, expiresAt };
    } catch {
        return null;
    }
}

// ── Layer 1: Get a valid (non-expired) access token ─────────────
// Exported so askStream (raw fetch) can reuse the same refresh logic.
// Reads from in-memory cache → localStorage → getSession() (last resort).
export async function getValidToken(): Promise<string | null> {
    const now = Math.floor(Date.now() / 1000);

    // 1. Use in-memory cached token if valid (expires in more than 5 minutes)
    if (_cachedToken && _cachedTokenExpiresAt - now > 300) {
        return _cachedToken;
    }

    // 2. Read from localStorage directly (fast, no lock contention)
    const stored = readTokenFromStorage();
    if (stored && stored.expiresAt - now > 300) {
        _cachedToken = stored.token;
        _cachedTokenExpiresAt = stored.expiresAt;
        return stored.token;
    }

    // 3. Token near expiry or missing — try getSession with timeout
    try {
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("getSession timeout")), 8000)
        );

        let session;
        try {
            const result = await Promise.race([sessionPromise, timeoutPromise]);
            session = result.data.session;
        } catch {
            console.warn("[Auth] getSession timed out, using localStorage token");
            // Return whatever token we have from storage (even if near expiry)
            return stored?.token ?? null;
        }

        if (!session) return null;

        // Update cache
        _cachedToken = session.access_token;
        _cachedTokenExpiresAt = session.expires_at ?? 0;

        // Refresh if token expires within 5 minutes
        if (_cachedTokenExpiresAt - now < 300) {
            const freshToken = await refreshTokenOnce();
            return freshToken || session.access_token;
        }

        return session.access_token;
    } catch {
        return stored?.token ?? null;
    }
}

// ── Request Interceptor: Attach JWT Token ───────────────────────
apiClient.interceptors.request.use(
    async (config) => {
        const token = await getValidToken();
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        // Attach active org header for multi-tenant isolation
        try {
            const activeOrgId = localStorage.getItem("sundae_active_org_id");
            if (activeOrgId) {
                config.headers["X-Active-Org"] = activeOrgId;
            }
        } catch { /* ignore storage errors */ }
        return config;
    },
    (error) => Promise.reject(error)
);

// ── Layer 2: Response Interceptor — Retry on 401 ────────────────
apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        // Only retry once to prevent infinite loops
        if (error.response?.status === 401 && !originalRequest._retried) {
            originalRequest._retried = true;

            const freshToken = await refreshTokenOnce();
            if (!freshToken) {
                // Refresh truly failed — session is dead.
                // Import toast lazily to avoid circular deps.
                try {
                    const { useToastStore } = await import("../store/toastStore");
                    useToastStore.getState().addToast(
                        "warning",
                        "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
                        8000,
                    );
                } catch { /* ignore if toast not available */ }

                // Small delay so the toast is visible before redirect
                await new Promise((r) => setTimeout(r, 1500));
                window.location.href = "/login";
                return Promise.reject(error);
            }

            // Retry with the fresh token
            originalRequest.headers.Authorization = `Bearer ${freshToken}`;
            return apiClient.request(originalRequest);
        }

        return Promise.reject(error);
    }
);

export default apiClient;
