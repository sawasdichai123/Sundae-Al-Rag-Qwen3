/**
 * SUNDAE Frontend — Axios Client with Supabase JWT Interceptor
 *
 * Token protection strategy (3 layers):
 *   Layer 1: Request interceptor  — refreshes if token expires within 5 min
 *   Layer 2: Response interceptor — retries once on 401 with fresh token
 *   Layer 3: Periodic refresh     — every 4 min in supabaseClient.ts
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

// ── Layer 1: Get a valid (non-expired) access token ─────────────
async function getValidToken(): Promise<string | null> {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return null;

        const expiresAt = session.expires_at ?? 0;
        const now = Math.floor(Date.now() / 1000);

        // Refresh if token expires within 5 minutes
        // This covers the RAG pipeline duration (up to 5 min)
        if (expiresAt - now < 300) {
            const { data, error } = await supabase.auth.refreshSession();
            if (error || !data?.session) {
                console.warn("[Auth] Token refresh failed:", error?.message);
                return session.access_token; // Use existing token as fallback
            }
            return data.session.access_token;
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
            try {
                const { data, error: refreshError } = await supabase.auth.refreshSession();
                if (refreshError || !data?.session) {
                    window.location.href = "/login";
                    return Promise.reject(error);
                }
                originalRequest.headers.Authorization = `Bearer ${data.session.access_token}`;
                return apiClient.request(originalRequest);
            } catch {
                window.location.href = "/login";
                return Promise.reject(error);
            }
        }
        return Promise.reject(error);
    }
);

export default apiClient;
