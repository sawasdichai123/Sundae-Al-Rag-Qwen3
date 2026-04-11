/**
 * WebChatPage — Chat with Bot Selector (Figma-matched)
 *
 * Features:
 * - Bot selector dropdown (top-left, matches Figma HomePage1.png)
 * - Dynamic org_id and user_id from auth store
 * - RAG chat via chatApi.askStream() (SSE streaming)
 * - Source citations with confidence scores
 * - Human handoff: request human → admin replies via polling
 * - Session persistence across refresh (localStorage + DB reload)
 * - Session status sync (admin status changes reflected in real-time)
 * - "New Chat" button to start fresh conversations
 *
 * Figma ref: HomePage1.png
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { chatApi, botsApi, inboxApi } from "../api/endpoints";
import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";
import type { Bot, SessionStatus, SourceReference } from "../types";
import { useT } from "../i18n";
import DocumentViewer from "../components/DocumentViewer";

// ── Types ───────────────────────────────────────────────────────

interface ChatBubble {
    id: string;
    role: "user" | "assistant" | "admin" | "system";
    content: string;
    sources?: SourceReference[];
    timestamp: Date;
}

// ── Helpers ──────────────────────────────────────────────────────

/** localStorage key per bot+org+user for session persistence.
 * User ID is included so different users on the same browser don't share sessions. */
const sessionKey = (botId: string, orgId?: string, userId?: string) =>
    `sundae_chat_session_${userId || "anon"}_${orgId || ""}_${botId}`;

// ── Icons ───────────────────────────────────────────────────────

function SendIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
        </svg>
    );
}

function StopIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <rect x="4" y="4" width="12" height="12" rx="2" />
        </svg>
    );
}

function SourceIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
            <path d="M2.5 3A1.5 1.5 0 0 0 1 4.5v.793c.026.009.051.02.076.032L7.674 8.52c.18.085.37.13.562.138V4H9.5v4.658a1.48 1.48 0 0 0 .562-.138l6.598-3.195A1.5 1.5 0 0 0 15 4.5v-.793a1.5 1.5 0 0 0-1.5-1.5h-11Z" />
            <path d="M16 6.832v4.668a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 2 11.5V6.832l6.274 3.04a2.5 2.5 0 0 0 2.252-.02L16 6.833Z" />
        </svg>
    );
}

function ChevronDownIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
    );
}

// ── Component ───────────────────────────────────────────────────

