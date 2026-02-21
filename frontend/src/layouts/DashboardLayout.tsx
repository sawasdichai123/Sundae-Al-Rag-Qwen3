/**
 * DashboardLayout — Role-aware layout with NT CI Palette
 *
 * - Navigation items filtered by role
 * - Support sees "Approvals" instead of KB/Bots
 * - ⚠️ STRICT: Unapproved users see EMPTY sidebar + lockout screen
 *   (all child routes are blocked at layout level)
 */

import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

// ── SVG Icons ───────────────────────────────────────────────────

function DashboardIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path d="M10.707 2.293a1 1 0 0 0-1.414 0l-7 7a1 1 0 0 0 1.414 1.414L4 10.414V17a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-6.586l.293.293a1 1 0 0 0 1.414-1.414l-7-7Z" />
        </svg>
    );
}

function KnowledgeIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path d="M10.75 16.82A7.462 7.462 0 0 1 15 15.5c.71 0 1.396.098 2.046.282A.75.75 0 0 0 18 15.06v-11a.75.75 0 0 0-.546-.721A9.006 9.006 0 0 0 15 3a8.963 8.963 0 0 0-4.25 1.065V16.82ZM9.25 4.065A8.963 8.963 0 0 0 5 3c-.85 0-1.673.118-2.454.339A.75.75 0 0 0 2 4.06v11a.75.75 0 0 0 .954.721A7.462 7.462 0 0 1 5 15.5c1.579 0 3.042.487 4.25 1.32V4.065Z" />
        </svg>
    );
}

function BotsIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path d="M4.632 3.533A2 2 0 0 1 6.577 2h6.846a2 2 0 0 1 1.945 1.533l1.976 8.234A3.489 3.489 0 0 0 16 11.5H4c-.476 0-.93.095-1.344.267l1.976-8.234Z" />
            <path fillRule="evenodd" d="M4 13a2 2 0 1 0 0 4h12a2 2 0 1 0 0-4H4Zm11.24 2a.75.75 0 0 1 .75-.75H16a.75.75 0 0 1 0 1.5h-.01a.75.75 0 0 1-.75-.75Zm-2.5 0a.75.75 0 0 1 .75-.75H13.5a.75.75 0 0 1 0 1.5h-.01a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
        </svg>
    );
}

function InboxIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M3.43 2.524A41.29 41.29 0 0 1 10 2c2.236 0 4.43.18 6.57.524 1.437.231 2.43 1.49 2.43 2.902v5.148c0 1.413-.993 2.67-2.43 2.902a41.202 41.202 0 0 1-5.183.501.78.78 0 0 0-.528.224l-3.579 3.58A.75.75 0 0 1 6 17.25v-3.443a41.033 41.033 0 0 1-2.57-.33C2.993 13.244 2 11.986 2 10.573V5.426c0-1.413.993-2.67 2.43-2.902Z" clipRule="evenodd" />
        </svg>
    );
}

function ApprovalIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.23 1.23 0 0 0 .41 1.412A9.957 9.957 0 0 0 10 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 0 0-13.074.003Z" />
        </svg>
    );
}

function IntegrationIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M4.606 12.97a.75.75 0 0 1-.134 1.051 2.494 2.494 0 0 0-.93 2.437 2.494 2.494 0 0 0 2.437-.93.75.75 0 1 1 1.186.918 3.995 3.995 0 0 1-4.482 1.332.75.75 0 0 1-.461-.461 3.994 3.994 0 0 1 1.332-4.482.75.75 0 0 1 1.052.134Z" clipRule="evenodd" />
            <path fillRule="evenodd" d="M13.703 4.469a3.25 3.25 0 0 1 2.828 2.828c.137.09.265.193.382.308l.964.964a3.25 3.25 0 0 1 0 4.596l-4.243 4.243a3.25 3.25 0 0 1-4.596 0l-.964-.964a3.25 3.25 0 0 1-.308-.382 3.25 3.25 0 0 1-2.828-2.828 3.248 3.248 0 0 1-.382-.308l-.964-.964a3.25 3.25 0 0 1 0-4.596L8.12 3.123a3.25 3.25 0 0 1 4.596 0l.964.964c.115.115.218.243.308.382h-.285ZM14.5 6.25a1.75 1.75 0 0 0-2.474 0L7.783 10.5l1.717 1.717 4.243-4.243a1.75 1.75 0 0 0 0-2.474l-.964-.964a1.75 1.75 0 0 1-.279-.286Z" clipRule="evenodd" />
        </svg>
    );
}

function WebChatIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.94 6.94a.75.75 0 1 1-1.061-1.061 3 3 0 1 1 2.871 5.026v.345a.75.75 0 0 1-1.5 0v-.916c0-.414.336-.75.75-.75a1.5 1.5 0 0 0 .94-2.644Zm-.25 5.81a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" clipRule="evenodd" />
        </svg>
    );
}

