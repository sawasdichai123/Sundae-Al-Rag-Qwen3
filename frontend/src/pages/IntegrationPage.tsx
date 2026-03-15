/**
 * IntegrationPage — Channel Integration Management (Figma-matched)
 *
 * Displays integration cards for LINE and Website channels.
 * Each card has a toggle switch, status badge, and documentation link.
 *
 * Figma ref: Intregration.png
 */

import { useState } from "react";

// ── Icons ───────────────────────────────────────────────────────

function LineIcon() {
    return (
        <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center text-white text-lg font-bold shrink-0 shadow-sm">
            L
        </div>
    );
}

function WebIcon() {
    return (
        <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center text-white shrink-0 shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Zm8.72-2.72a.75.75 0 0 1 1.06 0l3.44 3.44a.75.75 0 1 1-1.06 1.06L14 4.94v4.31a.75.75 0 0 1-1.5 0V4.94l-2.41 2.34a.75.75 0 1 1-1.06-1.06l3.44-3.44Z" clipRule="evenodd" />
            </svg>
        </div>
    );
}

// ── Toggle Switch ───────────────────────────────────────────────

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
    return (
        <button
            onClick={onChange}
            className={`relative inline-flex items-center w-12 h-7 rounded-full transition-colors duration-200 cursor-pointer shrink-0 ${enabled ? "bg-brand-400" : "bg-steel-300"
                }`}
        >
            <span
                className={`inline-block w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200 ${enabled ? "translate-x-6" : "translate-x-1"
                    }`}
            />
        </button>
    );
}

// ── Integration Card ────────────────────────────────────────────

interface IntegrationCardProps {
    icon: React.ReactNode;
    name: string;
    description: string;
    enabled: boolean;
    onToggle: () => void;
}

function IntegrationCard({ icon, name, description, enabled, onToggle }: IntegrationCardProps) {
    return (
        <div className="bg-white rounded-2xl border border-steel-200 p-6 hover:shadow-md hover:shadow-steel-100/50 transition-all duration-200">
            <div className="flex items-start justify-between">
                <div className="flex items-start gap-4 flex-1">
                    {icon}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-base font-bold text-steel-900">{name}</h3>
                            <span className="inline-flex items-center text-[10px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                                connect
                            </span>
                        </div>
                        <p className="text-xs text-steel-500 leading-relaxed mb-4">
                            {description}
                        </p>
                        <a
                            href="#"
                            className="inline-flex items-center gap-1 text-xs text-steel-600 font-medium hover:text-brand-600 transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                                <path d="M4.5 7a.5.5 0 0 0 0 1h4.793L7.146 10.146a.5.5 0 1 0 .708.708l3-3a.5.5 0 0 0 0-.708l-3-3a.5.5 0 0 0-.708.708L9.293 7H4.5Z" />
                            </svg>
                            Documentation
                        </a>
                    </div>
                </div>
                <ToggleSwitch enabled={enabled} onChange={onToggle} />
            </div>
        </div>
    );
}

// ── Component ───────────────────────────────────────────────────

export default function IntegrationPage() {
    const [lineEnabled, setLineEnabled] = useState(false);
    const [webEnabled, setWebEnabled] = useState(true);

    return (
        <div className="animate-fade-in">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-steel-900">Integration</h1>
                <p className="text-sm text-steel-500 mt-1">
                    เชื่อมต่อช่องทางการสื่อสารเพื่อใช้งาน Bot
                </p>
            </div>

            <div className="space-y-4 max-w-2xl">
                <IntegrationCard
                    icon={<LineIcon />}
                    name="LINE"
                    description="Connect to LINE for Seamless Integration and Quick Communication"
                    enabled={lineEnabled}
                    onToggle={() => setLineEnabled(!lineEnabled)}
                />

                <IntegrationCard
                    icon={<WebIcon />}
                    name="Website"
                    description="Connect to Website for Seamless Integration and Quick Communication"
                    enabled={webEnabled}
                    onToggle={() => setWebEnabled(!webEnabled)}
                />
            </div>
        </div>
    );
}