export default function WebChatPage() {
    const t = useT();
    const tRef = useRef(t);
    useEffect(() => { tRef.current = t; }, [t]);
    const [messages, setMessages] = useState<ChatBubble[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [loadingSeconds, setLoadingSeconds] = useState(0);
    const [sessionId, setSessionId] = useState<string>("");
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Auth store
    const user = useAuthStore((s) => s.user);
    const activeOrgId = useOrgStore((s) => s.activeOrgId);
    const orgId = activeOrgId || user?.organization_id || import.meta.env.VITE_DEFAULT_ORG_ID || "";
    const [platformUserId, setPlatformUserId] = useState(() => user?.id || `web-${crypto.randomUUID()}`);
    useEffect(() => {
        if (user?.id) setPlatformUserId(user.id);
    }, [user?.id]);

    // Bot selector
    const [bots, setBots] = useState<Bot[]>([]);
    const [selectedBotId, setSelectedBotId] = useState<string>(import.meta.env.VITE_DEFAULT_BOT_ID || "");
    const [botDropdownOpen, setBotDropdownOpen] = useState(false);

    // Human handoff
    const [sessionStatus, setSessionStatus] = useState<SessionStatus>("active");
    const [handoffRequesting, setHandoffRequesting] = useState(false);
    const lastPollTimestampRef = useRef<string | null>(null);

    // Chat history sidebar
    interface HistorySession {
        id: string;
        bot_id: string | null;
        bot_name: string | null;
        status: string;
        last_message_at: string | null;
    }
    const [historySessions, setHistorySessions] = useState<HistorySession[]>([]);
    const [sidebarOpen, setSidebarOpen] = useState(true);

    // Document preview
    const [viewerState, setViewerState] = useState<{ documentId: string; pageStart: number | null } | null>(null);

    // Load chat history
    const historyLoadedRef = useRef(false);
    const loadHistory = useCallback(async () => {
        if (!orgId) return;
        try {
            const res = await inboxApi.mySessions(orgId);
            const sessions: HistorySession[] = res.data || [];
            setHistorySessions(sessions);

            // On first load, auto-select the most recent session for the current bot
            // so the user sees their last conversation instead of the welcome screen
            if (!historyLoadedRef.current && sessions.length > 0) {
                historyLoadedRef.current = true;
                setSelectedBotId((currentBotId) => {
                    const botId = currentBotId || null;
                    const lastSession = botId
                        ? (sessions.find((s) => s.bot_id === botId) || sessions[0])
                        : sessions[0];
                    if (lastSession) {
                        if (lastSession.bot_id) {
                            localStorage.setItem(sessionKey(lastSession.bot_id, orgId, platformUserId), lastSession.id);
                        }
                        setSessionId(lastSession.id);
                        setMessages([]);
                        setSessionStatus((lastSession.status || "active") as SessionStatus);
                        lastPollTimestampRef.current = null;
                    }
                    return lastSession?.bot_id || currentBotId;
                });
            }
        } catch (err) {
            console.error("[Chat] Failed to load history:", err);
        }
    }, [orgId]);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    // Load bots
    const loadBots = useCallback(async () => {
        if (!orgId) return;
        try {
            const res = await botsApi.list(orgId);
            setBots(res.data);
            // Auto-select first active web-enabled bot if none selected yet
            setSelectedBotId((prev) => {
                if (prev) return prev; // already selected — don't overwrite
                if (res.data.length === 0) return prev;
                const webBot = res.data.find((b) => b.is_active && b.is_web_enabled);
                return webBot ? webBot.id : res.data[0].id;
            });
        } catch (err) {
            console.error("[Chat] Failed to load bots:", err);
        }
    }, [orgId]);

    useEffect(() => {
        loadBots();
    }, [loadBots]);

    const selectedBot = bots.find((b) => b.id === selectedBotId);

    // ── Fix 2: Session persistence — load or create sessionId per bot+org ──
    useEffect(() => {
        if (!selectedBotId) return;
        const stored = localStorage.getItem(sessionKey(selectedBotId, orgId, platformUserId));
        if (stored) {
            setSessionId(stored);
        } else {
            const newId = crypto.randomUUID();
            localStorage.setItem(sessionKey(selectedBotId, orgId, platformUserId), newId);
            setSessionId(newId);
        }
        // Reset messages — will be loaded from DB by the next useEffect
        setMessages([]);
        setSessionStatus("active");
        lastPollTimestampRef.current = null;
    }, [selectedBotId, orgId]);

    // ── Fix 2: Reload messages + session status from DB on mount ────────
    useEffect(() => {
        if (!sessionId || !orgId) return;
        let cancelled = false;
        const restore = async () => {
            try {
                // Load messages from DB
                const msgRes = await inboxApi.getMessages(sessionId, orgId);
                if (cancelled) return;
                if (msgRes.data && msgRes.data.length > 0) {
                    const loaded: ChatBubble[] = msgRes.data.map(
                        (m: { id: string; role: string; content: string; metadata?: { sources?: SourceReference[] }; created_at: string }) => ({
                            id: m.id,
                            role: m.role as ChatBubble["role"],
                            content: m.content,
                            sources: m.metadata?.sources,
                            timestamp: new Date(m.created_at),
                        })
                    );
                    setMessages(loaded);
                }

                // Check current session status via polling endpoint
                // Use epoch only to read status — but cap at "now" so poll doesn't re-fetch
                const pollRes = await inboxApi.getNewMessages(sessionId, orgId, "1970-01-01T00:00:00Z");
                if (cancelled) return;
                if (pollRes.data?.session_status) {
                    setSessionStatus(pollRes.data.session_status as SessionStatus);
                    // Anchor poll timestamp to latest message, or to now if none
                    const msgs = pollRes.data.messages;
                    lastPollTimestampRef.current = (msgs && msgs.length > 0)
                        ? msgs[msgs.length - 1].created_at
                        : new Date().toISOString();
                } else {
                    // No status returned — anchor to now so first poll doesn't fetch all history
                    if (!lastPollTimestampRef.current) {
                        lastPollTimestampRef.current = new Date().toISOString();
                    }
                }
            } catch (err) {
                // Session doesn't exist in DB yet — that's fine, first message will create it
                console.warn("[Chat] Failed to restore session messages:", err);
            }
        };
        restore();
        return () => { cancelled = true; };
    }, [sessionId, orgId]);

    // Loading timer — show elapsed seconds while waiting for AI
    useEffect(() => {
        if (!isLoading) {
            setLoadingSeconds(0);
            return;
        }
        const interval = setInterval(() => setLoadingSeconds((s) => s + 1), 1000);
        return () => clearInterval(interval);
    }, [isLoading]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Close bot dropdown when clicking outside
    useEffect(() => {
        if (!botDropdownOpen) return;
        const handleClickOutside = () => setBotDropdownOpen(false);
        // Delay to avoid closing immediately on the same click that opens it
        const timer = setTimeout(() => {
            document.addEventListener("click", handleClickOutside);
        }, 0);
        return () => {
            clearTimeout(timer);
            document.removeEventListener("click", handleClickOutside);
        };
    }, [botDropdownOpen]);

    // ── Fix 1: Poll for admin replies + sync session status ─────────────
    // Use a ref to read sessionStatus inside the interval without
    // re-creating the interval every time the status changes.
    const sessionStatusRef = useRef(sessionStatus);
    useEffect(() => { sessionStatusRef.current = sessionStatus; }, [sessionStatus]);

    // Poll in any non-terminal status so we catch admin-initiated changes
    useEffect(() => {
        if (!orgId || !sessionId) return;

        // aborted flag prevents state updates from in-flight requests
        // that complete after the effect cleanup runs
        let aborted = false;

        const interval = setInterval(async () => {
            // No need to poll terminal statuses
            if (sessionStatusRef.current === "resolved") return;
            if (document.hidden) return; // skip polling when tab is not visible
            if (aborted) return;
            try {
                // Use current time as fallback — prevents fetching entire history
                // on first poll when session was just created
                const after = lastPollTimestampRef.current ?? new Date().toISOString();
                const res = await inboxApi.getNewMessages(sessionId, orgId, after);
                if (aborted) return;
                const pollData = res.data;

                // Process new messages
                const newMsgs = pollData?.messages || pollData;
                if (Array.isArray(newMsgs) && newMsgs.length > 0) {
                    const bubbles: ChatBubble[] = newMsgs
                        .filter((m: { role: string }) => m.role === "admin" || m.role === "system")
                        .map((m: { id: string; role: string; content: string; created_at: string }) => ({
                            id: m.id,
                            role: m.role as "admin" | "system",
                            content: m.content,
                            timestamp: new Date(m.created_at),
                        }));
                    if (bubbles.length > 0) {
                        setMessages((prev) => {
                            const existingIds = new Set(prev.map((p) => p.id));
                            const unique = bubbles.filter((b) => !existingIds.has(b.id));
                            return unique.length > 0 ? [...prev, ...unique] : prev;
                        });
                    }
                    const lastMsg = newMsgs[newMsgs.length - 1];
                    lastPollTimestampRef.current = lastMsg.created_at;
                }

                // Sync session status from backend — only react when it actually changes
                const backendStatus = pollData?.session_status;
                if (backendStatus && backendStatus !== sessionStatusRef.current) {
                    setSessionStatus(backendStatus as SessionStatus);
                    if (backendStatus === "active") {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: crypto.randomUUID(),
                                role: "system",
                                content: tRef.current("chat.staffReturnedAI"),
                                timestamp: new Date(),
                            },
                        ]);
                    } else if (backendStatus === "helped") {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: crypto.randomUUID(),
                                role: "system",
                                content: tRef.current("chat.staffHelped"),
                                timestamp: new Date(),
                            },
                        ]);
                    } else if (backendStatus === "resolved") {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: crypto.randomUUID(),
                                role: "system",
                                content: tRef.current("chat.staffClosed"),
                                timestamp: new Date(),
                            },
                        ]);
                    }
                }
            } catch (err) {
                if (aborted) return;
                console.error("[Poll] Failed to fetch new messages:", err);
            }
        }, 3000);

        return () => {
            aborted = true;
            clearInterval(interval);
        };
    }, [sessionId, orgId]);

    // Request human handoff
    const handleRequestHuman = async () => {
        if (!selectedBotId || !orgId || handoffRequesting) return;
        setHandoffRequesting(true);
        try {
            await chatApi.requestHuman(sessionId, orgId, selectedBotId);
        } catch (err) {
            console.error("[Handoff] Failed:", err);
            // Show error to user and allow retry
            setMessages((prev) => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    role: "system",
                    content: tRef.current("chat.handoffFailed"),
                    timestamp: new Date(),
                },
            ]);
            setHandoffRequesting(false);
            return;
        }

        // Success — update state
        setSessionStatus("human_takeover");
        lastPollTimestampRef.current = new Date().toISOString();
        setHandoffRequesting(false);

        // Show system message locally
        setMessages((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                role: "system",
                content: t("chat.callingStaff"),
                timestamp: new Date(),
            },
        ]);
    };

    // Cancel human handoff — revert to bot mode
    const handleCancelHuman = async () => {
        if (!orgId) return;
        try {
            await chatApi.cancelHuman(sessionId, orgId);
            setSessionStatus("active");
            setMessages((prev) => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    role: "system",
                    content: t("chat.cancelledHandoff"),
                    timestamp: new Date(),
                },
            ]);
        } catch (err) {
            console.error("[CancelHandoff] Failed:", err);
        }
    };

    // ── Fix 3: Start a new chat ─────────────────────────────────────────
    const handleNewChat = () => {
        if (!selectedBotId) return;
        const newId = crypto.randomUUID();
        localStorage.setItem(sessionKey(selectedBotId, orgId, platformUserId), newId);
        setSessionId(newId);
        setMessages([]);
        setSessionStatus("active");
        setInput("");
        lastPollTimestampRef.current = null;
        inputRef.current?.focus();
    };

    // Switch to a history session
    const handleSelectSession = (hist: HistorySession) => {
        if (hist.bot_id) {
            setSelectedBotId(hist.bot_id);
            localStorage.setItem(sessionKey(hist.bot_id, orgId, platformUserId), hist.id);
        }
        setSessionId(hist.id);
        setMessages([]);
        setSessionStatus((hist.status || "active") as SessionStatus);
        lastPollTimestampRef.current = null;
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        const el = e.target;
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 150) + "px";
    };

    const handleSend = async () => {
        const query = input.trim();
        if (!query || !selectedBotId || !sessionId) return;
        if (isLoading && sessionStatus !== "human_takeover") return;

        const userMsg: ChatBubble = {
            id: crypto.randomUUID(),
            role: "user",
            content: query,
            timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        if (inputRef.current) inputRef.current.style.height = "auto";

        // During human_takeover, send a plain message (no RAG)
        if (sessionStatus === "human_takeover") {
            try {
                await chatApi.sendMessage(sessionId, orgId, query);
            } catch (err) {
                console.error("[Chat] Failed to send message during handoff:", err);
            }
            inputRef.current?.focus();
            return;
        }

        setIsLoading(true);
        setIsStreaming(false);

        const assistantId = crypto.randomUUID();
        let created = false;
        let finished = false;
        // Buffer sources — they arrive before the first token (before bubble exists)
        let pendingSources: SourceReference[] | null = null;
        // Keep a durable copy so onDone can always re-apply sources
        let finalSources: SourceReference[] | null = null;

        const markFinished = () => {
            if (finished) return; // Prevent double-call
            finished = true;
            setIsLoading(false);
            setIsStreaming(false);
            abortControllerRef.current = null;
            inputRef.current?.focus();
            loadHistory(); // Refresh sidebar after chat completes
        };

        abortControllerRef.current = chatApi.askStream(
            {
                userQuery: query,
                organizationId: orgId,
                botId: selectedBotId,
                platformUserId,
                platformSource: "web",
                sessionId,
            },
            // onToken — create bubble on first token, then append
            (token) => {
                if (!created) {
                    created = true;
                    setIsStreaming(true);
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: assistantId,
                            role: "assistant",
                            content: token,
                            sources: pendingSources ?? undefined,
                            timestamp: new Date(),
                        },
                    ]);
                    pendingSources = null;
                } else {
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === assistantId
                                ? { ...m, content: m.content + token }
                                : m
                        )
                    );
                }
            },
            // onSources — buffer if bubble doesn't exist yet
            (sources) => {
                finalSources = sources; // always keep a copy
                if (!created) {
                    pendingSources = sources;
                } else {
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === assistantId ? { ...m, sources } : m
                        )
                    );
                }
            },
            // onDone — re-apply sources to guarantee they're on the final message
            () => {
                if (finalSources && finalSources.length > 0) {
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === assistantId ? { ...m, sources: finalSources! } : m
                        )
                    );
                }
                markFinished();
            },
            // onError
            (error) => {
                if (!created) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: assistantId,
                            role: "assistant",
                            content: `${t("chat.connectionError")} ${error}`,
                            timestamp: new Date(),
                        },
                    ]);
                } else {
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === assistantId
                                ? { ...m, content: m.content + `\n\n(Error: ${error})` }
                                : m
                        )
                    );
                }
                markFinished();
            },
        );
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleCancel = () => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
    };

    // Abort streaming on unmount to prevent memory leaks
    useEffect(() => {
        return () => {
            abortControllerRef.current?.abort();
        };
    }, []);

    // Helper: format relative time
    const timeAgo = (dateStr: string | null) => {
        if (!dateStr) return "";
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return "";
        const diff = Date.now() - d.getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return t("chat.justNow");
        if (mins < 60) return t("chat.minutesAgo").replace("{n}", String(mins));
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return t("chat.hoursAgo").replace("{n}", String(hrs));
        const days = Math.floor(hrs / 24);
        return t("chat.daysAgo").replace("{n}", String(days));
    };

    return (
        <div className="flex bg-gradient-to-b from-white via-steel-50 to-white -m-6 lg:-m-8" style={{ height: "calc(100vh - 4rem)" }}>
            {/* ── Chat History Sidebar ────────────────────────────── */}
            {sidebarOpen && (
                <aside className="w-72 border-r border-steel-100 bg-white flex flex-col shrink-0">
                    {/* Sidebar Header */}
                    <div className="px-4 h-14 border-b border-steel-100 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-steel-800">{t("chat.history")}</h2>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setSidebarOpen(false)}
                                className="p-1.5 text-steel-400 hover:text-steel-600 transition-colors cursor-pointer"
                                title={t("chat.hideSidebar")}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                                    <path fillRule="evenodd" d="M12.78 7.47a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 8.53a.75.75 0 0 1 1.06-1.06L8 11.19l3.72-3.72a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" transform="rotate(90 8 8)" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Session List */}
                    <div className="flex-1 overflow-y-auto">
                        {historySessions.length === 0 ? (
                            <p className="px-4 py-8 text-xs text-steel-400 text-center">{t("chat.noHistory")}</p>
                        ) : (
                            historySessions.map((hist) => (
                                <button
                                    key={hist.id}
                                    onClick={() => handleSelectSession(hist)}
                                    className={`w-full text-left px-4 py-3 border-b border-steel-50 hover:bg-steel-50 transition-colors cursor-pointer ${hist.id === sessionId ? "bg-brand-50 border-l-2 border-l-brand-400" : ""}`}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-medium text-steel-700 truncate max-w-[140px]">
                                            {hist.bot_name || "Bot"}
                                        </span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${hist.status === "active" ? "bg-emerald-50 text-emerald-600" :
                                            hist.status === "human_takeover" ? "bg-amber-50 text-amber-600" :
                                                "bg-steel-100 text-steel-500"
                                            }`}>
                                            {hist.status === "active" ? t("chat.statusActive") : hist.status === "human_takeover" ? t("chat.statusTakeover") : t("chat.statusResolved")}
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-steel-400">
                                        {timeAgo(hist.last_message_at)}
                                    </p>
                                </button>
                            ))
                        )}
                    </div>
                </aside>
            )}

            {/* ── Main Chat Area ──────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* ── Toolbar: sidebar toggle + bot selector ──────────── */}
                <div className="bg-white border-b border-steel-100 px-4 h-14 flex items-center gap-2">
                    {!sidebarOpen && (
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="p-1.5 text-steel-400 hover:text-steel-600 transition-colors cursor-pointer"
                            title={t("chat.showHistory")}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                                <path fillRule="evenodd" d="M2 3.75A.75.75 0 0 1 2.75 3h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.75ZM2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8Zm0 4.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
                            </svg>
                        </button>
                    )}
                    <div className="relative">
                        <button
                            onClick={() => setBotDropdownOpen(!botDropdownOpen)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-white border border-steel-200 rounded-lg text-sm font-medium text-steel-800 hover:border-brand-400 transition-colors cursor-pointer"
                        >
                            <span>{selectedBot?.name || t("chat.selectBot")}</span>
                            <ChevronDownIcon />
                        </button>

                        {botDropdownOpen && (
                            <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-steel-200 rounded-xl shadow-lg z-20 py-1 animate-fade-in">
                                {bots.length === 0 ? (
                                    <p className="px-4 py-3 text-xs text-steel-400">{t("chat.noBots")}</p>
                                ) : (
                                    bots.map((bot) => (
                                        <button
                                            key={bot.id}
                                            onClick={() => {
                                                setSelectedBotId(bot.id);
                                                setBotDropdownOpen(false);
                                            }}
                                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-steel-50 transition-colors cursor-pointer ${bot.id === selectedBotId ? "bg-brand-50 text-brand-700 font-medium" : "text-steel-700"
                                                }`}
                                        >
                                            <p className="font-medium">{bot.name}</p>
                                            {bot.description && (
                                                <p className="text-[11px] text-steel-400 truncate mt-0.5">{bot.description}</p>
                                            )}
                                        </button>
                                    ))
                                )}
                            </div>
                        )}
                    </div>

                    {messages.length > 0 && (
                        <button
                            onClick={handleNewChat}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-steel-600 bg-steel-50 border border-steel-200 rounded-lg hover:bg-steel-100 hover:text-steel-800 transition-colors cursor-pointer"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                                <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
                            </svg>
                            {t("chat.newChat")}
                        </button>
                    )}
                </div>

                {/* ── Messages ────────────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto">
                    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
                        {/* Welcome State */}
                        {messages.length === 0 && (
                            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-fade-in">
                                <div className="w-16 h-16 rounded-2xl bg-brand-400 flex items-center justify-center text-steel-900 text-2xl font-bold shadow-lg shadow-brand-200 mb-6">
                                    S
                                </div>
                                <h2 className="text-xl font-bold text-steel-900 mb-2">
                                    {t("chat.welcome")}
                                </h2>
                                <p className="text-sm text-steel-500 max-w-sm mb-8 leading-relaxed">
                                    {selectedBot
                                        ? (selectedBot.description || t("chat.welcomeBot").replace("{name}", selectedBot.name))
                                        : t("chat.welcomeSelectBot")}
                                </p>

                                {/* Suggestion Cards */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-lg">
                                    {[
                                        { text: t("chat.suggestion1") },
                                        { text: t("chat.suggestion2") },
                                        { text: t("chat.suggestion3") },
                                    ].map((s) => (
                                        <button
                                            key={s.text}
                                            onClick={() => {
                                                const q = s.text.replace(/\n/g, "");
                                                setInput(q);
                                                inputRef.current?.focus();
                                            }}
                                            className="group flex flex-col items-start gap-2 p-4 bg-white rounded-2xl border border-steel-200 hover:border-brand-400 hover:shadow-md hover:shadow-brand-100/50 transition-all duration-200 cursor-pointer text-left"
                                        >
                                            <span className="text-xs text-steel-600 group-hover:text-steel-800 transition-colors leading-relaxed whitespace-pre-line">
                                                {s.text}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Chat Messages */}
                        <div className="space-y-6">
                            {messages.map((msg) => {
                                // System messages — centered banner
                                if (msg.role === "system") {
                                    return (
                                        <div key={msg.id} className="flex justify-center animate-fade-in">
                                            <div className="bg-amber-50 text-amber-700 text-xs font-medium px-4 py-2 rounded-full border border-amber-200">
                                                {msg.content}
                                            </div>
                                        </div>
                                    );
                                }

                                const isUser = msg.role === "user";
                                const isAdmin = msg.role === "admin";

                                return (
                                    <div
                                        key={msg.id}
                                        className={`flex gap-3 animate-fade-in ${isUser ? "justify-end" : "justify-start"}`}
                                    >
                                        {/* AI / Admin Avatar */}
                                        {msg.role === "assistant" && (
                                            <div className="w-8 h-8 rounded-xl bg-brand-400 flex items-center justify-center text-steel-900 text-xs font-bold shrink-0 mt-0.5 shadow-sm">
                                                S
                                            </div>
                                        )}
                                        {isAdmin && (
                                            <div className="w-8 h-8 rounded-xl bg-blue-500 flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5 shadow-sm">
                                                A
                                            </div>
                                        )}

                                        <div
                                            className={`max-w-[75%] ${isUser
                                                ? "bg-steel-800 text-white rounded-2xl rounded-br-lg px-4 py-3 shadow-md shadow-steel-300"
                                                : isAdmin
                                                    ? "bg-blue-50 text-steel-800 rounded-2xl rounded-bl-lg px-4 py-3 border border-blue-200 shadow-sm"
                                                    : "bg-white text-steel-800 rounded-2xl rounded-bl-lg px-4 py-3 border border-steel-200 shadow-sm"
                                                }`}
                                        >
                                            {isAdmin && (
                                                <p className="text-[10px] font-semibold text-blue-500 mb-1">{t("chat.staffLabel")}</p>
                                            )}
                                            <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>

                                            {/* Source Pills */}
                                            {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                                                <div className="mt-3 pt-3 border-t border-steel-100">
                                                    <div className="flex items-center gap-1.5 mb-2">
                                                        <SourceIcon />
                                                        <span className="text-[11px] font-medium text-steel-400">{t("chat.sourcesLabel")}</span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {msg.sources.map((src, i) => {
                                                            const docLabel = src.document_name ?? `${src.document_id.slice(0, 8)}…`;
                                                            const pageLabel = src.page_start != null
                                                                ? src.page_start === src.page_end || src.page_end == null
                                                                    ? `${t("chat.page")} ${src.page_start}`
                                                                    : `${t("chat.page")} ${src.page_start}–${src.page_end}`
                                                                : null;
                                                            return (
                                                                <button
                                                                    key={i}
                                                                    onClick={() => setViewerState({ documentId: src.document_id, pageStart: src.page_start })}
                                                                    className="inline-flex items-center gap-1 text-[10px] font-medium bg-steel-50 text-steel-500 px-2.5 py-1 rounded-full border border-steel-200 cursor-pointer hover:bg-steel-100 hover:border-steel-300 transition-colors"
                                                                    title={`${docLabel}${pageLabel ? ` — ${pageLabel}` : ""} (${(src.score * 100).toFixed(0)}%)`}
                                                                >
                                                                    <span className="w-1 h-1 rounded-full bg-brand-400"></span>
                                                                    <span className="truncate max-w-[120px]">{docLabel}</span>
                                                                    {pageLabel && (
                                                                        <span className="text-steel-400 shrink-0">{pageLabel}</span>
                                                                    )}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            <p className={`text-[10px] mt-2 ${isUser ? "text-steel-400" : "text-steel-400"}`}>
                                                {msg.timestamp.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                                            </p>
                                        </div>

                                        {/* User Avatar */}
                                        {isUser && (
                                            <div className="w-8 h-8 rounded-xl bg-steel-700 flex items-center justify-center text-white text-xs font-semibold shrink-0 mt-0.5">
                                                {(user?.first_name || user?.email)?.[0]?.toUpperCase() || "U"}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Typing Indicator — hide once streaming starts */}
                            {isLoading && !isStreaming && (
                                <div className="flex gap-3 animate-fade-in">
                                    <div className="w-8 h-8 rounded-xl bg-brand-400 flex items-center justify-center text-steel-900 text-xs font-bold shrink-0 shadow-sm">
                                        S
                                    </div>
                                    <div className="bg-white rounded-2xl rounded-bl-lg px-5 py-4 border border-steel-200 shadow-sm">
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-1.5">
                                                <span className="w-2 h-2 bg-steel-400 rounded-full animate-pulse-dot-1"></span>
                                                <span className="w-2 h-2 bg-steel-400 rounded-full animate-pulse-dot-2"></span>
                                                <span className="w-2 h-2 bg-steel-400 rounded-full animate-pulse-dot-3"></span>
                                            </div>
                                            {loadingSeconds >= 3 && (
                                                <span className="text-[11px] text-steel-400 ml-1">
                                                    {loadingSeconds < 10
                                                        ? t("chat.searching")
                                                        : loadingSeconds < 30
                                                            ? t("chat.analyzing")
                                                            : t("chat.processingTime").replace("{n}", String(loadingSeconds))}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Fix 3: Resolved state — show "start new chat" prompt */}
                            {sessionStatus === "resolved" && (
                                <div className="flex flex-col items-center gap-3 py-6 animate-fade-in">
                                    <div className="bg-steel-50 text-steel-500 text-xs font-medium px-4 py-2 rounded-full border border-steel-200">
                                        {t("chat.caseResolved")}
                                    </div>
                                    <button
                                        onClick={handleNewChat}
                                        className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-brand-400 rounded-xl hover:bg-brand-500 transition-colors cursor-pointer shadow-sm shadow-brand-200"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                                            <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
                                        </svg>
                                        {t("chat.startNewChat")}
                                    </button>
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>
                    </div>
                </div>

                {/* ── Human Takeover Banner ─────────────────────────── */}
                {sessionStatus === "human_takeover" && (
                    <div className="bg-blue-50 border-t border-blue-200 px-4 py-2.5 flex items-center justify-center gap-3">
                        <span className="text-xs font-medium text-blue-700">
                            {t("chat.staffCaring")}
                        </span>
                        <button
                            onClick={handleCancelHuman}
                            className="text-[11px] font-medium text-red-600 bg-red-50 border border-red-200 px-3 py-1 rounded-full hover:bg-red-100 transition-colors cursor-pointer"
                        >
                            {t("chat.cancelHuman")}
                        </button>
                    </div>
                )}

                {/* ── Input Area (yellow border per Figma) ─────────────── */}
                {sessionStatus !== "resolved" && (
                    <div className="bg-white/80 backdrop-blur-xl border-t border-steel-100">
                        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
                            {/* Request Human button — only when session has messages & still active & not requesting */}
                            {messages.length > 0 && (sessionStatus === "active" || sessionStatus === "helped") && !isLoading && !handoffRequesting && (
                                <div className="flex justify-center mb-3">
                                    <button
                                        onClick={handleRequestHuman}
                                        disabled={handoffRequesting}
                                        className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full hover:bg-amber-100 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <span>🙋</span>
                                        {handoffRequesting ? t("chat.requestingHuman") : t("chat.requestHuman")}
                                    </button>
                                </div>
                            )}

                            <div className="flex items-end gap-3 bg-white rounded-2xl border-2 border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 transition-all duration-200 px-4 py-2.5 shadow-sm">
                                <textarea
                                    ref={inputRef}
                                    value={input}
                                    onChange={handleInputChange}
                                    onKeyDown={handleKeyDown}
                                    placeholder={sessionStatus === "human_takeover" ? t("chat.placeholderHuman") : t("chat.placeholder")}
                                    disabled={(isLoading && sessionStatus !== "human_takeover") || !selectedBotId || !sessionId}
                                    rows={1}
                                    className="flex-1 bg-transparent text-sm text-steel-800 placeholder:text-steel-400 resize-none outline-none max-h-[150px] py-1 leading-relaxed disabled:opacity-50"
                                />
                                {isLoading && sessionStatus !== "human_takeover" ? (
                                    <button
                                        onClick={handleCancel}
                                        className="w-9 h-9 bg-red-500 text-white rounded-xl flex items-center justify-center hover:bg-red-600 transition-all duration-200 cursor-pointer shrink-0"
                                        title={t("chat.cancelRequest")}
                                    >
                                        <StopIcon />
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleSend}
                                        disabled={isLoading || !input.trim() || !selectedBotId || !sessionId}
                                        className="w-9 h-9 bg-brand-400 text-steel-900 rounded-xl flex items-center justify-center hover:bg-brand-500 disabled:bg-steel-200 disabled:text-steel-400 transition-all duration-200 cursor-pointer disabled:cursor-not-allowed shrink-0"
                                    >
                                        <SendIcon />
                                    </button>
                                )}
                            </div>
                            <p className="text-center text-[11px] text-steel-400 mt-2.5">
                                {t("chat.footer")}
                            </p>
                        </div>
                    </div>
                )}
            </div> {/* end Main Chat Area */}

            {/* Document Preview Modal */}
            {viewerState && (
                <DocumentViewer
                    documentId={viewerState.documentId}
                    organizationId={orgId}
                    page={viewerState.pageStart}
                    onClose={() => setViewerState(null)}
                />
            )}
        </div>
    );
}
