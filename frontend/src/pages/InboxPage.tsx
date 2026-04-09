/**
 * InboxPage — Unified Chat Session Management
 *
 * Two-panel layout:
 * - Left: Session list with search, status badges, and platform icons
 * - Right: Chat messages view with status controls
 *
 * API: inboxApi (endpoints.ts)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { inboxApi } from "../api/endpoints";
import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";
import { useT } from "../i18n";

// ── Types ───────────────────────────────────────────────────────

interface Session {
    id: string;
    organization_id: string;
    bot_id: string | null;
    platform_user_id: string | null;
    platform_source: string;
    status: string;
    started_at: string | null;
    last_message_at: string | null;
    user_name: string | null;
}

interface SourceRef {
    document_id: string;
    document_name?: string;
    chunk_index: number;
    page_start: number | null;
    page_end: number | null;
    score: number;
}

interface Message {
    id: string;
    session_id: string;
    organization_id: string;
    role: string;
    content: string;
    metadata: { sources?: SourceRef[]; [key: string]: unknown } | null;
    created_at: string;
}

// ── Icons ───────────────────────────────────────────────────────

function SearchIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
        </svg>
    );
}

// ── Platform Badge ───────────────────────────────────────────────

function PlatformBadge({ source }: { source: string }) {
    if (source === "line") {
        return (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-500 text-white text-[9px] font-bold shrink-0">
                L
            </span>
        );
    }
    if (source === "web") {
        return (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-blue-500 text-white shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                    <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 1.56a5.5 5.5 0 0 0-4.69 4.69H4.5a.75.75 0 0 0 0-1.5H2.56c.27-.72.67-1.37 1.17-1.93L4.5 5.09a.75.75 0 1 0 1.06-1.06l-.77-.77a5.53 5.53 0 0 1 2.46-.7ZM9.5 3.09a5.53 5.53 0 0 1 2.46.7l-.77.77a.75.75 0 1 0 1.06 1.06l.77-.76a5.5 5.5 0 0 1 1.17 1.93H12.5a.75.75 0 0 0 0 1.5h1.94a5.5 5.5 0 0 1-4.69 4.69V11.5a.75.75 0 0 0-1.5 0v1.94a5.5 5.5 0 0 1-4.69-4.69H4.5a.75.75 0 0 0 0-1.5H2.56A5.5 5.5 0 0 1 7.25 2.56V4.5a.75.75 0 0 0 1.5 0V3.09Z" />
                </svg>
            </span>
        );
    }
    return (
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-steel-400 text-white text-[9px] font-bold shrink-0">
            API
        </span>
    );
}

// ── Helpers ──────────────────────────────────────────────────────

function statusConfig(status: string) {
    switch (status) {
        case "active":
            return { labelKey: "inbox.statusActive", className: "bg-emerald-50 text-emerald-600", dot: "bg-emerald-500" };
        case "human_takeover":
            return { labelKey: "inbox.statusTakeover", className: "bg-amber-50 text-amber-600", dot: "bg-amber-500" };
        case "helped":
            return { labelKey: "inbox.statusHelped", className: "bg-blue-50 text-blue-600", dot: "bg-blue-500" };
        case "resolved":
            return { labelKey: "inbox.statusResolved", className: "bg-steel-100 text-steel-500", dot: "bg-steel-400" };
        default:
            return { labelKey: status, className: "bg-steel-100 text-steel-500", dot: "bg-steel-400" };
    }
}

interface TimeAgoLabels { justNow: string; minutesAgo: string; hoursAgo: string; daysAgo: string; }

function timeAgo(dateStr: string | null, labels: TimeAgoLabels): string {
    if (!dateStr) return "—";
    const parsed = new Date(dateStr).getTime();
    if (isNaN(parsed)) return "—";
    const diff = Date.now() - parsed;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return labels.justNow;
    if (mins < 60) return `${mins} ${labels.minutesAgo}`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ${labels.hoursAgo}`;
    const days = Math.floor(hours / 24);
    return `${days} ${labels.daysAgo}`;
}

// ── Component ───────────────────────────────────────────────────

// Typed poll response (replaces (pollData as any) casts)
interface PollResponse {
    messages: Message[];
    session_status: string;
}

export default function InboxPage() {
    const t = useT();
    const [sessions, setSessions] = useState<Session[]>([]);
    const [totalSessions, setTotalSessions] = useState(0);
    const [loadingMore, setLoadingMore] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [messages, setMessages] = useState<Message[]>([]);
    const [selectedSession, setSelectedSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [platformFilter, setPlatformFilter] = useState<"all" | "line" | "web">("all");
    const [replyText, setReplyText] = useState("");
    const [sendingReply, setSendingReply] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const replyInputRef = useRef<HTMLTextAreaElement>(null);
    const lastPollTimestampRef = useRef<string | null>(null);
    const hasLoadedSessionsOnceRef = useRef(false);

    const user = useAuthStore((s) => s.user);
    const activeOrgId = useOrgStore((s) => s.activeOrgId);
    const orgId = (activeOrgId ?? user?.organization_id ?? import.meta.env.VITE_DEFAULT_ORG_ID) as string;

    // ── Load sessions (page 1) — replaces current list ─────────────
    const loadSessions = useCallback(async (opts?: { silent?: boolean }) => {
        const silent = opts?.silent ?? false;
        if (!orgId) {
            if (!silent) setLoading(false);
            return;
        }
        if (!silent && !hasLoadedSessionsOnceRef.current) setLoading(true);
        try {
            const res = await inboxApi.listSessions(orgId, 1, 20);
            const data = res.data;
            setSessions(data.sessions ?? data);
            setTotalSessions(data.total ?? (data.sessions ?? data).length);
            setCurrentPage(1);
            hasLoadedSessionsOnceRef.current = true;
        } catch (err) {
            console.error("[Inbox] Failed to load sessions:", err);
        } finally {
            if (!silent) setLoading(false);
        }
    }, [orgId]);

    // ── Load more sessions — appends next page ──────────────────
    const loadMoreSessions = async () => {
        if (!orgId || loadingMore) return;
        setLoadingMore(true);
        try {
            const nextPage = currentPage + 1;
            const res = await inboxApi.listSessions(orgId, nextPage, 20);
            const data = res.data;
            setSessions((prev) => [...prev, ...(data.sessions ?? [])]);
            setCurrentPage(nextPage);
        } catch (err) {
            console.error("[Inbox] Failed to load more sessions:", err);
        } finally {
            setLoadingMore(false);
        }
    };

    useEffect(() => {
        loadSessions();
    }, [loadSessions]);

    // ── Real-time: Poll sessions list every 10s (reduced from 3s) ──
    useEffect(() => {
        if (!orgId) return;
        const interval = setInterval(() => {
            if (document.hidden) return; // skip polling when tab is not visible
            loadSessions({ silent: true });
        }, 10_000);
        return () => clearInterval(interval);
    }, [orgId, loadSessions]);

    // ── Load messages for selected session ──────────────────────
    const loadMessages = useCallback(async (session: Session) => {
        if (!orgId) return;
        setLoadingMessages(true);
        try {
            const res = await inboxApi.getMessages(session.id, orgId);
            setMessages(res.data);
            // initialize poll cursor to the last message timestamp (or now if empty)
            const last = res.data?.[res.data.length - 1];
            lastPollTimestampRef.current = last?.created_at ?? new Date().toISOString();
        } catch (err) {
            console.error("[Inbox] Failed to load messages:", err);
        } finally {
            setLoadingMessages(false);
        }
    }, [orgId]);

    const selectSession = (session: Session) => {
        lastPollTimestampRef.current = null; // reset cursor before loading new session
        setSelectedSession(session);
        loadMessages(session);
    };

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // ── Status update ───────────────────────────────────────────
    const handleStatusChange = async (newStatus: string) => {
        if (!selectedSession || !orgId) return;
        try {
            await inboxApi.updateStatus(selectedSession.id, orgId, newStatus);
            setSelectedSession((prev) => (prev ? { ...prev, status: newStatus } : prev));
            // Refresh session list (silent to avoid loading spinner)
            await loadSessions({ silent: true });
        } catch (err) {
            console.error("[Inbox] Status update failed:", err);
        }
    };

    // ── Real-time: Poll only NEW messages every 5s + sync session status ──
    useEffect(() => {
        if (!selectedSession || !orgId) return;

        let cancelled = false;

        const interval = setInterval(async () => {
            if (cancelled || document.hidden) return; // skip if unmounted or tab hidden
            if (!lastPollTimestampRef.current) return; // skip until loadMessages completes
            try {
                const after = lastPollTimestampRef.current;
                const res = await inboxApi.getNewMessages(selectedSession.id, orgId, after);
                if (cancelled) return; // check again after await
                const pollData = res.data as PollResponse;

                // Sync current session status (backend may change it)
                const backendStatus = pollData?.session_status;
                if (backendStatus && backendStatus !== selectedSession.status) {
                    setSelectedSession((prev) => (prev ? { ...prev, status: backendStatus } : prev));
                    // Also refresh list so badge updates (silent to avoid loading spinner)
                    loadSessions({ silent: true });
                }

                const newMsgs = pollData?.messages;
                if (newMsgs && newMsgs.length > 0) {
                    setMessages((prev) => {
                        const existingIds = new Set(prev.map((m) => m.id));
                        const unique = newMsgs.filter((m) => !existingIds.has(m.id));
                        return unique.length > 0 ? [...prev, ...unique] : prev;
                    });
                    lastPollTimestampRef.current = newMsgs[newMsgs.length - 1].created_at;
                    // sessions list should reflect last_message_at (silent to avoid loading spinner)
                    loadSessions({ silent: true });
                }
            } catch (err) {
                if (!cancelled) console.error("[Inbox] Poll new messages failed:", err);
            }
        }, 5000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [selectedSession, orgId, loadSessions]);

    // ── Send admin reply ─────────────────────────────────────────
    const handleSendReply = async () => {
        const text = replyText.trim();
        if (!text || !selectedSession || !orgId || sendingReply) return;
        setSendingReply(true);
        try {
            const res = await inboxApi.sendMessage(selectedSession.id, orgId, text);
            setMessages((prev) => [...prev, res.data]);
            lastPollTimestampRef.current = res.data.created_at;
            setReplyText("");
            if (replyInputRef.current) replyInputRef.current.style.height = "auto";
            // Update session status locally if it changed
            setSelectedSession((prev) =>
                prev && prev.status === "active" ? { ...prev, status: "human_takeover" } : prev
            );
        } catch (err) {
            console.error("[Inbox] Failed to send reply:", err);
        } finally {
            setSendingReply(false);
        }
    };

    const handleReplyKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSendReply();
        }
    };

    // ── Filtered sessions ───────────────────────────────────────
    const filtered = sessions.filter((s) => {
        const matchesPlatform = platformFilter === "all" || s.platform_source === platformFilter;
        const matchesSearch = !searchQuery ||
            (s.user_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.platform_source.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesPlatform && matchesSearch;
    });

    return (
        <div className="flex h-[calc(100vh-8rem)] bg-white rounded-2xl border border-steel-100 overflow-hidden animate-fade-in">
            {/* ── Left Panel: Session List ────────────────── */}
            <div className="w-80 border-r border-steel-100 flex flex-col shrink-0">
                <div className="p-4 border-b border-steel-100">
                    <h2 className="text-sm font-bold text-steel-800 mb-3">Inbox</h2>
                    <div className="relative mb-2">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400">
                            <SearchIcon />
                        </span>
                        <input
                            type="text"
                            placeholder={t("inbox.searchPlaceholder")}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 bg-steel-50 border border-steel-200 rounded-xl text-xs placeholder:text-steel-400 focus:outline-none focus:border-brand-400 transition-all"
                        />
                    </div>
                    {/* Platform filter tabs */}
                    <div className="flex gap-1">
                        {(["all", "line", "web"] as const).map((f) => (
                            <button
                                key={f}
                                onClick={() => setPlatformFilter(f)}
                                className={`flex-1 py-1.5 text-[10px] font-semibold rounded-lg transition-colors cursor-pointer ${
                                    platformFilter === f
                                        ? "bg-brand-400 text-steel-900"
                                        : "bg-steel-100 text-steel-500 hover:bg-steel-200"
                                }`}
                            >
                                {f === "all" ? "ทั้งหมด" : f === "line" ? "LINE" : "Web"}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-12 text-steel-400">
                            <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="p-6 text-center text-xs text-steel-400">
                            {searchQuery ? t("inbox.noResults") : t("inbox.empty")}
                        </div>
                    ) : (
                        filtered.map((session) => {
                            const sc = statusConfig(session.status);
                            const isSelected = selectedSession?.id === session.id;
                            return (
                                <button
                                    key={session.id}
                                    onClick={() => selectSession(session)}
                                    className={`w-full text-left px-4 py-3 border-b border-steel-50 hover:bg-steel-50 transition-colors cursor-pointer ${isSelected ? "bg-brand-50 border-l-2 border-l-brand-400" : ""
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-2">
                                            <PlatformBadge source={session.platform_source} />
                                            <span className="text-xs font-medium text-steel-800 truncate max-w-[140px]">
                                                {session.user_name || "Anonymous"}
                                            </span>
                                        </div>
                                        <span className="text-[10px] text-steel-400">
                                            {timeAgo(session.last_message_at, { justNow: t("common.justNow"), minutesAgo: t("common.minutesAgo"), hoursAgo: t("common.hoursAgo"), daysAgo: t("common.daysAgo") })}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${sc.className}`}>
                                            <span className={`w-1 h-1 rounded-full ${sc.dot}`} />
                                            {t(sc.labelKey)}
                                        </span>
                                    </div>
                                </button>
                            );
                        })
                    )}
                    {/* Load More — shown when more sessions exist beyond current page */}
                    {sessions.length < totalSessions && (
                        <div className="p-3 border-t border-steel-100">
                            <button
                                onClick={loadMoreSessions}
                                disabled={loadingMore}
                                className="w-full py-2 text-xs text-brand-600 hover:text-brand-700 font-medium rounded-xl hover:bg-brand-50 transition-colors cursor-pointer disabled:opacity-50"
                            >
                                {loadingMore
                                    ? t("common.loading")
                                    : `${t("inbox.loadMore")} (${totalSessions - sessions.length} ${t("inbox.remaining")})`}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Right Panel: Chat View ──────────────────── */}
            <div className="flex-1 flex flex-col min-w-0">
                {!selectedSession ? (
                    <div className="flex items-center justify-center h-full text-steel-400">
                        <div className="text-center">
                            <div className="w-12 h-12 mb-3 rounded-xl bg-steel-100 mx-auto flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6 text-steel-400"><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" /></svg>
                            </div>
                            <p className="text-sm">{t("inbox.selectSession")}</p>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className="px-6 py-3.5 border-b border-steel-100 flex items-center justify-between bg-white">
                            <div className="flex items-center gap-3">
                                <PlatformBadge source={selectedSession.platform_source} />
                                <div>
                                    <p className="text-sm font-bold text-steel-800">
                                        {selectedSession.user_name || "Anonymous"}
                                    </p>
                                    <p className="text-[10px] text-steel-400 capitalize">
                                        {selectedSession.platform_source} · {selectedSession.id.slice(0, 8)}
                                    </p>
                                </div>
                                <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-full ${statusConfig(selectedSession.status).className}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${statusConfig(selectedSession.status).dot}`} />
                                    {t(statusConfig(selectedSession.status).labelKey)}
                                </span>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-center gap-2">
                                {selectedSession.status === "active" && (
                                    <button
                                        onClick={() => handleStatusChange("human_takeover")}
                                        className="px-3 py-1.5 bg-amber-50 text-amber-700 text-xs font-medium rounded-lg hover:bg-amber-100 transition-colors cursor-pointer"
                                    >
                                        {t("inbox.takeover")}
                                    </button>
                                )}
                                {selectedSession.status === "human_takeover" && (
                                    <button
                                        onClick={() => handleStatusChange("active")}
                                        className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
                                    >
                                        {t("inbox.returnToAI")}
                                    </button>
                                )}
                                {selectedSession.status !== "resolved" && selectedSession.status !== "helped" && (
                                    <button
                                        onClick={() => handleStatusChange("helped")}
                                        className="px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-medium rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
                                    >
                                        {t("inbox.markHelped")}
                                    </button>
                                )}
                                {selectedSession.status === "helped" && (
                                    <button
                                        onClick={() => handleStatusChange("active")}
                                        className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
                                    >
                                        {t("inbox.needMoreHelp")}
                                    </button>
                                )}
                                {selectedSession.status === "resolved" && (
                                    <button
                                        onClick={() => handleStatusChange("active")}
                                        className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
                                    >
                                        {t("inbox.reopen")}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto px-6 py-4">
                            {loadingMessages ? (
                                <div className="flex items-center justify-center py-12 text-steel-400">
                                    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                </div>
                            ) : messages.length === 0 ? (
                                <div className="text-center py-12 text-xs text-steel-400">{t("inbox.noMessages")}</div>
                            ) : (
                                <div className="space-y-4">
                                    {messages.map((msg) => {
                                        // System messages — centered banner
                                        if (msg.role === "system") {
                                            return (
                                                <div key={msg.id} className="flex justify-center">
                                                    <div className="bg-amber-50 text-amber-700 text-[11px] font-medium px-4 py-1.5 rounded-full border border-amber-200">
                                                        {msg.content}
                                                    </div>
                                                </div>
                                            );
                                        }

                                        const isAdmin = msg.role === "admin";
                                        // Admin perspective: AI + admin replies on right, customer on left
                                        const isRight = isAdmin || msg.role === "assistant";

                                        return (
                                        <div
                                            key={msg.id}
                                            className={`flex items-end gap-2 ${isRight ? "justify-end" : "justify-start"}`}
                                        >
                                            {/* Left avatar (assistant or user) */}
                                            {!isRight && (
                                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 ${
                                                    msg.role === "assistant"
                                                        ? "bg-brand-400 text-steel-900"
                                                        : "bg-steel-200 text-steel-600"
                                                }`}>
                                                    {msg.role === "assistant" ? "S" : "U"}
                                                </div>
                                            )}
                                            <div
                                                className={`max-w-[70%] px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${
                                                    isAdmin
                                                        ? "bg-blue-500 text-white rounded-2xl rounded-br-md"
                                                        : msg.role === "assistant"
                                                            ? "bg-brand-50 text-steel-800 rounded-2xl rounded-br-md border border-brand-200"
                                                            : "bg-white text-steel-800 rounded-2xl rounded-bl-md border border-steel-200 shadow-sm"
                                                }`}
                                            >
                                                {!isRight && (
                                                    <p className="text-[9px] font-semibold text-steel-400 mb-1">
                                                        {msg.role === "assistant" ? t("inbox.aiLabel") : t("inbox.customerLabel")}
                                                    </p>
                                                )}
                                                {msg.content}
                                                {/* Source References */}
                                                {msg.role === "assistant" && msg.metadata?.sources && msg.metadata.sources.length > 0 && (
                                                    <div className="mt-2 pt-2 border-t border-steel-200/50">
                                                        <p className="text-[9px] font-medium text-steel-400 mb-1">{t("inbox.sourcesLabel")}</p>
                                                        <div className="flex flex-wrap gap-1">
                                                            {msg.metadata.sources.map((src, i) => {
                                                                const docLabel = src.document_name ?? `${src.document_id.slice(0, 8)}…`;
                                                                const pageLabel = src.page_start != null
                                                                    ? src.page_start === src.page_end || src.page_end == null
                                                                        ? `${t("inbox.page")} ${src.page_start}`
                                                                        : `${t("inbox.page")} ${src.page_start}–${src.page_end}`
                                                                    : null;
                                                                return (
                                                                    <span
                                                                        key={i}
                                                                        className="inline-flex items-center gap-1 text-[9px] font-medium bg-white/60 text-steel-500 px-2 py-0.5 rounded-full border border-steel-200"
                                                                        title={`${docLabel}${pageLabel ? ` — ${pageLabel}` : ""} (${(src.score * 100).toFixed(0)}%)`}
                                                                    >
                                                                        <span className="truncate max-w-[100px]">{docLabel}</span>
                                                                        {pageLabel && <span className="text-steel-400">{pageLabel}</span>}
                                                                    </span>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                                <p className="text-[9px] mt-1.5 opacity-60">
                                                    {new Date(msg.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                                                </p>
                                            </div>
                                            {/* Right avatar (AI or admin) */}
                                            {isRight && (
                                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 ${
                                                    isAdmin ? "bg-blue-600 text-white" : "bg-brand-400 text-steel-900"
                                                }`}>
                                                    {isAdmin ? "A" : "S"}
                                                </div>
                                            )}
                                        </div>
                                        );
                                    })}
                                    <div ref={messagesEndRef} />
                                </div>
                            )}
                        </div>

                        {/* ── Admin Reply Composer ─────────────────── */}
                        {selectedSession.status === "human_takeover" && (
                            <div className="px-6 py-3 border-t border-steel-100 bg-white">
                                <div className="flex items-end gap-3 bg-white rounded-xl border-2 border-blue-300 focus-within:ring-2 focus-within:ring-blue-100 transition-all px-3 py-2">
                                    <textarea
                                        ref={replyInputRef}
                                        value={replyText}
                                        onChange={(e) => {
                                            setReplyText(e.target.value);
                                            const el = e.target;
                                            el.style.height = "auto";
                                            el.style.height = Math.min(el.scrollHeight, 120) + "px";
                                        }}
                                        onKeyDown={handleReplyKeyDown}
                                        placeholder={t("inbox.replyPlaceholder")}
                                        disabled={sendingReply}
                                        rows={1}
                                        className="flex-1 bg-transparent text-sm text-steel-800 placeholder:text-steel-400 resize-none outline-none max-h-[120px] py-1 leading-relaxed disabled:opacity-50"
                                    />
                                    <button
                                        onClick={handleSendReply}
                                        disabled={sendingReply || !replyText.trim()}
                                        className="w-8 h-8 bg-blue-500 text-white rounded-lg flex items-center justify-center hover:bg-blue-600 disabled:bg-steel-200 disabled:text-steel-400 transition-all cursor-pointer disabled:cursor-not-allowed shrink-0"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                            <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
                                        </svg>
                                    </button>
                                </div>
                                <p className="text-[10px] text-steel-400 mt-1.5 text-center">
                                    {t("inbox.replyHint")}
                                </p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
