/**
 * SUNDAE Frontend — Organization Store (Zustand)
 *
 * Manages multi-org state:
 *   - List of user's organizations (via org_members)
 *   - Active organization selection (persisted to localStorage)
 *   - Org role for the active org
 */

import { create } from "zustand";
import type { OrgRole, OrgMembership } from "../types";

const ACTIVE_ORG_KEY = "sundae_active_org_id";

interface OrgState {
    orgs: OrgMembership[];
    activeOrgId: string | null;
    activeOrgRole: OrgRole | null;
    isLoading: boolean;

    fetchOrgs: () => Promise<void>;
    setActiveOrg: (id: string) => void;
    clearOrgs: () => void;
}

export const useOrgStore = create<OrgState>((set, get) => ({
    orgs: [],
    activeOrgId: localStorage.getItem(ACTIVE_ORG_KEY),
    activeOrgRole: null,
    isLoading: false,

    fetchOrgs: async () => {
        set({ isLoading: true });
        try {
            // Lazy import to avoid circular dependency
            const { orgApi } = await import("../api/endpoints");
            const res = await orgApi.list();
            const orgs: OrgMembership[] = res.data;

            const currentActiveId = get().activeOrgId;
            let activeId = currentActiveId;
            let activeRole: OrgRole | null = null;

            // Validate that the stored activeOrgId is still valid
            if (activeId) {
                const match = orgs.find((o) => o.id === activeId);
                if (match) {
                    activeRole = match.org_role;
                } else {
                    activeId = null; // stored org no longer valid
                }
            }

            // Default to first org if none selected
            if (!activeId && orgs.length > 0) {
                activeId = orgs[0].id;
                activeRole = orgs[0].org_role;
            }

            if (activeId) {
                localStorage.setItem(ACTIVE_ORG_KEY, activeId);
            } else {
                localStorage.removeItem(ACTIVE_ORG_KEY);
            }

            set({ orgs, activeOrgId: activeId, activeOrgRole: activeRole, isLoading: false });
        } catch (err) {
            console.error("[OrgStore] Failed to fetch orgs:", err);
            set({ isLoading: false });
        }
    },

    setActiveOrg: (id: string) => {
        const orgs = get().orgs;
        const match = orgs.find((o) => o.id === id);
        if (match) {
            localStorage.setItem(ACTIVE_ORG_KEY, id);
            set({ activeOrgId: id, activeOrgRole: match.org_role });
        }
    },

    clearOrgs: () => {
        localStorage.removeItem(ACTIVE_ORG_KEY);
        set({ orgs: [], activeOrgId: null, activeOrgRole: null });
    },
}));

// ── Selectors ──────────────────────────────────────────────────

export const selectActiveOrgId = (state: OrgState): string | null =>
    state.activeOrgId;

export const selectActiveOrgRole = (state: OrgState): OrgRole | null =>
    state.activeOrgRole;

export const selectIsOrgOwner = (state: OrgState): boolean =>
    state.activeOrgRole === "owner";

export const selectHasOrgs = (state: OrgState): boolean =>
    state.orgs.length > 0;
