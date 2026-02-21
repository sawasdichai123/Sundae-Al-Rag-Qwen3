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

interface Message {
    id: string;
    session_id: string;
    organization_id: string;
    role: string;
    content: string;
    metadata: Record<string, unknown> | null;
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

// ── Helpers ──────────────────────────────────────────────────────

function platformIcon(source: string): string {
    switch (source) {
        case "line": return "📱";
        case "web": return "💬";
        default: return "🔌";
    }
}

function statusConfig(status: string) {
    switch (status) {
        case "active":
            return { label: "Active", className: "bg-emerald-50 text-emerald-600", dot: "bg-emerald-500" };
        case "human_takeover":
            return { label: "รับเรื่อง", className: "bg-amber-50 text-amber-600", dot: "bg-amber-500" };
        case "resolved":
            return { label: "ปิดแล้ว", className: "bg-steel-100 text-steel-500", dot: "bg-steel-400" };
        default:
            return { label: status, className: "bg-steel-100 text-steel-500", dot: "bg-steel-400" };
    }
}

function timeAgo(dateStr: string | null): string {
    if (!dateStr) return "—";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "เมื่อสักครู่";
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
}

// ── Component ───────────────────────────────────────────────────

export default function InboxPage() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [selectedSession, setSelectedSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [replyText, setReplyText] = useState("");
    const [sendingReply, setSendingReply] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const replyInputRef = useRef<HTMLTextAreaElement>(null);

    const user = useAuthStore((s) => s.user);
    const orgId = (user?.organization_id ?? import.meta.env.VITE_DEFAULT_ORG_ID) as string;

    // ── Load sessions ───────────────────────────────────────────
    const loadSessions = useCallback(async () => {
        if (!orgId) { setLoading(false); return; }
        setLoading(true);
        try {
            const res = await inboxApi.listSessions(orgId);
            setSessions(res.data);
        } catch (err) {
            console.error("[Inbox] Failed to load sessions:", err);
        } finally {
            setLoading(false);
        }
    }, [orgId]);

    useEffect(() => {
        loadSessions();
    }, [loadSessions]);

    // ── Load messages for selected session ──────────────────────
    const loadMessages = useCallback(async (session: Session) => {
        if (!orgId) return;
        setLoadingMessages(true);
        try {
            const res = await inboxApi.getMessages(session.id, orgId);
            setMessages(res.data);
        } catch (err) {
            console.error("[Inbox] Failed to load messages:", err);
        } finally {
            setLoadingMessages(false);
        }
    }, [orgId]);

    const selectSession = (session: Session) => {
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
            setSelectedSession({ ...selectedSession, status: newStatus });
            // Refresh session list
            await loadSessions();
        } catch (err) {
            console.error("[Inbox] Status update failed:", err);
        }
    };

    // ── Auto-refresh messages every 5s when a session is selected ──
    useEffect(() => {
        if (!selectedSession || !orgId) return;
        const interval = setInterval(async () => {
            try {
                const res = await inboxApi.getMessages(selectedSession.id, orgId);
                setMessages(res.data);
            } catch (err) {
                console.error("[Inbox] Auto-refresh failed:", err);
            }
        }, 5000);
        return () => clearInterval(interval);
    }, [selectedSession, orgId]);

