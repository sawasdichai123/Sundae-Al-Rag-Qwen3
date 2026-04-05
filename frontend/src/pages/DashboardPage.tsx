/**
 * DashboardPage — Role-aware with real-time data from API / Supabase
 *
 * - Approved users/admins: see full metrics (live)
 * - Unapproved users:      see "Pending Approval" lockout
 * - Support:               see pending user count instead of chat-today
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore, selectIsSupport } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";
import { documentsApi, botsApi, inboxApi } from "../api/endpoints";
import apiClient from "../api/axios";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useT } from "../i18n";

// ── Types ────────────────────────────────────────────────────────

interface HealthServices {
    backend: boolean;
    ollama: boolean;
    supabase: boolean;
}

// ── Pending Approval Component ──────────────────────────────────

function PendingApprovalState() {
    const t = useT();
    return (
        <div className="flex items-center justify-center min-h-[60vh] animate-fade-in">
            <div className="text-center max-w-md">
                <div className="w-20 h-20 rounded-2xl bg-brand-100 flex items-center justify-center text-4xl mx-auto mb-6">
                    ⏳
                </div>
                <h2 className="text-xl font-bold text-steel-900 mb-2">
                    {t("dashboard.pendingTitle")}
                </h2>
                <p className="text-sm text-steel-500 leading-relaxed mb-6" style={{ whiteSpace: "pre-line" }}>
                    {t("dashboard.pendingDesc")}
                </p>
                <div className="p-4 bg-steel-50 rounded-2xl border border-steel-200">
                    <p className="text-xs text-steel-500 mb-3 font-medium">{t("dashboard.pendingWhat")}</p>
                    <div className="space-y-2 text-left">
                        <div className="flex items-center gap-2 text-sm text-steel-600">
                            <span className="text-brand-400">✓</span>{t("dashboard.pendingDashboard")}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-steel-600">
                            <span className="text-brand-400">✓</span>{t("dashboard.pendingChat")}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-steel-400">
                            <span>✗</span>{t("dashboard.pendingUpload")}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-steel-400">
                            <span>✗</span>{t("dashboard.pendingCreateBot")}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Metric Card ─────────────────────────────────────────────────

interface MetricCardProps {
    icon: React.ReactNode;
    label: string;
    value: string;
    change: string;
    changeType: "up" | "down" | "neutral";
    accentColor: string;
    disabled?: boolean;
}

function MetricCard({ icon, label, value, change, changeType, accentColor, disabled }: MetricCardProps) {
    return (
        <div className={`bg-white rounded-2xl border border-steel-100 p-6 transition-all duration-300 group ${disabled ? "opacity-50" : "hover:shadow-lg hover:shadow-steel-200/50"
            }`}>
            <div className="flex items-start justify-between mb-4">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${accentColor} transition-transform duration-300 ${disabled ? "" : "group-hover:scale-110"}`}>
                    {icon}
                </div>
                <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${changeType === "up" ? "bg-emerald-50 text-emerald-700"
                    : changeType === "down" ? "bg-red-50 text-red-600"
                        : "bg-steel-100 text-steel-500"
                    }`}>
                    {changeType === "up" && "↑"}{changeType === "down" && "↓"} {change}
                </span>
            </div>
            <p className="text-3xl font-bold text-steel-900 tracking-tight">{value}</p>
            <p className="text-sm text-steel-500 mt-1">{label}</p>
        </div>
    );
}

// ── Server Metrics (CPU / RAM / GPU graphs) ─────────────────────

interface MetricsSnapshot {
    cpu_percent: number;
    ram_percent: number;
    ram_used_gb: number;
    ram_total_gb: number;
    disk_percent: number;
    disk_used_gb: number;
    disk_total_gb: number;
    gpu: { id: number; name: string; load_percent: number; memory_used_mb: number; memory_total_mb: number; temperature: number }[];
    net_sent_mb: number;
    net_recv_mb: number;
}

interface MetricsPoint {
    time: string;
    cpu: number;
    ram: number;
    gpu: number;
    net_in: number;
    net_out: number;
}

const MAX_POINTS = 20;

function ServerMetrics() {
    const t = useT();
    const [history, setHistory] = useState<MetricsPoint[]>([]);
    const [latest, setLatest] = useState<MetricsSnapshot | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const prevNetRef = useRef<{ sent: number; recv: number } | null>(null);

    const fetchMetrics = useCallback(async () => {
        try {
            const { data } = await apiClient.get<MetricsSnapshot>("/health/metrics");
            setLatest(data);
            const now = new Date();
            const timeLabel = `${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

            // Calculate network speed (MB/s) from cumulative delta
            let netIn = 0;
            let netOut = 0;
            if (prevNetRef.current) {
                const dt = 3; // poll interval in seconds
                netIn = Math.max(0, (data.net_recv_mb - prevNetRef.current.recv) / dt);
                netOut = Math.max(0, (data.net_sent_mb - prevNetRef.current.sent) / dt);
            }
            prevNetRef.current = { sent: data.net_sent_mb, recv: data.net_recv_mb };

            const point: MetricsPoint = {
                time: timeLabel,
                cpu: data.cpu_percent,
                ram: data.ram_percent,
                gpu: data.gpu.length > 0 ? data.gpu[0].load_percent : 0,
                net_in: Math.round(netIn * 100) / 100,
                net_out: Math.round(netOut * 100) / 100,
            };
            setHistory((prev) => [...prev.slice(-(MAX_POINTS - 1)), point]);
        } catch {
            // silently ignore — dashboard stays showing last data
        }
    }, []);

    useEffect(() => {
        fetchMetrics();
        intervalRef.current = setInterval(fetchMetrics, 3000);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [fetchMetrics]);

    if (!latest) {
        return (
            <div className="bg-white rounded-2xl border border-steel-100 p-6 mt-5">
                <h2 className="text-base font-semibold text-steel-800 mb-4">{t("dashboard.serverResources")}</h2>
                <p className="text-sm text-steel-400 animate-pulse">{t("common.loading")}</p>
            </div>
        );
    }

    const hasGpu = latest.gpu.length > 0;

    const charts: { key: string; label: string; value: string; dataKey: keyof MetricsPoint; color: string; bgColor: string }[] = [
        { key: "cpu", label: "CPU", value: `${latest.cpu_percent.toFixed(1)}%`, dataKey: "cpu", color: "#3b82f6", bgColor: "#3b82f620" },
        { key: "ram", label: "RAM", value: `${latest.ram_used_gb} / ${latest.ram_total_gb} GB (${latest.ram_percent.toFixed(1)}%)`, dataKey: "ram", color: "#8b5cf6", bgColor: "#8b5cf620" },
    ];
    if (hasGpu) {
        const g = latest.gpu[0];
        charts.push({ key: "gpu", label: `GPU — ${g.name}`, value: `${g.load_percent.toFixed(1)}% · ${g.temperature}°C`, dataKey: "gpu", color: "#f97316", bgColor: "#f9731620" });
    }

    return (
        <div className="bg-white rounded-2xl border border-steel-100 p-6 mt-5">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-steel-800">{t("dashboard.serverResources")}</h2>
                <span className="text-[10px] text-steel-400">{t("dashboard.updatingEvery3s")}</span>
            </div>
            <div className={`grid gap-5 ${hasGpu ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-1 lg:grid-cols-2"}`}>
                {charts.map((c) => (
                    <div key={c.key}>
                        <div className="flex items-baseline justify-between mb-2">
                            <p className="text-sm font-medium text-steel-700">{c.label}</p>
                            <p className="text-xs font-semibold text-steel-500">{c.value}</p>
                        </div>
                        <div className="h-32">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={history} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                                    <defs>
                                        <linearGradient id={`grad-${c.key}`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor={c.color} stopOpacity={0.3} />
                                            <stop offset="100%" stopColor={c.color} stopOpacity={0.02} />
                                        </linearGradient>
                                    </defs>
                                    <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#94a3b8" />
                                    <Tooltip
                                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                                        formatter={(val: unknown) => [`${Number(val).toFixed(1)}%`, c.label]}
                                    />
                                    <Area type="monotone" dataKey={c.dataKey} stroke={c.color} fill={`url(#grad-${c.key})`} strokeWidth={2} dot={false} isAnimationActive={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                ))}
            </div>
            {/* VRAM bar (only if GPU exists) */}
            {hasGpu && (() => {
                const g = latest.gpu[0];
                const vramPercent = g.memory_total_mb > 0 ? (g.memory_used_mb / g.memory_total_mb) * 100 : 0;
                return (
                    <div className="mt-4 pt-4 border-t border-steel-100">
                        <div className="flex items-center justify-between mb-1">
                            <p className="text-sm font-medium text-steel-700">VRAM</p>
                            <p className="text-xs font-semibold text-steel-500">{g.memory_used_mb} / {g.memory_total_mb} MB ({vramPercent.toFixed(1)}%)</p>
                        </div>
                        <div className="w-full h-2 bg-steel-100 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-500 ${vramPercent > 90 ? "bg-red-500" : vramPercent > 70 ? "bg-amber-500" : "bg-orange-400"}`}
                                style={{ width: `${vramPercent}%` }}
                            />
                        </div>
                    </div>
                );
            })()}

            {/* Disk usage bar */}
            <div className={`mt-4 pt-4 border-t border-steel-100`}>
                <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-steel-700">Disk</p>
                    <p className="text-xs font-semibold text-steel-500">{latest.disk_used_gb} / {latest.disk_total_gb} GB ({latest.disk_percent.toFixed(1)}%)</p>
                </div>
                <div className="w-full h-2 bg-steel-100 rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-500 ${latest.disk_percent > 90 ? "bg-red-500" : latest.disk_percent > 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                        style={{ width: `${latest.disk_percent}%` }}
                    />
                </div>
            </div>

            {/* Network I/O chart */}
            <div className="mt-4 pt-4 border-t border-steel-100">
                <div className="flex items-baseline justify-between mb-2">
                    <p className="text-sm font-medium text-steel-700">Network I/O</p>
                    <p className="text-xs font-semibold text-steel-500">
                        {history.length > 0 ? `↓ ${history[history.length - 1].net_in.toFixed(2)} MB/s  ↑ ${history[history.length - 1].net_out.toFixed(2)} MB/s` : "..."}
                    </p>
                </div>
                <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={history} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                            <defs>
                                <linearGradient id="grad-net-in" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                                </linearGradient>
                                <linearGradient id="grad-net-out" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
                                </linearGradient>
                            </defs>
                            <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                            <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
                            <Tooltip
                                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                                formatter={(val: unknown, name: unknown) => [`${Number(val).toFixed(2)} MB/s`, String(name) === "net_in" ? "Download" : "Upload"]}
                            />
                            <Area type="monotone" dataKey="net_in" stroke="#10b981" fill="url(#grad-net-in)" strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Area type="monotone" dataKey="net_out" stroke="#ef4444" fill="url(#grad-net-out)" strokeWidth={2} dot={false} isAnimationActive={false} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}

