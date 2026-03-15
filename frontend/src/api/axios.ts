/**
 * SUNDAE Frontend — Axios Client with Supabase JWT Interceptor
 *
 * Token protection strategy (3 layers):
 *   Layer 1: Request interceptor  — refreshes if token expires within 5 min
 *   Layer 2: Response interceptor — retries once on 401 with fresh token
 *   Layer 3: Periodic refresh     — every 4 min in supabaseClient.ts
 *
 * IMPORTANT: All token refresh calls go through a single mutex to prevent
 * concurrent refreshSession() from invalidating the refresh token.
 */

import axios from "axios";
import { supabase } from "./supabaseClient";

const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:8000",
    headers: {
        "Content-Type": "application/json",
    },
    timeout: 30000,
});

// ── Refresh Mutex — prevent concurrent refreshSession() calls ────
// If two API calls both get 401 at the same time, only ONE refresh
// fires. The second caller waits for the first to complete.
let refreshPromise: Promise<string | null> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<T>((_resolve, reject) => {
        timeoutId = window.setTimeout(() => {
            reject(new Error(`${label} timed out after ${ms}ms`));
        }, ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    });
}

export async function refreshTokenOnce(): Promise<string | null> {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
        try {
            const { data, error } = await withTimeout(
                supabase.auth.refreshSession(),
                10_000,
                "supabase.auth.refreshSession()"
            );
            if (error || !data?.session) {
                console.warn("[Auth] Token refresh failed:", error?.message);
                return null;
            }
            return data.session.access_token;
        } catch {
            return null;
        } finally {
            // Clear the mutex after a short delay so back-to-back calls
            // still coalesce, but the next wave gets a fresh refresh.
            setTimeout(() => { refreshPromise = null; }, 1000);
        }
    })();

    return refreshPromise;
}

// ── Layer 1: Get a valid (non-expired) access token ─────────────
// Exported so askStream (raw fetch) can reuse the same refresh logic.
export async function getValidToken(): Promise<string | null> {
    try {
        const { data: { session } } = await withTimeout(
            supabase.auth.getSession(),
            10_000,
            "supabase.auth.getSession()"
        );
        if (!session) return null;

        const expiresAt = session.expires_at ?? 0;
        const now = Math.floor(Date.now() / 1000);

        // Refresh if token expires within 5 minutes
        if (expiresAt - now < 300) {
            const freshToken = await refreshTokenOnce();
            return freshToken || session.access_token;
        }

        return session.access_token;
    } catch {
        return null;
    }
}

// ── Request Interceptor: Attach JWT Token ───────────────────────
apiClient.interceptors.request.use(
    async (config) => {
        const token = await getValidToken();
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
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