    // ── Send admin reply ─────────────────────────────────────────
    const handleSendReply = async () => {
        const text = replyText.trim();
        if (!text || !selectedSession || !orgId || sendingReply) return;
        setSendingReply(true);
        try {
            const res = await inboxApi.sendMessage(selectedSession.id, orgId, text);
            setMessages((prev) => [...prev, res.data]);
            setReplyText("");
            if (replyInputRef.current) replyInputRef.current.style.height = "auto";
            // Update session status locally if it changed
            if (selectedSession.status === "active") {
                setSelectedSession({ ...selectedSession, status: "human_takeover" });
            }
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
    const filtered = sessions.filter((s) =>
        (s.user_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.platform_source.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="flex h-[calc(100vh-8rem)] bg-white rounded-2xl border border-steel-100 overflow-hidden animate-fade-in">
            {/* ── Left Panel: Session List ────────────────── */}
            <div className="w-80 border-r border-steel-100 flex flex-col shrink-0">
                <div className="p-4 border-b border-steel-100">
                    <h2 className="text-sm font-bold text-steel-800 mb-3">Inbox</h2>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400">
                            <SearchIcon />
                        </span>
                        <input
                            type="text"
                            placeholder="ค้นหาเซสชัน..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 bg-steel-50 border border-steel-200 rounded-xl text-xs placeholder:text-steel-400 focus:outline-none focus:border-brand-400 transition-all"
                        />
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
                            {searchQuery ? "ไม่พบเซสชัน" : "ยังไม่มีแชท"}
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
                                            <span className="text-base">{platformIcon(session.platform_source)}</span>
                                            <span className="text-xs font-medium text-steel-800 truncate max-w-[140px]">
                                                {session.user_name || "Anonymous"}
                                            </span>
                                        </div>
                                        <span className="text-[10px] text-steel-400">
                                            {timeAgo(session.last_message_at)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${sc.className}`}>
                                            <span className={`w-1 h-1 rounded-full ${sc.dot}`} />
                                            {sc.label}
                                        </span>
                                        <span className="text-[10px] text-steel-400 capitalize">{session.platform_source}</span>
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>
            </div>

            {/* ── Right Panel: Chat View ──────────────────── */}
            <div className="flex-1 flex flex-col min-w-0">
                {!selectedSession ? (
                    <div className="flex items-center justify-center h-full text-steel-400">
                        <div className="text-center">
                            <div className="text-4xl mb-3">💬</div>
                            <p className="text-sm">เลือกเซสชันจากด้านซ้ายเพื่อดูข้อความ</p>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className="px-6 py-3.5 border-b border-steel-100 flex items-center justify-between bg-white">
                            <div className="flex items-center gap-3">
                                <span className="text-xl">{platformIcon(selectedSession.platform_source)}</span>
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
                                    {statusConfig(selectedSession.status).label}
                                </span>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-center gap-2">
                                {selectedSession.status === "active" && (
                                    <button
                                        onClick={() => handleStatusChange("human_takeover")}
                                        className="px-3 py-1.5 bg-amber-50 text-amber-700 text-xs font-medium rounded-lg hover:bg-amber-100 transition-colors cursor-pointer"
                                    >
                                        🙋 รับเรื่อง
                                    </button>
                                )}
                                {selectedSession.status === "human_takeover" && (
                                    <button
                                        onClick={() => handleStatusChange("active")}
                                        className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
                                    >
                                        🤖 คืนร่างให้ AI
                                    </button>
                                )}
                                {selectedSession.status !== "resolved" && (
                                    <button
                                        onClick={() => handleStatusChange("resolved")}
                                        className="px-3 py-1.5 bg-steel-100 text-steel-600 text-xs font-medium rounded-lg hover:bg-steel-200 transition-colors cursor-pointer"
                                    >
                                        ✓ ปิดเคส
                                    </button>
                                )}
                                {selectedSession.status === "resolved" && (
                                    <button
                                        onClick={() => handleStatusChange("active")}
                                        className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
                                    >
                                        🔄 เปิดใหม่
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
                                <div className="text-center py-12 text-xs text-steel-400">ไม่มีข้อความ</div>
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

                                        const isUser = msg.role === "user";
                                        const isAdmin = msg.role === "admin";

                                        return (
                                        <div
                                            key={msg.id}
                                            className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                                        >
                                            {msg.role === "assistant" && (
                                                <div className="w-7 h-7 rounded-lg bg-brand-400 flex items-center justify-center text-steel-900 text-[10px] font-bold shrink-0 mr-2 mt-0.5">
                                                    S
                                                </div>
                                            )}
                                            {isAdmin && (
                                                <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0 mr-2 mt-0.5">
                                                    A
                                                </div>
                                            )}
                                            <div
                                                className={`max-w-[70%] px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${isUser
                                                        ? "bg-steel-800 text-white rounded-2xl rounded-br-md"
                                                        : isAdmin
                                                            ? "bg-blue-50 text-steel-800 rounded-2xl rounded-bl-md border border-blue-200"
                                                            : "bg-steel-50 text-steel-800 rounded-2xl rounded-bl-md border border-steel-200"
                                                    }`}
                                            >
                                                {isAdmin && (
                                                    <p className="text-[9px] font-semibold text-blue-500 mb-1">เจ้าหน้าที่</p>
                                                )}
                                                {msg.content}
                                                <p className={`text-[9px] mt-1.5 ${isUser ? "text-steel-400" : "text-steel-400"}`}>
                                                    {new Date(msg.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                                                </p>
                                            </div>
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
                                        placeholder="พิมพ์ข้อความตอบกลับ..."
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
                                    Enter เพื่อส่ง · Shift+Enter ขึ้นบรรทัดใหม่
                                </p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
