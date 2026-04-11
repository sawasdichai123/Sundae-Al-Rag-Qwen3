/**
 * DocumentViewer — Fullscreen PDF Preview Modal
 *
 * Opens an iframe-based PDF viewer using a signed URL from Supabase Storage.
 * Supports jumping to a specific page via the #page=N fragment.
 *
 * Props:
 *   documentId      – UUID of the document to preview
 *   organizationId  – UUID of the tenant organization
 *   page            – (optional) initial page to jump to
 *   onClose         – callback to close the modal
 */

import { useState, useEffect } from "react";
import { documentsApi } from "../api/endpoints";
import { useT } from "../i18n";

interface Props {
    documentId: string;
    organizationId: string;
    page?: number | null;
    onClose: () => void;
}

export default function DocumentViewer({ documentId, organizationId, page, onClose }: Props) {
    const t = useT();
    const [url, setUrl] = useState<string | null>(null);
    const [filename, setFilename] = useState("document.pdf");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const loadUrl = async () => {
            try {
                const res = await documentsApi.getPreviewUrl(documentId, organizationId);
                if (cancelled) return;

                let signedUrl = res.data.url;
                // Jump to specific page if provided
                if (page && page > 1) {
                    signedUrl += `#page=${page}`;
                }

                setUrl(signedUrl);
                setFilename(res.data.filename);
            } catch (err) {
                if (cancelled) return;
                console.error("[DocumentViewer] Failed to load preview URL:", err);
                setError(t("kb.previewFailed"));
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadUrl();
        return () => { cancelled = true; };
    }, [documentId, organizationId, page, t]);

    // Close on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-white rounded-2xl shadow-2xl w-[95vw] h-[90vh] max-w-6xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-steel-100 bg-steel-50/50">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base">📄</span>
                        <span className="text-sm font-bold text-steel-800 truncate">{filename}</span>
                        {page && page > 1 && (
                            <span className="text-xs text-steel-400 shrink-0">
                                — {t("chat.page")} {page}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {/* Open in new tab */}
                        {url && (
                            <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 text-steel-400 hover:text-steel-700 transition-colors"
                                title={t("kb.openNewTab")}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                                    <path d="M6.22 8.72a.75.75 0 0 0 1.06 1.06l5.22-5.22v1.69a.75.75 0 0 0 1.5 0v-3.5a.75.75 0 0 0-.75-.75h-3.5a.75.75 0 0 0 0 1.5h1.69L6.22 8.72Z" />
                                    <path d="M3.5 6.75c0-.69.56-1.25 1.25-1.25H7A.75.75 0 0 0 7 4H4.75A2.75 2.75 0 0 0 2 6.75v4.5A2.75 2.75 0 0 0 4.75 14h4.5A2.75 2.75 0 0 0 12 11.25V9a.75.75 0 0 0-1.5 0v2.25c0 .69-.56 1.25-1.25 1.25h-4.5c-.69 0-1.25-.56-1.25-1.25v-4.5Z" />
                                </svg>
                            </a>
                        )}
                        {/* Close */}
                        <button
                            onClick={onClose}
                            className="p-2 text-steel-400 hover:text-steel-700 transition-colors cursor-pointer"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 relative">
                    {loading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white">
                            <div className="flex items-center gap-3 text-steel-400">
                                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                <span className="text-sm">{t("common.loading")}</span>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white">
                            <div className="text-center">
                                <p className="text-sm text-red-500 font-medium">{error}</p>
                                <button
                                    onClick={onClose}
                                    className="mt-3 text-xs text-steel-500 hover:text-steel-700 cursor-pointer"
                                >
                                    {t("common.close")}
                                </button>
                            </div>
                        </div>
                    )}

                    {url && !error && (
                        <iframe
                            src={url}
                            className="w-full h-full border-none"
                            title={filename}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
