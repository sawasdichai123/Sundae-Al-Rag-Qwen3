/**
 * DocumentViewer — Fullscreen PDF Preview Modal
 *
 * Opens an iframe-based PDF viewer using a signed URL from Supabase Storage.
 * Supports jumping to a specific page via the #page=N fragment.
 */

import { useState, useEffect } from "react";
import { documentsApi } from "../api/endpoints";
import { useT } from "../i18n";

interface Props {
    documentId: string;
    organizationId: string;
    page?: number | null;
    filename?: string;
    /** Show download & open-in-new-tab buttons (org admin only) */
    showActions?: boolean;
    onClose: () => void;
}

export default function DocumentViewer({ documentId, organizationId, page, filename: propFilename, showActions = false, onClose }: Props) {
    const t = useT();
    const [url, setUrl] = useState<string | null>(null);
    const [filename, setFilename] = useState(propFilename || "document.pdf");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [iframeLoaded, setIframeLoaded] = useState(false);
    const [downloading, setDownloading] = useState(false);

    const handleDownload = async () => {
        if (!url || downloading) return;
        setDownloading(true);
        try {
            // Strip #page=N fragment for download
            const downloadUrl = url.split("#")[0];
            const response = await fetch(downloadUrl);
            if (!response.ok) throw new Error("Download failed");
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(blobUrl);
        } catch (err) {
            console.error("[DocumentViewer] Download failed:", err);
        } finally {
            setDownloading(false);
        }
    };

    useEffect(() => {
        let cancelled = false;

        const loadUrl = async () => {
            try {
                const res = await documentsApi.getPreviewUrl(documentId, organizationId);
                if (cancelled) return;

                let signedUrl = res.data.url;

                // Build the URL fragment:
                // - For non-admin: hide Chrome PDF toolbar (download/print)
                // - For page jump: append page=N
                const fragments: string[] = [];
                if (!showActions) fragments.push("toolbar=0");
                if (page && page > 1) fragments.push(`page=${page}`);
                if (fragments.length > 0) {
                    signedUrl += `#${fragments.join("&")}`;
                }

                setUrl(signedUrl);
                if (res.data.filename) setFilename(res.data.filename);
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
    }, [documentId, organizationId, page, showActions, t]);

    // Close on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    // Lock body scroll
    useEffect(() => {
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = ""; };
    }, []);

    // Derive file extension for icon badge
    const ext = filename.split(".").pop()?.toUpperCase() || "PDF";

    return (
        /* ── Backdrop ── */
        <div
            className="fixed inset-0 z-50 flex items-center justify-center animate-backdrop-in"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            style={{
                backgroundColor: "rgba(0, 0, 0, 0.65)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
            }}
        >
            {/* ── Modal Container ── */}
            <div
                className="flex flex-col overflow-hidden animate-modal-in"
                style={{
                    width: "80vw",
                    height: "85vh",
                    maxWidth: "1200px",
                    maxHeight: "90vh",
                    borderRadius: "20px",
                    boxShadow:
                        "0 0 0 1px rgba(255,255,255,0.07), " +
                        "0 8px 24px rgba(0,0,0,0.3), " +
                        "0 32px 80px rgba(0,0,0,0.5)",
                    resize: "none",
                    background: "#1e1f22",
                }}
            >
                {/* ── Brand Accent Line (top edge) ── */}
                <div style={{
                    height: "3px",
                    background: "linear-gradient(90deg, #ffd100 0%, #e6bc00 50%, #ffd100 100%)",
                    borderRadius: "20px 20px 0 0",
                    flexShrink: 0,
                }} />

                {/* ── Header Bar ── */}
                <div
                    className="flex items-center justify-between shrink-0"
                    style={{
                        padding: "14px 20px",
                        background: "linear-gradient(180deg, #2c2d30 0%, #242527 100%)",
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                    }}
                >
                    {/* Left: file icon + file name */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                        {/* PDF icon badge */}
                        <div
                            className="shrink-0 flex items-center justify-center"
                            style={{
                                width: "40px",
                                height: "40px",
                                borderRadius: "12px",
                                background: "linear-gradient(135deg, rgba(239,68,68,0.2) 0%, rgba(239,68,68,0.1) 100%)",
                                border: "1px solid rgba(239,68,68,0.15)",
                            }}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4.5 h-4.5 text-red-400" style={{ width: "18px", height: "18px" }}>
                                <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 0 0 3 3.5v13A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.378 2H4.5Zm2.25 8.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm0 3a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2.5">
                                <p
                                    className="text-[14px] font-semibold text-white truncate"
                                    title={filename}
                                    style={{ maxWidth: "400px" }}
                                >
                                    {filename}
                                </p>
                                <span
                                    className="shrink-0 text-[10px] font-bold uppercase tracking-wider"
                                    style={{
                                        background: "rgba(239, 68, 68, 0.18)",
                                        color: "#f87171",
                                        padding: "3px 8px",
                                        borderRadius: "5px",
                                        lineHeight: "1.3",
                                        letterSpacing: "0.05em",
                                    }}
                                >
                                    {ext}
                                </span>
                            </div>
                            {page && page > 1 && (
                                <p className="text-[11px] mt-0.5" style={{ color: "#7e7f82" }}>
                                    {t("chat.page")} {page}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Right: action buttons */}
                    <div className="flex items-center gap-1 shrink-0 ml-4">
                        {/* Download — only for org admin */}
                        {showActions && url && (
                            <button
                                onClick={handleDownload}
                                disabled={downloading}
                                className="flex items-center gap-2 text-xs font-medium transition-all cursor-pointer disabled:opacity-50"
                                style={{
                                    color: "#a9aaad",
                                    backgroundColor: "rgba(255,255,255,0.04)",
                                    border: "1px solid rgba(255,255,255,0.08)",
                                    padding: "7px 14px",
                                    borderRadius: "10px",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)";
                                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
                                    e.currentTarget.style.color = "#ffffff";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
                                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                                    e.currentTarget.style.color = "#a9aaad";
                                }}
                                title={t("kb.download")}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" style={{ width: "14px", height: "14px" }}>
                                    <path d="M8.75 2.75a.75.75 0 0 0-1.5 0v5.69L5.03 6.22a.75.75 0 0 0-1.06 1.06l3.5 3.5a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0-1.06-1.06L8.75 8.44V2.75Z" />
                                    <path d="M3.5 9.75a.75.75 0 0 0-1.5 0v1.5A2.75 2.75 0 0 0 4.75 14h6.5A2.75 2.75 0 0 0 14 11.25v-1.5a.75.75 0 0 0-1.5 0v1.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-1.5Z" />
                                </svg>
                                {downloading ? t("common.loading") : t("kb.download")}
                            </button>
                        )}

                        {/* Open in new tab — only for org admin */}
                        {showActions && url && (
                            <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 text-xs font-medium transition-all"
                                style={{
                                    color: "#a9aaad",
                                    backgroundColor: "rgba(255,255,255,0.04)",
                                    border: "1px solid rgba(255,255,255,0.08)",
                                    padding: "7px 14px",
                                    borderRadius: "10px",
                                    textDecoration: "none",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)";
                                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
                                    e.currentTarget.style.color = "#ffffff";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
                                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                                    e.currentTarget.style.color = "#a9aaad";
                                }}
                                title={t("kb.openNewTab")}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" style={{ width: "14px", height: "14px" }}>
                                    <path d="M6.22 8.72a.75.75 0 0 0 1.06 1.06l5.22-5.22v1.69a.75.75 0 0 0 1.5 0v-3.5a.75.75 0 0 0-.75-.75h-3.5a.75.75 0 0 0 0 1.5h1.69L6.22 8.72Z" />
                                    <path d="M3.5 6.75c0-.69.56-1.25 1.25-1.25H7A.75.75 0 0 0 7 4H4.75A2.75 2.75 0 0 0 2 6.75v4.5A2.75 2.75 0 0 0 4.75 14h4.5A2.75 2.75 0 0 0 12 11.25V9a.75.75 0 0 0-1.5 0v2.25c0 .69-.56 1.25-1.25 1.25h-4.5c-.69 0-1.25-.56-1.25-1.25v-4.5Z" />
                                </svg>
                                {t("kb.openNewTab")}
                            </a>
                        )}

                        {/* Spacer between actions and close */}
                        {showActions && (
                            <div style={{ width: "8px" }} />
                        )}

                        {/* Close button */}
                        <button
                            onClick={onClose}
                            className="transition-all cursor-pointer"
                            style={{
                                width: "36px",
                                height: "36px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                borderRadius: "10px",
                                color: "#6a6b6e",
                                backgroundColor: "rgba(255,255,255,0.04)",
                                border: "1px solid rgba(255,255,255,0.06)",
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.15)";
                                e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.25)";
                                e.currentTarget.style.color = "#f87171";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
                                e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                                e.currentTarget.style.color = "#6a6b6e";
                            }}
                            title={`${t("common.close")} (Esc)`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style={{ width: "18px", height: "18px" }}>
                                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* ── PDF Content ── */}
                <div className="flex-1 relative" style={{ background: "#1a1b1d" }}>
                    {/* Loading spinner */}
                    {(loading || (url && !iframeLoaded && !error)) && (
                        <div
                            className="absolute inset-0 flex items-center justify-center z-10"
                            style={{ background: "#1a1b1d" }}
                        >
                            <div className="flex flex-col items-center gap-4">
                                <div style={{
                                    width: "56px",
                                    height: "56px",
                                    borderRadius: "16px",
                                    background: "rgba(255, 209, 0, 0.08)",
                                    border: "1px solid rgba(255, 209, 0, 0.12)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                }}>
                                    <svg className="w-7 h-7 animate-spin text-brand-400" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                </div>
                                <div className="text-center">
                                    <p className="text-sm font-medium" style={{ color: "#d1d1d4" }}>
                                        {t("common.loading")}
                                    </p>
                                    <p className="text-[11px] mt-1" style={{ color: "#6a6b6e" }}>
                                        {filename}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Error state */}
                    {error && (
                        <div
                            className="absolute inset-0 flex items-center justify-center"
                            style={{ background: "#1a1b1d" }}
                        >
                            <div className="text-center px-6 max-w-sm">
                                <div
                                    className="mx-auto mb-5 flex items-center justify-center"
                                    style={{
                                        width: "64px",
                                        height: "64px",
                                        borderRadius: "18px",
                                        background: "rgba(239, 68, 68, 0.08)",
                                        border: "1px solid rgba(239, 68, 68, 0.12)",
                                    }}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8 text-red-400">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                                    </svg>
                                </div>
                                <p className="text-sm text-red-400 font-semibold mb-1.5">{error}</p>
                                <p className="text-xs mb-6" style={{ color: "#6a6b6e" }}>{t("kb.noPreview")}</p>
                                <button
                                    onClick={onClose}
                                    className="text-sm font-medium transition-all cursor-pointer"
                                    style={{
                                        color: "#d1d1d4",
                                        background: "rgba(255,255,255,0.06)",
                                        border: "1px solid rgba(255,255,255,0.1)",
                                        padding: "10px 24px",
                                        borderRadius: "12px",
                                    }}
                                >
                                    {t("common.close")}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* PDF iframe */}
                    {url && !error && (
                        <iframe
                            src={url}
                            title={filename}
                            onLoad={() => setIframeLoaded(true)}
                            style={{
                                width: "100%",
                                height: "100%",
                                border: "none",
                                borderWidth: 0,
                                outline: "none",
                                display: "block",
                                background: "#242527",
                                resize: "none",
                                borderBottomLeftRadius: "20px",
                                borderBottomRightRadius: "20px",
                            }}
                        />
                    )}
                </div>

                {/* ── Bottom Bar (keyboard shortcut hint) ── */}
                <div
                    className="shrink-0 flex items-center justify-center"
                    style={{
                        padding: "8px 20px",
                        background: "#1a1b1d",
                        borderTop: "1px solid rgba(255,255,255,0.04)",
                        borderRadius: "0 0 20px 20px",
                    }}
                >
                    <span className="text-[11px]" style={{ color: "#545659" }}>
                        <kbd style={{
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: "4px",
                            padding: "1px 6px",
                            fontSize: "10px",
                            fontFamily: "inherit",
                            marginRight: "4px",
                        }}>
                            Esc
                        </kbd>
                        {t("common.close")}
                    </span>
                </div>
            </div>
        </div>
    );
}
