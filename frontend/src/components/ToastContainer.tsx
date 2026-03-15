/**
 * SUNDAE Frontend — Toast Container Component
 *
 * Renders toast notifications in the bottom-right corner.
 * Auto-dismisses after 5 seconds (configurable).
 */

import { useToastStore } from "../store/toastStore";

const typeStyles: Record<string, string> = {
    success: "bg-green-50 border-green-300 text-green-800",
    error: "bg-red-50 border-red-300 text-red-800",
    warning: "bg-amber-50 border-amber-300 text-amber-800",
    info: "bg-blue-50 border-blue-300 text-blue-800",
};

const typeIcons: Record<string, string> = {
    success: "\u2713",
    error: "\u2717",
    warning: "\u26A0",
    info: "\u2139",
};

export default function ToastContainer() {
    const { toasts, removeToast } = useToastStore();

    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className={`flex items-start gap-2 px-4 py-3 rounded-lg border shadow-lg
                        animate-in slide-in-from-right ${typeStyles[toast.type] || typeStyles.info}`}
                >
                    <span className="text-lg leading-none mt-0.5">
                        {typeIcons[toast.type] || typeIcons.info}
                    </span>
                    <p className="text-sm flex-1">{toast.message}</p>
                    <button
                        onClick={() => removeToast(toast.id)}
                        className="text-current opacity-50 hover:opacity-100 text-lg leading-none"
                    >
                        &times;
                    </button>
                </div>
            ))}
        </div>
    );
}