function CollapseIcon({ isCollapsed }: { isCollapsed: boolean }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
            className={`w-4 h-4 transition-transform duration-300 ${isCollapsed ? "rotate-180" : ""}`}>
            <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
        </svg>
    );
}

function LogoutIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z" clipRule="evenodd" />
            <path fillRule="evenodd" d="M19 10a.75.75 0 0 0-.75-.75H8.704l1.048-.943a.75.75 0 1 0-1.004-1.114l-2.5 2.25a.75.75 0 0 0 0 1.114l2.5 2.25a.75.75 0 1 0 1.004-1.114l-1.048-.943h9.546A.75.75 0 0 0 19 10Z" clipRule="evenodd" />
        </svg>
    );
}

// ── Nav Config ──────────────────────────────────────────────────

interface NavItem {
    to: string;
    label: string;
    icon: React.FC;
    end?: boolean;
    visibleTo: ("user" | "support" | "admin")[];
}

const allNavItems: NavItem[] = [
    { to: "/", label: "Dashboard", icon: DashboardIcon, end: true, visibleTo: ["user", "support", "admin"] },
    { to: "/knowledge-base", label: "Knowledge Base", icon: KnowledgeIcon, visibleTo: ["user", "admin"] },
    { to: "/bots", label: "Bots", icon: BotsIcon, visibleTo: ["user", "admin"] },
    { to: "/inbox", label: "Inbox", icon: InboxIcon, visibleTo: ["user", "admin"] },
    { to: "/integration", label: "Integration", icon: IntegrationIcon, visibleTo: ["user", "admin"] },
    { to: "/approvals", label: "Approvals", icon: ApprovalIcon, visibleTo: ["support", "admin"] },
    { to: "/chat", label: "Web Chat", icon: WebChatIcon, visibleTo: ["user", "support", "admin"] },
];

const routeLabels: Record<string, string> = {
    "/": "Dashboard",
    "/knowledge-base": "Knowledge Base",
    "/bots": "Bots",
    "/inbox": "Inbox",
    "/integration": "Integration",
    "/approvals": "Approvals",
    "/chat": "Web Chat",
};

// ── Component ───────────────────────────────────────────────────