// ── Page ────────────────────────────────────────────────────────

export default function DashboardPage() {
    const t = useT();
    const user = useAuthStore((s) => s.user);
    const isSupport = useAuthStore(selectIsSupport);
    const navigate = useNavigate();

    const [docCount, setDocCount] = useState<number | null>(null);
    const [botCount, setBotCount] = useState<number | null>(null);
    const [sessionTodayCount, setSessionTodayCount] = useState<number | null>(null);
    const [takeoverCount, setTakeoverCount] = useState<number | null>(null);
    const [services, setServices] = useState<HealthServices | null>(null);
    const activeOrgId = useOrgStore((s) => s.activeOrgId);
    const activeOrg = useOrgStore((s) => {
        const id = s.activeOrgId;
        return s.orgs.find((o) => o.id === id);
    });

    useEffect(() => {
        const orgId = (activeOrgId ?? user?.organization_id ?? import.meta.env.VITE_DEFAULT_ORG_ID) as string;

        apiClient
            .get<{ services: HealthServices }>("/health")
            .then((res) => setServices((res.data as any).services as HealthServices))
            .catch(() => setServices({ backend: true, ollama: false, supabase: false }));

        if (!orgId) return;

        Promise.allSettled([
            documentsApi.list(orgId),
            botsApi.list(orgId),
            inboxApi.listSessions(orgId),
        ]).then(([docsRes, botsRes, sessionsRes]) => {
            if (docsRes.status === "fulfilled") {
                setDocCount((docsRes.value.data as any[]).length);
            }

            if (botsRes.status === "fulfilled") {
                const activeBots = (botsRes.value.data as any[]).filter((b: any) => b.is_active);
                setBotCount(activeBots.length);
            }

            if (sessionsRes.status === "fulfilled") {
                const raw = sessionsRes.value.data as any;
                const allSessions: any[] = raw?.sessions ?? (Array.isArray(raw) ? raw : []);
                const today = new Date().toDateString();
                setSessionTodayCount(
                    allSessions.filter((s: any) => {
                        try { return new Date(s.started_at).toDateString() === today; }
                        catch { return false; }
                    }).length
                );
                setTakeoverCount(
                    allSessions.filter((s: any) => s.status === "human_takeover").length
                );
            }
        });
    }, [activeOrgId, user?.organization_id]);

    // Format a nullable count for display
    const fmt = (val: number | null) =>
        val === null ? "..." : val.toLocaleString("th-TH");

    // Unapproved user → lockout
    if (user?.role === "user" && !user.is_approved) {
        return <PendingApprovalState />;
    }

    return (
        <div className="animate-fade-in">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-steel-900 tracking-tight">
                    {activeOrg ? activeOrg.name : "Dashboard"}
                </h1>
                <p className="text-sm text-steel-500 mt-1">
                    {t("dashboard.overview")}
                </p>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
                {/* 1 — Total Documents */}
                <MetricCard
                    icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-brand-600"><path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h6.879a1.5 1.5 0 0 1 1.06.44l4.122 4.12A1.5 1.5 0 0 1 17 7.622V16.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16.5v-13Z" /></svg>}
                    label={t("dashboard.totalDocs")}
                    value={fmt(docCount)}
                    change="live"
                    changeType="neutral"
                    accentColor="bg-brand-100"
                />

                {/* 2 — Active Bots */}
                <MetricCard
                    icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-steel-600"><path d="M4.632 3.533A2 2 0 0 1 6.577 2h6.846a2 2 0 0 1 1.945 1.533l1.976 8.234A3.489 3.489 0 0 0 16 11.5H4c-.476 0-.93.095-1.344.267l1.976-8.234Z" /><path fillRule="evenodd" d="M4 13a2 2 0 1 0 0 4h12a2 2 0 1 0 0-4H4Zm11.24 2a.75.75 0 0 1 .75-.75H16a.75.75 0 0 1 0 1.5h-.01a.75.75 0 0 1-.75-.75Zm-2.5 0a.75.75 0 0 1 .75-.75H13.5a.75.75 0 0 1 0 1.5h-.01a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" /></svg>}
                    label={t("dashboard.activeBots")}
                    value={fmt(botCount)}
                    change="live"
                    changeType="neutral"
                    accentColor="bg-steel-100"
                />

                {/* 3 — Chats Today */}
                <MetricCard
                    icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-violet-600"><path fillRule="evenodd" d="M3.43 2.524A41.29 41.29 0 0 1 10 2c2.236 0 4.43.18 6.57.524 1.437.231 2.43 1.49 2.43 2.902v5.148c0 1.413-.993 2.67-2.43 2.902a41.202 41.202 0 0 1-5.183.501.78.78 0 0 0-.528.224l-3.579 3.58A.75.75 0 0 1 6 17.25v-3.443a41.033 41.033 0 0 1-2.57-.33C2.993 13.244 2 11.986 2 10.573V5.426c0-1.413.993-2.67 2.43-2.902Z" clipRule="evenodd" /></svg>}
                    label={t("dashboard.chatsToday")}
                    value={fmt(sessionTodayCount)}
                    change="live"
                    changeType="neutral"
                    accentColor="bg-violet-50"
                />

                {/* 4 — Human-Takeover Sessions (chats waiting for agent) */}
                <MetricCard
                    icon={<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-orange-600"><path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" /></svg>}
                    label={t("dashboard.chatsWaiting")}
                    value={fmt(takeoverCount)}
                    change="live"
                    changeType="neutral"
                    accentColor="bg-orange-50"
                />

            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                {[
                    { label: t("dashboard.manageKnowledge"), desc: t("dashboard.manageKnowledgeDesc"), icon: "KB", to: "/knowledge-base", color: "hover:border-brand-300" },
                    { label: t("dashboard.manageBots"), desc: t("dashboard.manageBotsDesc"), icon: "Bot", to: "/bots", color: "hover:border-violet-300" },
                    { label: t("dashboard.viewInbox"), desc: t("dashboard.viewInboxDesc"), icon: "Inbox", to: "/inbox", color: "hover:border-emerald-300" },
                ].map((action) => (
                    <button
                        key={action.to}
                        onClick={() => navigate(action.to)}
                        className={`bg-white rounded-2xl border border-steel-100 p-5 text-left cursor-pointer transition-all duration-200 hover:shadow-md ${action.color}`}
                    >
                        <span className="text-xs font-bold px-2 py-1 rounded-lg bg-steel-100 text-steel-600 mb-3 inline-block">{action.icon}</span>
                        <p className="text-sm font-semibold text-steel-900">{action.label}</p>
                        <p className="text-xs text-steel-500 mt-0.5">{action.desc}</p>
                    </button>
                ))}
            </div>

            {/* System Status */}
            <div className="bg-white rounded-2xl border border-steel-100 p-6">
                <h2 className="text-base font-semibold text-steel-800 mb-4">{t("dashboard.systemStatus")}</h2>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                    {[
                        { name: "RAG Pipeline", ok: services?.backend ?? null },
                        { name: "Ollama", ok: services?.ollama ?? null },
                        { name: "Embedding", ok: services?.backend ?? null },
                        { name: "Supabase DB", ok: services?.supabase ?? null },
                        { name: "LINE Webhook", ok: null as boolean | null },
                    ].map((svc) => (
                        <div key={svc.name} className="flex items-center gap-2 text-sm">
                            <span className={`w-2 h-2 rounded-full ${svc.ok === null
                                ? "bg-steel-300 animate-pulse"
                                : svc.ok
                                    ? "bg-emerald-500"
                                    : "bg-red-500"
                                }`}
                            />
                            <span className="text-steel-600">{svc.name}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Server Resource Monitoring */}
            <ServerMetrics />

        </div>
    );
}
