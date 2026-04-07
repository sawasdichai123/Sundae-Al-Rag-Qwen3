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
 *     1. Periodic refresh every 30 minutes
 *     2. Refresh on tab focus (user returns after idle/sleep)
 *     3. Timestamp-based staleness check on visibility change
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
        "[SUNDAE] FATAL: Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
        "Application cannot start without valid Supabase configuration. " +
        "Copy .env.example to .env and fill in your values."
    );
}

// In-memory mutex lock — replaces navigator.locks to avoid Bug B17 deadlock,
// while still serializing concurrent calls (prevents auth-js _acquireLock deadlock).
// Includes a timeout to prevent permanent deadlock when tab is suspended/resumed.
const lockQueues = new Map<string, Promise<void>>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function inMemoryLock(_name: string, acquireTimeout: number, fn: () => Promise<any>): Promise<any> {
    const queue = lockQueues.get(_name) ?? Promise.resolve();
    let resolve: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    lockQueues.set(_name, next);

    // Wait for the previous holder to finish, but with a timeout
    // to recover from stale locks (e.g. tab was suspended mid-operation)
    const timeout = Math.max(acquireTimeout || 5000, 5000);
    await Promise.race([
        queue,
        new Promise<void>((r) => setTimeout(r, timeout)),
    ]);

    try {
        return await fn();
    } finally {
        resolve!();
        if (lockQueues.get(_name) === next) {
            lockQueues.delete(_name);
        }
    }
}

// Reset stale locks when tab becomes visible again (after sleep/suspend)
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        // Clear all lock queues — any pending lock from before suspend is stale
        lockQueues.clear();
    }
});

export const supabase = createClient(
    supabaseUrl,
    supabaseAnonKey,
    {
        auth: {
            // In-memory mutex lock — avoids navigator.locks deadlock (Bug B17)
            // while properly serializing concurrent auth operations.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lock: inMemoryLock as any,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
            // SEC-F07: ใช้ sessionStorage แทน localStorage
            // — token หายเมื่อปิด tab ลด XSS token theft risk
            storage: window.sessionStorage,
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

// ── Cross-Tab Token Sync (BroadcastChannel) ──────────────────────
// When one tab refreshes successfully, it broadcasts to all other
// tabs so they skip their own refresh and reset failure counters.
const _authChannel = (() => {
    try {
        return typeof BroadcastChannel !== "undefined"
            ? new BroadcastChannel("sundae-auth-sync")
            : null;
    } catch {
        return null;
    }
})();

if (_authChannel) {
    _authChannel.onmessage = (e: MessageEvent) => {
        if (e.data?.type === "token-refreshed") {
            // Another tab refreshed successfully — reset our counters
            lastRefreshTime = Date.now();
            consecutiveRefreshFailures = 0;
            refreshPromise = null; // allow next refresh to run fresh
        }
    };
}

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

export async function refreshOnce(): Promise<void> {
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
                // Notify other tabs so they skip their own refresh
                try { _authChannel?.postMessage({ type: "token-refreshed" }); } catch { /* ignore */ }
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
        Object.keys(sessionStorage).forEach((key) => {
            if (key.startsWith("sb-")) sessionStorage.removeItem(key);
        });
    } catch {
        // ignore
    }
    window.location.href = "/login";
}

async function refreshIfNeeded() {
    // Skip refresh on auth pages where no session is expected
    // or where refreshing could invalidate a recovery session
    const authPages = ["/login", "/register", "/forgot-password", "/reset-password"];
    if (authPages.includes(window.location.pathname)) {
        return;
    }

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

        // Refresh if less than 35 minutes remaining
        if (remainingSec < 2100) {
            await refreshOnce();
            if (consecutiveRefreshFailures >= 2) {
                await forceReauth();
            }
        }
    } catch { /* silent */ }
}

// 1. Periodic refresh — every 30 minutes
setInterval(refreshIfNeeded, 30 * 60 * 1000);

// 2. Refresh on tab focus — handles idle/sleep/tab-switch scenarios
//    Also checks if we've been away for more than 5 minutes (sleep/hibernate)
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        const timeSinceLastRefresh = Date.now() - lastRefreshTime;
        const thirtyFiveMinutes = 35 * 60 * 1000;

        if (timeSinceLastRefresh > thirtyFiveMinutes) {
            // We've been away for a while — force refresh immediately
            refreshIfNeeded();
        }
    }
});
