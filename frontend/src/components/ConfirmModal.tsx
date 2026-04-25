import { useEffect, useRef } from "react";

interface ConfirmModalProps {
    open: boolean;
    title: string;
    message: string;
    note?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
    variant?: "warning" | "danger" | "info";
}

const variantStyles = {
    warning: {
        icon: "⚠",
        iconBg: "bg-amber-100 text-amber-600",
    },
    danger: {
        icon: "✗",
        iconBg: "bg-red-100 text-red-600",
    },
    info: {
        icon: "ℹ",
        iconBg: "bg-brand-100 text-brand-600",
    },
};

export default function ConfirmModal({
    open,
    title,
    message,
    note,
    confirmLabel = "OK",
    cancelLabel = "Cancel",
    onConfirm,
    onCancel,
    variant = "warning",
}: ConfirmModalProps) {
    const confirmRef = useRef<HTMLButtonElement>(null);
    const style = variantStyles[variant];

    useEffect(() => {
        if (open) confirmRef.current?.focus();
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onCancel();
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [open, onCancel]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0" onClick={onCancel} />
            <div className="relative bg-white rounded-2xl shadow-xl border border-steel-100 max-w-md w-full mx-4 overflow-hidden">
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg ${style.iconBg}`}>
                            {style.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-lg font-semibold text-steel-800 mb-2">{title}</h3>
                            <p className="text-sm text-steel-600 leading-relaxed">{message}</p>
                            {note && (
                                <div className="mt-3 p-3 bg-brand-50 border border-brand-200 rounded-xl">
                                    <p className="text-xs text-brand-700 leading-relaxed">{note}</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-steel-100">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-medium text-steel-600 bg-white border border-steel-200 rounded-xl hover:bg-steel-50 transition-colors"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        ref={confirmRef}
                        onClick={onConfirm}
                        className="px-4 py-2 text-sm font-medium rounded-xl transition-colors bg-brand-500 hover:bg-brand-600 text-white"
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
