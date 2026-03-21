/**
 * OrgSwitcher — Dropdown in sidebar for switching between organizations
 */

import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useOrgStore } from "../store/orgStore";
import { useAuthStore } from "../store/authStore";

export default function OrgSwitcher({ collapsed }: { collapsed: boolean }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    const orgs = useOrgStore((s) => s.orgs);
    const activeOrgId = useOrgStore((s) => s.activeOrgId);
    const setActiveOrg = useOrgStore((s) => s.setActiveOrg);
    const role = useAuthStore((s) => s.user?.role);

    const activeOrg = orgs.find((o) => o.id === activeOrgId);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    if (orgs.length === 0) return null;

    return (
        <div ref={ref} className="relative px-3 mb-2">
            <button
                onClick={() => setOpen(!open)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                    open ? "bg-white/10" : "hover:bg-white/[0.06]"
                } ${collapsed ? "justify-center" : ""}`}
            >
                <div className="w-6 h-6 rounded-md bg-brand-400/20 flex items-center justify-center text-brand-400 text-xs font-bold shrink-0">
                    {activeOrg?.name?.[0]?.toUpperCase() || "O"}
                </div>
                {!collapsed && (
                    <>
                        <span className="text-xs text-white truncate flex-1">
                            {activeOrg?.name || "Select Org"}
                        </span>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
                            className={`w-3.5 h-3.5 text-steel-400 transition-transform ${open ? "rotate-180" : ""}`}>
                            <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                        </svg>
                    </>
                )}
            </button>

            {open && !collapsed && (
                <div className="absolute left-3 right-3 top-full mt-1 bg-steel-800 border border-white/10 rounded-xl shadow-lg py-1 z-50 animate-fade-in max-h-64 overflow-auto">
                    {orgs.map((org) => (
                        <button
                            key={org.id}
                            onClick={() => {
                                setActiveOrg(org.id);
                                setOpen(false);
                                // Navigate to dashboard and reload to refresh all org data
                                window.location.href = "/";
                            }}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors cursor-pointer ${
                                org.id === activeOrgId
                                    ? "text-brand-400 bg-brand-400/10"
                                    : "text-steel-300 hover:bg-white/[0.06] hover:text-white"
                            }`}
                        >
                            <div className="w-5 h-5 rounded bg-white/10 flex items-center justify-center text-[10px] font-bold shrink-0">
                                {org.name?.[0]?.toUpperCase() || "O"}
                            </div>
                            <span className="truncate flex-1 text-left">{org.name}</span>
                            <span className="text-[9px] text-steel-500">{org.org_role}</span>
                        </button>
                    ))}
                    {(role === "support" || role === "admin") && (
                        <div className="border-t border-white/10 mt-1 pt-1">
                            <button
                                onClick={() => { setOpen(false); navigate("/create-org"); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-steel-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                            >
                                <span className="text-sm">+</span>
                                <span>Create Organization</span>
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