export default function DashboardLayout() {
    const [collapsed, setCollapsed] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    const user = useAuthStore((s) => s.user);
    const signOut = useAuthStore((s) => s.signOut);

    const role = user?.role ?? "user";

    // ⚠️ STRICT approval check — only flag as unapproved when user profile
    // is loaded (user !== null) AND role is "user" AND not approved.
    // This prevents showing lockout before profile finishes loading.
    const isUnapproved = !!user && role === "user" && !user.is_approved;

    const currentLabel = routeLabels[location.pathname] || "Dashboard";

    // Unapproved users see NO navigation links at all
    const visibleNav = isUnapproved
        ? []
        : allNavItems.filter((item) => item.visibleTo.includes(role));

    const handleLogout = () => {
        // signOut clears local state synchronously, then fires Supabase API in background.
        // Navigate immediately — ProtectedRoute will also redirect via isAuthenticated: false.
        signOut();
        navigate("/login");
    };

    // Role badge
    const roleBadge = {
        admin: { label: "Admin", color: "bg-brand-400 text-steel-900" },
        support: { label: "Support", color: "bg-violet-100 text-violet-700" },
        user: { label: "User", color: "bg-steel-100 text-steel-600" },
    }[role];

    return (
        <div className="flex h-screen bg-steel-50">
            {/* ── Sidebar ──────────────────────────────────────────── */}
            <aside className={`${collapsed ? "w-[72px]" : "w-64"} bg-steel-900 flex flex-col transition-all duration-300 ease-in-out`}>
                {/* Brand */}
                <div className="h-16 flex items-center px-5 border-b border-white/[0.08]">
                    <div className="w-8 h-8 rounded-lg bg-brand-400 flex items-center justify-center text-steel-900 text-sm font-bold shrink-0">S</div>
                    {!collapsed && (
                        <div className="ml-3 animate-fade-in">
                            <p className="text-sm font-semibold text-white tracking-wide">SUNDAE</p>
                            <p className="text-[10px] text-steel-400 -mt-0.5">Enterprise AI</p>
                        </div>
                    )}
                </div>

                {/* Navigation — EMPTY for unapproved users */}
                <nav className="flex-1 px-3 py-4 space-y-1">
                    {isUnapproved && !collapsed && (
                        <div className="px-3 py-8 text-center">
                            <div className="text-2xl mb-2">⏳</div>
                            <p className="text-xs text-steel-500 leading-relaxed">
                                บัญชีรออนุมัติ
                            </p>
                        </div>
                    )}
                    {visibleNav.map((item) => {
                        const Icon = item.icon;
                        return (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                end={item.end}
                                className={({ isActive }) =>
                                    `group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${isActive ? "bg-brand-400/20 text-brand-400" : "text-steel-300 hover:bg-white/[0.06] hover:text-white"
                                    } ${collapsed ? "justify-center" : ""}`
                                }
                            >
                                <span className="shrink-0"><Icon /></span>
                                {!collapsed && <span className="truncate">{item.label}</span>}
                            </NavLink>
                        );
                    })}
                </nav>

                {/* Collapse */}
                <button onClick={() => setCollapsed(!collapsed)}
                    className="mx-3 mb-2 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-steel-400 hover:bg-white/[0.06] hover:text-white transition-colors cursor-pointer text-xs">
                    <CollapseIcon isCollapsed={collapsed} />
                    {!collapsed && <span>Collapse</span>}
                </button>

                {/* User Card */}
                <div className="px-3 pb-4 border-t border-white/[0.08] pt-3">
                    <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
                        <div className="w-8 h-8 rounded-full bg-brand-400 flex items-center justify-center text-steel-900 text-xs font-bold shrink-0">
                            {(user?.full_name || user?.email)?.[0]?.toUpperCase() || "?"}
                        </div>
                        {!collapsed && (
                            <div className="flex-1 min-w-0 animate-fade-in">
                                <div className="flex items-center gap-2">
                                    <p className="text-xs font-medium text-white truncate">{user?.full_name || user?.email?.split("@")[0] || "—"}</p>
                                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${roleBadge.color}`}>
                                        {roleBadge.label}
                                    </span>
                                </div>
                                <p className="text-[10px] text-steel-400 truncate">{user?.email || "—"}</p>
                            </div>
                        )}
                        {(!collapsed || isUnapproved) && (
                            <button onClick={handleLogout} className="text-steel-400 hover:text-red-400 transition-colors cursor-pointer" title="Logout">
                                <LogoutIcon />
                            </button>
                        )}
                    </div>
                </div>
            </aside>

            {/* ── Main Content ─────────────────────────────────────── */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                {/* Top Navbar */}
                <header className="h-16 bg-white/80 backdrop-blur-xl border-b border-steel-100 flex items-center justify-between px-8 sticky top-0 z-10">
                    <div className="flex items-center gap-2 text-sm">
                        <span className="text-steel-400">SUNDAE</span>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-steel-300">
                            <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                        </svg>
                        <span className="font-semibold text-steel-800">{isUnapproved ? "รออนุมัติ" : currentLabel}</span>
                    </div>

                    <div className="flex items-center gap-3">
                        {isUnapproved && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full">
                                ⏳ รออนุมัติ
                            </span>
                        )}
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                            <span className="text-xs font-medium text-emerald-700">Online</span>
                        </div>
                    </div>
                </header>

                {/* ⚠️ STRICT LOCKOUT: unapproved users NEVER see child routes */}
                <main className="flex-1 overflow-y-auto p-6 lg:p-8">
                    {isUnapproved ? <PendingApprovalLockout onLogout={handleLogout} /> : <Outlet />}
                </main>
            </div>
        </div>
    );
}

// ── Lockout Screen (replaces ALL child routes for unapproved users) ─

function PendingApprovalLockout({ onLogout }: { onLogout: () => void }) {
    return (
        <div className="flex items-center justify-center min-h-[60vh] animate-fade-in">
            <div className="text-center max-w-md">
                <div className="w-20 h-20 rounded-2xl bg-brand-100 flex items-center justify-center text-4xl mx-auto mb-6">
                    ⏳
                </div>
                <h2 className="text-xl font-bold text-steel-900 mb-2">
                    บัญชีกำลังรอการอนุมัติ
                </h2>
                <p className="text-sm text-steel-500 leading-relaxed mb-6">
                    บัญชีของคุณกำลังรอการอนุมัติจากเจ้าหน้าที่ Support<br />
                    คุณจะสามารถใช้ฟีเจอร์ทั้งหมดได้หลังจากได้รับการอนุมัติ
                </p>
                <div className="p-4 bg-steel-50 rounded-2xl border border-steel-200 mb-6">
                    <p className="text-xs text-steel-500 mb-3 font-medium">สิ่งที่จะทำได้หลังอนุมัติ:</p>
                    <div className="space-y-2 text-left">
                        <div className="flex items-center gap-2 text-sm text-steel-400">
                            <span>✗</span><span>อัปโหลดเอกสาร</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-steel-400">
                            <span>✗</span><span>จัดการ Bot</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-steel-400">
                            <span>✗</span><span>ดู Inbox & Dashboard</span>
                        </div>
                    </div>
                </div>
                <button
                    onClick={onLogout}
                    className="px-6 py-2.5 bg-steel-200 text-steel-700 rounded-xl text-sm font-medium hover:bg-steel-300 transition-colors cursor-pointer"
                >
                    ออกจากระบบ
                </button>
            </div>
        </div>
    );
}
