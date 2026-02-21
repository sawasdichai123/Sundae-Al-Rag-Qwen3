/**
 * AuthLayout — White / Yellow / Gray Theme
 */

import { Outlet } from "react-router-dom";

export default function AuthLayout() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-steel-900 via-steel-800 to-steel-700 flex items-center justify-center p-4">
            {/* Decorative elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-brand-400/8 rounded-full blur-3xl"></div>
                <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-steel-500/10 rounded-full blur-3xl"></div>
            </div>

            <div className="w-full max-w-sm relative">
                <div className="bg-white rounded-3xl shadow-2xl shadow-black/20 p-8">
                    <Outlet />
                </div>
                <p className="text-center text-[11px] text-steel-400 mt-4">
                    © 2025 SUNDAE · Enterprise AI Platform
                </p>
            </div>
        </div>
    );
}
