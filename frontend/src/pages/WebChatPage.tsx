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
import type { Bot, SessionStatus } from "../types";

// ── Types ───────────────────────────────────────────────────────

interface ChatBubble {
    id: string;
    role: "user" | "assistant" | "admin" | "system";
    content: string;
    sources?: Array<{ document_id: string; chunk_index: number; score: number }>;
    timestamp: Date;
}

// ── Helpers ──────────────────────────────────────────────────────

/** localStorage key per bot for session persistence */
const sessionKey = (botId: string) => `sundae_chat_session_${botId}`;

// ── Icons ───────────────────────────────────────────────────────

function SendIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
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
    const [messages, setMessages] = useState<ChatBubble[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [loadingSeconds, setLoadingSeconds] = useState(0);
    const [sessionId, setSessionId] = useState<string>("");
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Auth store
    const user = useAuthStore((s) => s.user);
    const orgId = user?.organization_id || import.meta.env.VITE_DEFAULT_ORG_ID || "";
    const platformUserId = user?.id || `web-${crypto.randomUUID().slice(0, 8)}`;

    // Bot selector
    const [bots, setBots] = useState<Bot[]>([]);
    const [selectedBotId, setSelectedBotId] = useState<string>(import.meta.env.VITE_DEFAULT_BOT_ID || "");
    const [botDropdownOpen, setBotDropdownOpen] = useState(false);

    // Human handoff
    const [sessionStatus, setSessionStatus] = useState<SessionStatus>("active");
    const [handoffRequesting, setHandoffRequesting] = useState(false);
    const lastPollTimestampRef = useRef<string | null>(null);

    // Load bots
    const loadBots = useCallback(async () => {
        if (!orgId) return;
        try {
            const res = await botsApi.list(orgId);
            setBots(res.data);
            // Auto-select first active web-enabled bot if none selected
            if (!selectedBotId && res.data.length > 0) {
                const webBot = res.data.find((b) => b.is_active && b.is_web_enabled);
                if (webBot) setSelectedBotId(webBot.id);
                else setSelectedBotId(res.data[0].id);
            }
        } catch (err) {
            console.error("[Chat] Failed to load bots:", err);
        }
    }, [orgId, selectedBotId]);

    useEffect(() => {
        loadBots();
    }, [loadBots]);

    const selectedBot = bots.find((b) => b.id === selectedBotId);

    // ── Fix 2: Session persistence — load or create sessionId per bot ──
    useEffect(() => {
        if (!selectedBotId) return;
        const stored = localStorage.getItem(sessionKey(selectedBotId));
        if (stored) {
            setSessionId(stored);
        } else {
            const newId = crypto.randomUUID();
            localStorage.setItem(sessionKey(selectedBotId), newId);
            setSessionId(newId);
        }
        // Reset messages — will be loaded from DB by the next useEffect
        setMessages([]);
        setSessionStatus("active");
        lastPollTimestampRef.current = null;
    }, [selectedBotId]);

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
                        (m: { id: string; role: string; content: string; created_at: string }) => ({
                            id: m.id,
                            role: m.role as ChatBubble["role"],
                            content: m.content,
                            timestamp: new Date(m.created_at),
                        })
                    );
                    setMessages(loaded);
                }

                // Check current session status via polling endpoint
                const pollRes = await inboxApi.getNewMessages(sessionId, orgId, "1970-01-01T00:00:00Z");
                if (cancelled) return;
                if (pollRes.data?.session_status) {
                    setSessionStatus(pollRes.data.session_status as SessionStatus);
                    // Set poll timestamp to latest message to avoid re-fetching
                    const msgs = pollRes.data.messages;
                    if (msgs && msgs.length > 0) {
                        lastPollTimestampRef.current = msgs[msgs.length - 1].created_at;
                    }
                }
            } catch {
                // Session doesn't exist in DB yet — that's fine, first message will create it
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

    // ── Fix 1: Poll for admin replies + sync session status ─────────────
    useEffect(() => {
        if (sessionStatus !== "human_takeover" || !orgId || !sessionId) return;

        const interval = setInterval(async () => {
            try {
                const after = lastPollTimestampRef.current || new Date().toISOString();
                const res = await inboxApi.getNewMessages(sessionId, orgId, after);
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

                // Sync session status from backend
                const backendStatus = pollData?.session_status;
                if (backendStatus && backendStatus !== "human_takeover") {
                    setSessionStatus(backendStatus as SessionStatus);
                    if (backendStatus === "active") {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: crypto.randomUUID(),
                                role: "system",
                                content: "เจ้าหน้าที่คืนร่างให้ AI แล้ว — สามารถถามคำถามได้ตามปกติ",
                                timestamp: new Date(),
                            },
                        ]);
                    } else if (backendStatus === "resolved") {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: crypto.randomUUID(),
                                role: "system",
                                content: "เจ้าหน้าที่ปิดเคสแล้ว — ขอบคุณที่ใช้บริการ",
                                timestamp: new Date(),
                            },
                        ]);
                    }
                }
            } catch (err) {
                console.error("[Poll] Failed to fetch new messages:", err);
            }
        }, 3000);

        return () => clearInterval(interval);
    }, [sessionStatus, sessionId, orgId]);

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
                    content: "ไม่สามารถเรียกเจ้าหน้าที่ได้ กรุณาลองอีกครั้ง",
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
                content: "กำลังเรียกเจ้าหน้าที่... กรุณารอสักครู่",
                timestamp: new Date(),
            },
        ]);
    };

    // ── Fix 3: Start a new chat ─────────────────────────────────────────
    const handleNewChat = () => {
        if (!selectedBotId) return;
        const newId = crypto.randomUUID();
        localStorage.setItem(sessionKey(selectedBotId), newId);
        setSessionId(newId);
        setMessages([]);
        setSessionStatus("active");
        setInput("");
        lastPollTimestampRef.current = null;
        inputRef.current?.focus();
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

        try {
            await chatApi.askStream(
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
                                timestamp: new Date(),
                            },
                        ]);
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
                // onSources
                (sources) => {
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === assistantId ? { ...m, sources } : m
                        )
                    );
                },
                // onDone
                () => {
                    setIsLoading(false);
                    setIsStreaming(false);
                    inputRef.current?.focus();
                },
                // onError
                (error) => {
                    if (!created) {
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: assistantId,
                                role: "assistant",
                                content: `ขออภัย ไม่สามารถเชื่อมต่อได้: ${error}`,
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
                    setIsLoading(false);
                    setIsStreaming(false);
                },
            );
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
            if (!created) {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: assistantId,
                        role: "assistant",
                        content: `ขออภัย ไม่สามารถเชื่อมต่อได้: ${errorMessage}`,
                        timestamp: new Date(),
                    },
                ]);
            }
            setIsLoading(false);
            setIsStreaming(false);
            inputRef.current?.focus();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex flex-col h-screen bg-gradient-to-b from-white via-steel-50 to-white">
            {/* ── Header with Bot Selector ─────────────────────────── */}
            <header className="bg-white/80 backdrop-blur-xl border-b border-steel-100 px-6 py-3.5 flex items-center justify-between sticky top-0 z-10">
                {/* Bot Selector Dropdown */}
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <button
                            onClick={() => setBotDropdownOpen(!botDropdownOpen)}
                            className="flex items-center gap-2 px-4 py-2 bg-white border border-steel-200 rounded-xl text-sm font-medium text-steel-800 hover:border-brand-400 transition-colors cursor-pointer"
                        >
                            <span>{selectedBot?.name || "Select Bots"}</span>
                            <ChevronDownIcon />
                        </button>

                        {botDropdownOpen && (
                            <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-steel-200 rounded-xl shadow-lg z-20 py-1 animate-fade-in">
                                {bots.length === 0 ? (
                                    <p className="px-4 py-3 text-xs text-steel-400">ไม่พบ Bot — กรุณาสร้าง Bot ก่อน</p>
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

                    {/* Fix 3: New Chat button */}
                    {messages.length > 0 && (
                        <button
                            onClick={handleNewChat}
                            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-steel-600 bg-steel-50 border border-steel-200 rounded-xl hover:bg-steel-100 hover:text-steel-800 transition-colors cursor-pointer"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                                <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
                            </svg>
                            แชทใหม่
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-2 px-2.5 py-1 bg-emerald-50 rounded-full">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                    <span className="text-[11px] font-medium text-emerald-700">Online</span>
                </div>
            </header>

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
                                Welcome to SUNDAE LLM
                            </h2>
                            <p className="text-sm text-steel-500 max-w-sm mb-8 leading-relaxed">
                                {selectedBot
                                    ? (selectedBot.description || `ถามคำถามกับ ${selectedBot.name}`)
                                    : "เลือก Bot จาก dropdown ด้านบนเพื่อเริ่มสนทนา"}
                            </p>

                            {/* Suggestion Cards */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-lg">
                                {[
                                    { icon: "📋", text: "นโยบายการลาหยุด\nเป็นอย่างไร?" },
                                    { icon: "💼", text: "สวัสดิการพนักงาน\nมีอะไรบ้าง?" },
                                    { icon: "💰", text: "วิธีการเบิก\nค่าใช้จ่าย" },
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
                                        <span className="text-lg">{s.icon}</span>
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
                                        <p className="text-[10px] font-semibold text-blue-500 mb-1">เจ้าหน้าที่</p>
                                    )}
                                    <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>

                                    {/* Source Pills */}
                                    {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                                        <div className="mt-3 pt-3 border-t border-steel-100">
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <SourceIcon />
                                                <span className="text-[11px] font-medium text-steel-400">อ้างอิงจากเอกสาร</span>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {msg.sources.map((src, i) => (
                                                    <span
                                                        key={i}
                                                        className="inline-flex items-center gap-1 text-[10px] font-medium bg-steel-50 text-steel-500 px-2.5 py-1 rounded-full border border-steel-200"
                                                    >
                                                        <span className="w-1 h-1 rounded-full bg-brand-400"></span>
                                                        {src.document_id.slice(0, 8)}…
                                                        <span className="text-steel-400">#{src.chunk_index}</span>
                                                        <span className="text-emerald-500 font-semibold">{(src.score * 100).toFixed(0)}%</span>
                                                    </span>
                                                ))}
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
                                        {(user?.full_name || user?.email)?.[0]?.toUpperCase() || "U"}
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
                                                    ? "กำลังค้นหาเอกสาร..."
                                                    : loadingSeconds < 30
                                                        ? "กำลังวิเคราะห์คำตอบ..."
                                                        : `กำลังประมวลผล (${loadingSeconds}s)...`}
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
                                    เคสนี้ถูกปิดแล้ว
                                </div>
                                <button
                                    onClick={handleNewChat}
                                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-brand-400 rounded-xl hover:bg-brand-500 transition-colors cursor-pointer shadow-sm shadow-brand-200"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                                        <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
                                    </svg>
                                    เริ่มแชทใหม่
                                </button>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>
                </div>
            </div>

            {/* ── Human Takeover Banner ─────────────────────────── */}
            {sessionStatus === "human_takeover" && (
                <div className="bg-blue-50 border-t border-blue-200 px-4 py-2.5 text-center">
                    <span className="text-xs font-medium text-blue-700">
                        เจ้าหน้าที่กำลังดูแลคุณอยู่ — สามารถพิมพ์ข้อความเพิ่มเติมได้
                    </span>
                </div>
            )}

            {/* ── Input Area (yellow border per Figma) ─────────────── */}
            {sessionStatus !== "resolved" && (
                <div className="bg-white/80 backdrop-blur-xl border-t border-steel-100">
                    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
                        {/* Request Human button — only when session has messages & still active & not requesting */}
                        {messages.length > 0 && sessionStatus === "active" && !isLoading && !handoffRequesting && (
                            <div className="flex justify-center mb-3">
                                <button
                                    onClick={handleRequestHuman}
                                    disabled={handoffRequesting}
                                    className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full hover:bg-amber-100 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <span>🙋</span>
                                    {handoffRequesting ? "กำลังเรียกเจ้าหน้าที่..." : "ขอพูดคุยกับเจ้าหน้าที่"}
                                </button>
                            </div>
                        )}

                        <div className="flex items-end gap-3 bg-white rounded-2xl border-2 border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 transition-all duration-200 px-4 py-2.5 shadow-sm">
                            <textarea
                                ref={inputRef}
                                value={input}
                                onChange={handleInputChange}
                                onKeyDown={handleKeyDown}
                                placeholder={sessionStatus === "human_takeover" ? "พิมพ์ข้อความถึงเจ้าหน้าที่..." : "How can I help today?..."}
                                disabled={(isLoading && sessionStatus !== "human_takeover") || !selectedBotId || !sessionId}
                                rows={1}
                                className="flex-1 bg-transparent text-sm text-steel-800 placeholder:text-steel-400 resize-none outline-none max-h-[150px] py-1 leading-relaxed disabled:opacity-50"
                            />
                            <button
                                onClick={handleSend}
                                disabled={(isLoading && sessionStatus !== "human_takeover") || !input.trim() || !selectedBotId || !sessionId}
                                className="w-9 h-9 bg-brand-400 text-steel-900 rounded-xl flex items-center justify-center hover:bg-brand-500 disabled:bg-steel-200 disabled:text-steel-400 transition-all duration-200 cursor-pointer disabled:cursor-not-allowed shrink-0"
                            >
                                <SendIcon />
                            </button>
                        </div>
                        <p className="text-center text-[11px] text-steel-400 mt-2.5">
                            SUNDAE ตอบจากเอกสารที่อัปโหลดในระบบเท่านั้น · Powered by RAG + Qwen
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
