/**
 * SUNDAE Frontend — Supabase Client (Singleton)
 *
 * Environment variables (set in .env):
 *   VITE_SUPABASE_URL       — e.g. https://xxxxx.supabase.co
 *   VITE_SUPABASE_ANON_KEY  — public anon key
 *
 * Token Keep-Alive System:
 *   Since we disabled Web Locks (Bug B17), Supabase's built-in
 *   autoRefreshToken does NOT work reliably. We compensate with:
 *     1. Periodic refresh every 4 minutes
 *     2. Refresh on tab focus (user returns after idle/sleep)
 *     3. Timestamp-based staleness check on visibility change
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
        "[SUNDAE] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.\n" +
        "Auth will not work until these are set in your .env file."
    );
}

export const supabase = createClient(
    supabaseUrl || "http://localhost:54321",
    supabaseAnonKey || "placeholder-key",
    {
        auth: {
            // No-op lock function — prevents "Acquiring an exclusive Navigator Lock… timed out"
            // deadlock that blocks the entire app (Bug B17).
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lock: (async (_name: string, _acquireTimeout: number, fn: () => Promise<any>) => {
                return await fn();
            }) as any,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
        },
    }
);

// ═══════════════════════════════════════════════════════════════════
// Token Keep-Alive System
// ═══════════════════════════════════════════════════════════════════

// Track the last successful refresh time
let lastRefreshTime = Date.now();

let consecutiveRefreshFailures = 0;

let refreshPromise: Promise<void> | null = null;

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

async function refreshOnce(): Promise<void> {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
        try {
            const { error } = await withTimeout(
                supabase.auth.refreshSession(),
                10_000,
                "supabase.auth.refreshSession()"
            );
            if (error) {
                console.warn("[Auth] Periodic refresh failed:", error.message);
                consecutiveRefreshFailures += 1;
            } else {
                lastRefreshTime = Date.now();
                consecutiveRefreshFailures = 0;
            }
        } catch (err) {
            console.warn("[Auth] Periodic refresh timed out or errored:", err);
            consecutiveRefreshFailures += 1;
        } finally {
            setTimeout(() => { refreshPromise = null; }, 1000);
        }
    })();

    return refreshPromise;
}

async function forceReauth(): Promise<void> {
    try {
        await supabase.auth.signOut();
    } catch {
        // ignore
    }
    try {
        Object.keys(localStorage).forEach((key) => {
            if (key.startsWith("sb-")) localStorage.removeItem(key);
        });
    } catch {
        // ignore
    }
    window.location.href = "/login";
}

async function refreshIfNeeded() {
    try {
        const { data } = await withTimeout(
            supabase.auth.getSession(),
            10_000,
            "supabase.auth.getSession()"
        );
        if (!data.session) {
            consecutiveRefreshFailures += 1;
            if (consecutiveRefreshFailures >= 2) {
                await forceReauth();
            }
            return;
        }

        const expiresAt = data.session.expires_at ?? 0;
        const now = Math.floor(Date.now() / 1000);
        const remainingSec = expiresAt - now;

        // Refresh if less than 10 minutes remaining
        if (remainingSec < 600) {
            await refreshOnce();
            if (consecutiveRefreshFailures >= 2) {
                await forceReauth();
            }
        }
    } catch { /* silent */ }
}

// 1. Periodic refresh — every 4 minutes
setInterval(refreshIfNeeded, 4 * 60 * 1000);

// 2. Refresh on tab focus — handles idle/sleep/tab-switch scenarios
//    Also checks if we've been away for more than 5 minutes (sleep/hibernate)
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        const timeSinceLastRefresh = Date.now() - lastRefreshTime;
        const fiveMinutes = 5 * 60 * 1000;

        if (timeSinceLastRefresh > fiveMinutes) {
            // We've been away for a while — force refresh immediately
            refreshIfNeeded();
        }
    }
});
