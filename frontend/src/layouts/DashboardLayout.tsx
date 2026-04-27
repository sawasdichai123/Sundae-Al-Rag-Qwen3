/**
 * DashboardLayout — Role-aware layout with NT CI Palette
 *
 * - Navigation items filtered by role
 * - Support sees "Approvals" instead of KB/Bots
 * - ⚠️ STRICT: Unapproved users see EMPTY sidebar + lockout screen
 *   (all child routes are blocked at layout level)
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useOrgStore, selectIsOrgAdmin, selectHasOrgs } from "../store/orgStore";
import { adminApi, inboxApi } from "../api/endpoints";
import OrgSwitcher from "../components/OrgSwitcher";
import LanguageToggle from "../components/LanguageToggle";
import { useT } from "../i18n";

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
            <path d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.667l3-3Z" />
            <path d="M11.603 7.963a.75.75 0 0 0-.977 1.138 2.5 2.5 0 0 1 .142 3.667l-3 3a2.5 2.5 0 0 1-3.536-3.536l1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a4 4 0 1 0 5.656 5.656l3-3a4 4 0 0 0-.225-5.865Z" />
        </svg>
    );
}

function WebChatIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902 1.168.188 2.352.327 3.55.414.28.02.521.18.642.413l1.713 3.293a.75.75 0 0 0 1.33 0l1.713-3.293a.783.783 0 0 1 .642-.413 41.102 41.102 0 0 0 3.55-.414c1.437-.231 2.43-1.49 2.43-2.902V5.426c0-1.413-.993-2.67-2.43-2.902A41.289 41.289 0 0 0 10 2ZM6.75 6a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5ZM6 9.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 6 9.25Z" clipRule="evenodd" />
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

function OrgSettingsIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path d="M11 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM2.046 15.253c-.058.468.172.92.57 1.175A9.953 9.953 0 0 0 8 18c1.982 0 3.83-.578 5.384-1.573.398-.254.628-.707.57-1.175a6.001 6.001 0 0 0-11.908 0ZM15.75 8.5a.75.75 0 0 0-1.5 0v2h-2a.75.75 0 0 0 0 1.5h2v2a.75.75 0 0 0 1.5 0v-2h2a.75.75 0 0 0 0-1.5h-2v-2Z" />
        </svg>
    );
}

function ProfileIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-5.5-2.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM10 12a5.99 5.99 0 0 0-4.793 2.39A6.483 6.483 0 0 0 10 16.5a6.483 6.483 0 0 0 4.793-2.11A5.99 5.99 0 0 0 10 12Z" clipRule="evenodd" />
        </svg>
    );
}

function DangerZoneIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-red-500">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
        </svg>
    );
}

interface NavItem {
    to: string;
    labelKey: string;
    icon: React.FC;
    end?: boolean;
    /** Platform roles that can see this item */
    visibleTo: ("user" | "support" | "admin")[];
    /** If true, requires Org Admin role */
    requireOrgAdmin?: boolean;
}

// Pages platform staff (admin/support) can access when viewing an external org
// (an org that is not their home org_id). All other pages are blocked for B2B privacy.
// /organization is allowed so platform staff can invite initial members to newly created orgs.
const STAFF_EXTERNAL_ORG_ALLOWED = ["/danger-zone", "/organization"];

const allNavItems: NavItem[] = [
    { to: "/", labelKey: "nav.dashboard", icon: DashboardIcon, end: true, visibleTo: ["admin", "support", "user"], requireOrgAdmin: true },
    { to: "/knowledge-base", labelKey: "nav.knowledgeBase", icon: KnowledgeIcon, visibleTo: ["admin", "user"], requireOrgAdmin: true },
    { to: "/bots", labelKey: "nav.bots", icon: BotsIcon, visibleTo: ["admin", "user"], requireOrgAdmin: true },
    { to: "/inbox", labelKey: "nav.inbox", icon: InboxIcon, visibleTo: ["admin", "user"], requireOrgAdmin: true },
    { to: "/integration", labelKey: "nav.integration", icon: IntegrationIcon, visibleTo: ["admin", "user"], requireOrgAdmin: true },
    { to: "/organization", labelKey: "nav.organization", icon: OrgSettingsIcon, visibleTo: ["admin", "support", "user"], requireOrgAdmin: true },
    { to: "/approvals", labelKey: "nav.approvals", icon: ApprovalIcon, visibleTo: ["support", "admin"] },
    { to: "/chat", labelKey: "nav.webChat", icon: WebChatIcon, visibleTo: ["user", "support", "admin"] },
    { to: "/profile", labelKey: "nav.profile", icon: ProfileIcon, visibleTo: ["user", "support", "admin"] },
    { to: "/danger-zone", labelKey: "nav.dangerZone", icon: DangerZoneIcon, visibleTo: ["user", "support", "admin"], requireOrgAdmin: true },
];

