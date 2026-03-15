/**
 * ProtectedRoute — Role-aware route guard
 *
 * - Unauthenticated → redirect /login
 * - Optional role gating via `allowedRoles` prop
 * - Unapproved users still enter but see restricted UI per-page
 */

import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import type { UserRole } from "../types";

interface Props {
    allowedRoles?: UserRole[];
}

export default function ProtectedRoute({ allowedRoles }: Props) {
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const role = useAuthStore((s) => s.user?.role);

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    // If this route is role-gated, wait for the user profile to load.
    // Without this, navigating between pages can briefly evaluate role as undefined
    // and lead to inconsistent routing or blank screens until refresh.
    if (allowedRoles && !role) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center text-sm text-steel-400">
                กำลังโหลดสิทธิ์การใช้งาน...
            </div>
        );
    }

    // If roles are specified, check access
    if (allowedRoles && role && !allowedRoles.includes(role)) {
        return <Navigate to="/" replace />;
    }

    return <Outlet />;
}