const routeLabelKeys: Record<string, string> = {
    "/": "nav.dashboard",
    "/knowledge-base": "nav.knowledgeBase",
    "/bots": "nav.bots",
    "/inbox": "nav.inbox",
    "/integration": "nav.integration",
    "/organization": "nav.organization",
    "/create-org": "nav.createOrg",
    "/approvals": "nav.approvals",
    "/chat": "nav.webChat",
    "/profile": "nav.profile",
    "/danger-zone": "nav.dangerZone",
};

// ── Component ───────────────────────────────────────────────────

export default function DashboardLayout() {
    const [collapsed, setCollapsed] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    const user = useAuthStore((s) => s.user);
    const signOut = useAuthStore((s) => s.signOut);
    const t = useT();

    const role = user?.role ?? "user";
    const isOrgAdmin = useOrgStore(selectIsOrgAdmin);
    const hasOrgs = useOrgStore(selectHasOrgs);
    const orgsFetched = useOrgStore((s) => s.hasFetched);
    const fetchFailed = useOrgStore((s) => s.fetchFailed);
    const activeOrgId = useOrgStore((s) => s.activeOrgId);
    const _activeOrgLogo = useOrgStore((s) => s.orgs.find((o) => o.id === s.activeOrgId)?.logo_url);
    void _activeOrgLogo;

    // Badge counts
    const [pendingCount, setPendingCount] = useState(0);
    const [takeoverCount, setTakeoverCount] = useState(0);
    const [approvalCount, setApprovalCount] = useState(0);
    const badgeInterval = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchBadgeCounts = useCallback(async () => {
        const promises: Promise<unknown>[] = [];

        // Org-level badges (Org Admin only)
        if (activeOrgId && isOrgAdmin) {
            promises.push(
                adminApi.orgPendingCount(activeOrgId).then((r) => setPendingCount(r.data.count)).catch(() => {}),
                inboxApi.takeoverCount(activeOrgId).then((r) => setTakeoverCount(r.data.count)).catch(() => {}),
            );
        }

        // Platform-level badge (support/admin only)
        if (role === "admin" || role === "support") {
            promises.push(
                adminApi.listPending().then((r) => setApprovalCount(r.data.length)).catch(() => {}),
            );
        }

        await Promise.allSettled(promises);
    }, [activeOrgId, isOrgAdmin, role]);

    useEffect(() => {
        fetchBadgeCounts();
        if (badgeInterval.current) clearInterval(badgeInterval.current);
        badgeInterval.current = setInterval(fetchBadgeCounts, 10_000);
        const onFocus = () => fetchBadgeCounts();
        document.addEventListener("visibilitychange", () => { if (!document.hidden) onFocus(); });
        return () => {
            if (badgeInterval.current) clearInterval(badgeInterval.current);
            document.removeEventListener("visibilitychange", onFocus);
        };
    }, [fetchBadgeCounts]);

    useEffect(() => { fetchBadgeCounts(); }, [location.pathname, fetchBadgeCounts]);

    const badgeCounts: Record<string, number> = {
        "/organization": pendingCount,
        "/inbox": takeoverCount,
        "/approvals": approvalCount,
    };

    // ⚠️ STRICT approval check — only flag as unapproved when user profile
    // is loaded (user !== null) AND role is "user" AND not approved.
    // This prevents showing lockout before profile finishes loading.
    const isUnapproved = !!user && role === "user" && !user.is_approved;

    const currentLabel = t(routeLabelKeys[location.pathname] || "nav.dashboard");

    // B2B privacy: admin/support viewing external org → limited nav
    // Home org: prefer user.organization_id (legacy), fall back to first org where user is admin
    const orgs = useOrgStore((s) => s.orgs);
    const homeOrgId =
        user?.organization_id ||
        orgs.find((o) => o.org_role === "admin")?.id ||
        null;
    const isViewingExternalOrg = !!homeOrgId && !!activeOrgId && activeOrgId !== homeOrgId;
    const isStaffOnExternalOrg = (role === "admin" || role === "support") && isViewingExternalOrg;

    // B2B privacy: redirect admin/support away from private org data on external orgs
    useEffect(() => {
        if (isStaffOnExternalOrg && !STAFF_EXTERNAL_ORG_ALLOWED.includes(location.pathname)) {
            navigate("/danger-zone", { replace: true });
        }
    }, [isStaffOnExternalOrg, location.pathname, navigate]);

    // Auto-redirect: approved user with no orgs → create org page
    // Wait for orgStore to finish initial fetch before deciding (prevents false redirect)
    // Do NOT redirect if fetchOrgs failed — orgs may exist but the API call errored
    // Applies to ALL roles (user, support, admin) — not just support/admin
    useEffect(() => {
        if (!orgsFetched || fetchFailed) return;
        if (user && user.is_approved && !hasOrgs && location.pathname !== "/create-org") {
            navigate("/create-org", { replace: true });
        }
    }, [user, hasOrgs, orgsFetched, fetchFailed, location.pathname, navigate]);

    // Unapproved users see NO navigation links at all
    const visibleNav = isUnapproved
        ? []
        : allNavItems.filter((item) => {
            // Check platform role
            if (!item.visibleTo.includes(role)) return false;
            // B2B privacy: staff on external org sees only Danger Zone + Organization
            if (isStaffOnExternalOrg && !STAFF_EXTERNAL_ORG_ALLOWED.includes(item.to)) return false;
            // Check Org Admin requirement
            if (item.requireOrgAdmin && !isOrgAdmin && role !== "admin" && role !== "support") return false;
            return true;
        });

    const handleLogout = () => {
        // signOut clears local state synchronously, then fires Supabase API in background.
        // Navigate immediately — ProtectedRoute will also redirect via isAuthenticated: false.
        signOut();
        navigate("/login");
    };

    // Role badge — show org role for regular users
    const roleBadge = role === "admin"
        ? { label: t("role.admin"), color: "bg-brand-400 text-steel-900" }
        : role === "support"
            ? { label: t("role.support"), color: "bg-violet-100 text-violet-700" }
            : isOrgAdmin
                ? { label: t("role.adminOrg"), color: "bg-brand-100 text-brand-700" }
                : { label: t("role.member"), color: "bg-steel-100 text-steel-600" };

    return (
        <div className="flex h-screen bg-steel-50">
            {/* ── Sidebar ──────────────────────────────────────────── */}
            <aside className={`${collapsed ? "w-[72px]" : "w-64"} bg-steel-900 flex flex-col transition-all duration-300 ease-in-out`}>
                {/* Brand */}
                <div className="h-16 flex items-center px-5 border-b border-white/[0.08]">
                    <div className="w-8 h-8 rounded-lg bg-brand-400 flex items-center justify-center text-steel-900 text-sm font-bold shrink-0 overflow-hidden shadow-sm">
                        <img src="/sundae-logo.png" alt="Sundae Logo" className="w-full h-full object-contain" />
                    </div>
                    {!collapsed && (
                        <div className="ml-3 animate-fade-in">
                            <p className="text-sm font-semibold text-white tracking-wide">SUNDAE</p>
                            <p className="text-[10px] text-steel-400 -mt-0.5">Enterprise AI</p>
                        </div>
                    )}
                </div>

                {/* Org Switcher */}
                {!isUnapproved && hasOrgs && (
                    <OrgSwitcher collapsed={collapsed} />
                )}

                {/* Navigation — EMPTY for unapproved users */}
                <nav className="flex-1 px-3 py-4 space-y-1">
                    {isUnapproved && !collapsed && (
                        <div className="px-3 py-8 text-center">
                            <svg className="w-7 h-7 mx-auto mb-2 text-steel-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                            <p className="text-xs text-steel-500 leading-relaxed">
                                {t("layout.pendingApprovalSidebar")}
                            </p>
                        </div>
                    )}
                    {visibleNav.map((item) => {
                        const Icon = item.icon;
                        const count = badgeCounts[item.to] || 0;
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
                                <span className="shrink-0 relative">
                                    <Icon />
                                    {collapsed && count > 0 && (
                                        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
                                            {count > 99 ? "99+" : count}
                                        </span>
                                    )}
                                </span>
                                {!collapsed && (
                                    <>
                                        <span className="truncate flex-1">{t(item.labelKey)}</span>
                                        {count > 0 && (
                                            <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                                                {count > 99 ? "99+" : count}
                                            </span>
                                        )}
                                    </>
                                )}
                            </NavLink>
                        );
                    })}
                </nav>

                {/* Collapse */}
                <button onClick={() => setCollapsed(!collapsed)}
                    className="mx-3 mb-2 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-steel-400 hover:bg-white/[0.06] hover:text-white transition-colors cursor-pointer text-xs">
                    <CollapseIcon isCollapsed={collapsed} />
                    {!collapsed && <span>{t("layout.collapse")}</span>}
                </button>

                {/* User Card */}
                <div className="px-3 pb-4 border-t border-white/[0.08] pt-3">
                    <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
                        {user?.avatar_url ? (
                            <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                            <div className="w-8 h-8 rounded-full bg-brand-400 flex items-center justify-center text-steel-900 text-xs font-bold shrink-0">
                                {(user?.first_name || user?.email)?.[0]?.toUpperCase() || "?"}
                            </div>
                        )}
                        {!collapsed && (
                            <div className="flex-1 min-w-0 animate-fade-in">
                                <div className="flex items-center gap-2">
                                    <p className="text-xs font-medium text-white truncate">{user?.first_name ? `${user.first_name}${user.last_name ? ` ${user.last_name}` : ""}` : user?.email?.split("@")[0] || "—"}</p>
                                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0 ${roleBadge.color}`}>
                                        {roleBadge.label}
                                    </span>
                                </div>
                                <p className="text-[10px] text-steel-400 truncate">{user?.email || "—"}</p>
                            </div>
                        )}
                        {(!collapsed || isUnapproved) && (
                            <button onClick={handleLogout} className="text-steel-400 hover:text-red-400 transition-colors cursor-pointer" title={t("layout.logout")}>
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
                        <span className="font-semibold text-steel-800">{isUnapproved ? t("layout.pendingApproval") : currentLabel}</span>
                    </div>

                    <div className="flex items-center gap-3">
                        {isUnapproved && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full">
                                ⏳ {t("layout.pendingApproval")}
                            </span>
                        )}
                        <LanguageToggle />
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                            <span className="text-xs font-medium text-emerald-700">{t("layout.online")}</span>
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
// Polls every 10s to check if admin has approved the account.

function PendingApprovalLockout({ onLogout }: { onLogout: () => void }) {
    const session = useAuthStore((s) => s.session);
    const fetchProfile = useAuthStore((s) => s.fetchProfile);
    const t = useT();

    useEffect(() => {
        if (!session?.user?.id) return;
        const userId = session.user.id;

        // Poll with simple doubling backoff: 15s → 30s → 60s → cap at 60s
        let delay = 15_000;
        let timeoutId: ReturnType<typeof setTimeout>;

        const poll = () => {
            if (document.hidden) {
                // reschedule without fetching when tab is hidden
                timeoutId = setTimeout(poll, delay);
                return;
            }
            fetchProfile(userId);
            delay = Math.min(delay * 2, 60_000);
            timeoutId = setTimeout(poll, delay);
        };

        timeoutId = setTimeout(poll, delay);

        // Also refetch immediately on tab focus
        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                fetchProfile(userId);
            }
        };
        document.addEventListener("visibilitychange", handleVisibility);

        return () => {
            clearTimeout(timeoutId);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [session?.user?.id, fetchProfile]);

    return (
        <div className="flex items-center justify-center min-h-[60vh] animate-fade-in">
            <div className="text-center max-w-md">
                <div className="w-20 h-20 rounded-2xl bg-brand-100 flex items-center justify-center text-4xl mx-auto mb-6">
                    ⏳
                </div>
                <h2 className="text-xl font-bold text-steel-900 mb-2">
                    {t("layout.pendingTitle")}
                </h2>
                <p className="text-sm text-steel-500 leading-relaxed mb-6 whitespace-pre-line">
                    {t("layout.pendingDesc")}
                </p>
                <div className="p-4 bg-steel-50 rounded-2xl border border-steel-200 mb-6">
                    <p className="text-xs text-steel-500 mb-3 font-medium">{t("layout.pendingWhat")}</p>
                    <div className="space-y-2 text-left">
                        <div className="flex items-center gap-2 text-sm text-steel-400">
                            <span>✗</span><span>{t("layout.pendingUpload")}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-steel-400">
                            <span>✗</span><span>{t("layout.pendingBots")}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-steel-400">
                            <span>✗</span><span>{t("layout.pendingInbox")}</span>
                        </div>
                    </div>
                </div>
                <button
                    onClick={onLogout}
                    className="px-6 py-2.5 bg-steel-200 text-steel-700 rounded-xl text-sm font-medium hover:bg-steel-300 transition-colors cursor-pointer"
                >
                    {t("layout.pendingLogout")}
                </button>
            </div>
        </div>
    );
}
