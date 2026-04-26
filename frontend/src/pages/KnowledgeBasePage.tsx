/**
 * KnowledgeBasePage — Document Management (Figma-matched)
 *
 * Displays knowledge collections (documents) as cards.
 * Allows uploading PDFs, viewing status, and deleting documents.
 * Supports tags for categorization and filtering.
 *
 * Figma ref: Knowledge Page.png, Knowledge Page2.png
 * API: documentsApi (endpoints.ts)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { documentsApi, botsApi } from "../api/endpoints";
import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";
import { useToastStore } from "../store/toastStore";
import type { Document, Bot } from "../types";
import { useT } from "../i18n";
import DocumentViewer from "../components/DocumentViewer";

// ── Icons ───────────────────────────────────────────────────────

function SearchIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
        </svg>
    );
}

function PlusIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.519.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 1 .7.797l-.5 6a.75.75 0 0 1-1.497-.124l.5-6a.75.75 0 0 1 .797-.672ZM12.2 7.72a.75.75 0 0 1 .797.672l.5 6a.75.75 0 1 1-1.497.124l-.5-6a.75.75 0 0 1 .7-.797ZM10 7.75a.75.75 0 0 1 .75.75v6a.75.75 0 0 1-1.5 0v-6a.75.75 0 0 1 .75-.75Z" clipRule="evenodd" />
        </svg>
    );
}

function DocumentIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 0 0 3 3.5v13A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.378 2H4.5Zm2.25 8.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm0 3a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Z" clipRule="evenodd" />
        </svg>
    );
}

function UploadCloudIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-12 h-12 text-steel-300">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
        </svg>
    );
}

function LinkIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.667l3-3Zm-6.464 11.535a2.5 2.5 0 0 1-3.536-3.535l1.225-1.224a.75.75 0 0 0-1.06-1.061L1.171 10.17a4 4 0 1 0 5.657 5.657l3-3a4 4 0 0 0-.225-5.865.75.75 0 0 0-.977 1.138 2.5 2.5 0 0 1 .142 3.667l-3 3Z" clipRule="evenodd" />
        </svg>
    );
}

function TagIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M5.5 3A2.5 2.5 0 0 0 3 5.5v2.879a2.5 2.5 0 0 0 .732 1.767l6.5 6.5a2.5 2.5 0 0 0 3.536 0l2.878-2.878a2.5 2.5 0 0 0 0-3.536l-6.5-6.5A2.5 2.5 0 0 0 8.38 3H5.5ZM6 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
        </svg>
    );
}

// ── Status Badge ────────────────────────────────────────────────

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
    const config: Record<string, { labelKey: string; className: string }> = {
        pending: { labelKey: "kb.statusPending", className: "bg-steel-100 text-steel-500" },
        processing: { labelKey: "kb.statusProcessing", className: "bg-amber-50 text-amber-600" },
        ready: { labelKey: "kb.statusReady", className: "bg-emerald-50 text-emerald-600" },
        error: { labelKey: "kb.statusError", className: "bg-red-50 text-red-600" },
    };
    const { labelKey, className } = config[status] || config.pending;
    return (
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${className}`}>
            {status === "processing" && <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />}
            {status === "ready" && <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />}
            {t(labelKey)}
        </span>
    );
}

// ── Date Format ────────────────────────────────────────────────

function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("th-TH", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    });
}

// ── Component ───────────────────────────────────────────────────

export default function KnowledgeBasePage() {
    const t = useT();
    const [documents, setDocuments] = useState<Document[]>([]);
    const [bots, setBots] = useState<Bot[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [uploading, setUploading] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [previewDocId, setPreviewDocId] = useState<string | null>(null);
    const [linkDocId, setLinkDocId] = useState<string | null>(null);
    const [linkSelection, setLinkSelection] = useState<Set<string>>(new Set());
    const [linkSaving, setLinkSaving] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Tag state
    const [allTags, setAllTags] = useState<string[]>([]);
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [editTagDocId, setEditTagDocId] = useState<string | null>(null);
    const [editTagInput, setEditTagInput] = useState("");
    const [editTags, setEditTags] = useState<string[]>([]);
    const [tagSaving, setTagSaving] = useState(false);

    const user = useAuthStore((s) => s.user);
    const toast = useToastStore((s) => s.addToast);
    const activeOrgId = useOrgStore((s) => s.activeOrgId);
    const isOrgAdmin = useOrgStore((s) => s.activeOrgRole) === "admin";
    const orgId = (activeOrgId ?? user?.organization_id ?? import.meta.env.VITE_DEFAULT_ORG_ID) as string;

    // ── Load documents ──────────────────────────────────────────
    const loadDocuments = useCallback(async () => {
        if (!orgId) { setLoading(false); return; }
        setLoading(true);
        try {
            const res = await documentsApi.list(orgId);
            setDocuments(res.data);
        } catch (err) {
            console.error("[Knowledge] Failed to load documents:", err);
        } finally {
            setLoading(false);
        }
    }, [orgId]);

    const loadBots = useCallback(async () => {
        if (!orgId) return;
        try {
            const res = await botsApi.list(orgId);
            setBots(res.data);
        } catch (err) {
            console.error("[Knowledge] Failed to load bots:", err);
        }
    }, [orgId]);

    const loadTags = useCallback(async () => {
        if (!orgId) return;
        try {
            const res = await documentsApi.listTags(orgId);
            setAllTags(res.data.tags);
        } catch (err) {
            console.error("[Knowledge] Failed to load tags:", err);
        }
    }, [orgId]);

    const openLinkModal = (doc: Document) => {
        setLinkDocId(doc.id);
        setLinkSelection(new Set(doc.bot_ids || []));
    };

    const toggleBotSelection = (botId: string) => {
        setLinkSelection((prev) => {
            const next = new Set(prev);
            if (next.has(botId)) next.delete(botId);
            else next.add(botId);
            return next;
        });
    };

    const handleSaveLinks = async () => {
        if (!linkDocId || !orgId) return;
        setLinkSaving(true);
        try {
            await documentsApi.linkBots(linkDocId, orgId, Array.from(linkSelection));
            toast("success", t("kb.linkSuccess"));
            setLinkDocId(null);
            await loadDocuments();
        } catch (err) {
            console.error("[Knowledge] Link bots failed:", err);
            toast("error", t("kb.linkFailed"));
        } finally {
            setLinkSaving(false);
        }
    };

    // ── Tag edit handlers ───────────────────────────────────────
    const openTagModal = (doc: Document) => {
        setEditTagDocId(doc.id);
        setEditTags(doc.tags || []);
        setEditTagInput("");
    };

    const handleAddTag = () => {
        const tag = editTagInput.trim();
        if (tag && !editTags.includes(tag)) {
            setEditTags((prev) => [...prev, tag]);
        }
        setEditTagInput("");
    };

    const handleRemoveTag = (tag: string) => {
        setEditTags((prev) => prev.filter((t) => t !== tag));
    };

    const handleSaveTags = async () => {
        if (!editTagDocId || !orgId) return;
        setTagSaving(true);
        try {
            await documentsApi.updateTags(editTagDocId, orgId, editTags);
            toast("success", t("kb.tagsSaved"));
            setEditTagDocId(null);
            await loadDocuments();
            await loadTags();
        } catch (err) {
            console.error("[Knowledge] Save tags failed:", err);
            toast("error", t("kb.tagsFailed"));
        } finally {
            setTagSaving(false);
        }
    };

    useEffect(() => {
        loadDocuments();
        loadBots();
        loadTags();
    }, [loadDocuments]);

    // ── Upload handler ──────────────────────────────────────────
    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !orgId) return;

        if (!file.type.includes("pdf")) {
            toast("error", t("kb.onlyPdfWarning"));
            return;
        }

        setUploading(true);
        try {
            await documentsApi.upload(file, [], orgId);
            await loadDocuments();
        } catch (err: unknown) {
            console.error("[Knowledge] Upload failed:", err);
            const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "";
            if (detail.includes("no extractable text")) {
                toast("error", t("kb.scannedPdfError"));
            } else {
                toast("error", t("kb.uploadFailed"));
            }
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    // ── Delete handler ──────────────────────────────────────────
    const handleDelete = async (docId: string) => {
        if (!orgId) return;
        try {
            await documentsApi.delete(docId, orgId);
            setDeleteConfirm(null);
            await loadDocuments();
        } catch (err) {
            console.error("[Knowledge] Delete failed:", err);
            toast("error", t("kb.deleteFailed"));
        }
    };

    // ── Drag & Drop ─────────────────────────────────────────────
    const [dragOver, setDragOver] = useState(false);

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (!file || !orgId) return;
        if (!file.type.includes("pdf")) {
            toast("warning", t("kb.onlyPdfWarning"));
            return;
        }
        setUploading(true);
        try {
            await documentsApi.upload(file, [], orgId);
            await loadDocuments();
        } catch (err: unknown) {
            console.error("[Knowledge] Drop upload failed:", err);
            const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "";
            if (detail.includes("no extractable text")) {
                toast("error", t("kb.scannedPdfError"));
            } else {
                toast("error", t("kb.uploadFailedShort"));
            }
        } finally {
            setUploading(false);
        }
    };

    // ── Filtered list ───────────────────────────────────────────
    const filtered = documents.filter((d) => {
        const matchesSearch = (d.name ?? "").toLowerCase().includes(searchQuery.toLowerCase());
        const matchesTag = !selectedTag || (d.tags ?? []).includes(selectedTag);
        return matchesSearch && matchesTag;
    });

    // ── Render ───────────────────────────────────────────────────
    return (
        <div className="animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-steel-900">{t("kb.title")}</h1>
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center gap-1.5 bg-brand-400 text-steel-900 px-5 py-2.5 rounded-full text-sm font-bold hover:bg-brand-500 transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
                >
                    <PlusIcon />
                    {uploading ? t("kb.uploading") : t("kb.addCollection")}
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={handleUpload}
                />
            </div>

            {/* PDF Only Notice */}
            <div className="flex items-center gap-2 mb-4 px-4 py-2.5 bg-brand-50 border border-brand-100 rounded-xl">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-brand-500 shrink-0">
                    <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" />
                </svg>
                <span className="text-xs text-brand-700 font-medium">{t("kb.pdfOnlyNotice")}</span>
            </div>

            {/* Search + Tag Filter */}
            <div className="flex items-center gap-3 mb-6 flex-wrap">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400">
                        <SearchIcon />
                    </span>
                    <input
                        type="text"
                        placeholder={t("kb.searchPlaceholder")}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-steel-200 rounded-xl text-sm text-steel-800 placeholder:text-steel-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all"
                    />
                </div>
                {allTags.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                            onClick={() => setSelectedTag(null)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                !selectedTag
                                    ? "bg-brand-400 text-steel-900"
                                    : "bg-steel-100 text-steel-600 hover:bg-steel-200"
                            }`}
                        >
                            {t("kb.allTags")}
                        </button>
                        {allTags.map((tag) => (
                            <button
                                key={tag}
                                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                    selectedTag === tag
                                        ? "bg-brand-400 text-steel-900"
                                        : "bg-steel-100 text-steel-600 hover:bg-steel-200"
                                }`}
                            >
                                {tag}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center py-20">
                    <div className="flex items-center gap-3 text-steel-400">
                        <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span className="text-sm">{t("common.loading")}</span>
                    </div>
                </div>
            )}

            {/* Empty State */}
            {!loading && filtered.length === 0 && (
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    className={`flex flex-col items-center justify-center py-20 border-2 border-dashed rounded-2xl transition-colors ${
                        dragOver ? "border-brand-400 bg-brand-50" : "border-steel-200 bg-white"
                    }`}
                >
                    <UploadCloudIcon />
                    <p className="text-sm text-steel-500 mt-4 mb-1 font-medium">
                        {searchQuery ? t("kb.noResults") : t("kb.empty")}
                    </p>
                    <p className="text-xs text-steel-400">
                        {searchQuery ? t("kb.tryOther") : t("kb.dragDrop")}
                    </p>
                    {!searchQuery && (
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="mt-4 text-sm text-brand-600 hover:text-brand-700 font-medium cursor-pointer"
                        >
                            {t("kb.selectFile")}
                        </button>
                    )}
                </div>
            )}

            {/* Document Cards */}
            {!loading && filtered.length > 0 && (
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    className="space-y-3"
                >
                    {filtered.map((doc) => (
                        <div
                            key={doc.id}
                            className="group bg-white rounded-2xl border border-dashed border-steel-200 hover:border-brand-400 hover:shadow-md hover:shadow-brand-100/30 transition-all duration-200 p-5"
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-3 flex-1 min-w-0">
                                    <div className="w-9 h-9 rounded-xl bg-steel-50 flex items-center justify-center text-steel-400 shrink-0 mt-0.5">
                                        <DocumentIcon />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <button
                                            onClick={() => doc.file_path ? setPreviewDocId(doc.id) : undefined}
                                            className={`text-sm font-bold truncate block max-w-full text-left ${doc.file_path ? "text-brand-700 hover:text-brand-800 hover:underline cursor-pointer" : "text-steel-900"}`}
                                            title={doc.file_path ? t("kb.preview") : undefined}
                                        >
                                            {doc.name}
                                        </button>
                                        <p className="text-xs text-steel-400 mt-1 line-clamp-2">
                                            {doc.mime_type || "PDF Document"}
                                            {doc.storage_bytes
                                                ? ` · ${(doc.storage_bytes / 1024).toFixed(0)} KB`
                                                : doc.file_size_bytes
                                                    ? ` · ${(doc.file_size_bytes / 1024).toFixed(0)} KB`
                                                    : ""}
                                            {doc.uploader_name && (
                                                <> · {t("kb.uploadedBy")} {doc.uploader_name}</>
                                            )}
                                        </p>
                                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                                            <StatusBadge status={doc.status} t={t} />
                                            <span className="text-[11px] text-steel-400">
                                                {t("kb.uploadedAt")} {formatDate(doc.created_at)}
                                            </span>
                                            {/* Tags */}
                                            {(doc.tags ?? []).length > 0 && (
                                                <div className="flex items-center gap-1 flex-wrap">
                                                    {(doc.tags ?? []).map((tag) => (
                                                        <span
                                                            key={tag}
                                                            className="inline-flex items-center gap-1 text-[11px] text-steel-600 bg-steel-50 border border-steel-200 px-2 py-0.5 rounded-full"
                                                        >
                                                            <TagIcon />
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            {/* Linked bots */}
                                            {(doc.bot_ids ?? []).length > 0 && (
                                                <div className="flex items-center gap-1 flex-wrap">
                                                    {(doc.bot_ids ?? []).slice(0, 3).map((bid) => {
                                                        const b = bots.find((x) => x.id === bid);
                                                        return (
                                                            <span
                                                                key={bid}
                                                                className="inline-flex items-center gap-1 text-[11px] text-brand-700 bg-brand-50 border border-brand-100 px-2 py-0.5 rounded-full"
                                                                title={b?.name ?? bid}
                                                            >
                                                                <span className="w-1.5 h-1.5 bg-brand-400 rounded-full" />
                                                                {b?.name ?? "—"}
                                                            </span>
                                                        );
                                                    })}
                                                    {(doc.bot_ids ?? []).length > 3 && (
                                                        <span className="text-[11px] text-steel-400">
                                                            +{(doc.bot_ids ?? []).length - 3}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="shrink-0 ml-3 flex items-center gap-1">
                                    {/* Edit Tags — Org Admin only */}
                                    {isOrgAdmin && (
                                        <button
                                            onClick={() => openTagModal(doc)}
                                            className="opacity-0 group-hover:opacity-100 text-steel-300 hover:text-brand-500 transition-all cursor-pointer p-1"
                                            title={t("kb.editTags")}
                                        >
                                            <TagIcon />
                                        </button>
                                    )}

                                    {/* Link Bots — Org Admin only */}
                                    {isOrgAdmin && (
                                        <button
                                            onClick={() => openLinkModal(doc)}
                                            className="opacity-0 group-hover:opacity-100 text-steel-300 hover:text-brand-500 transition-all cursor-pointer p-1"
                                            title={t("kb.linkBots")}
                                        >
                                            <LinkIcon />
                                        </button>
                                    )}

                                    {/* Download — Org Admin only */}
                                    {isOrgAdmin && doc.file_path && (
                                        <button
                                            onClick={async () => {
                                                try {
                                                    const res = await documentsApi.getPreviewUrl(doc.id, orgId, true);
                                                    window.open(res.data.url, "_blank");
                                                } catch {
                                                    toast("error", t("kb.previewFailed"));
                                                }
                                            }}
                                            className="opacity-0 group-hover:opacity-100 text-steel-300 hover:text-brand-500 transition-all cursor-pointer p-1"
                                            title={t("kb.download")}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                                <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                                                <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                                            </svg>
                                        </button>
                                    )}

                                    {/* Delete */}
                                    {deleteConfirm === doc.id ? (
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => handleDelete(doc.id)}
                                                className="text-xs text-red-600 font-medium hover:text-red-700 cursor-pointer"
                                            >
                                                {t("common.confirmDelete")}
                                            </button>
                                            <button
                                                onClick={() => setDeleteConfirm(null)}
                                                className="text-xs text-steel-400 hover:text-steel-600 cursor-pointer"
                                            >
                                                {t("common.cancel")}
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setDeleteConfirm(doc.id)}
                                            className="opacity-0 group-hover:opacity-100 text-steel-300 hover:text-red-500 transition-all cursor-pointer p-1"
                                            title={t("kb.deleteDoc")}
                                        >
                                            <TrashIcon />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* Drop zone indicator */}
                    {dragOver && (
                        <div className="flex items-center justify-center py-8 border-2 border-dashed border-brand-400 rounded-2xl bg-brand-50 transition-colors">
                            <p className="text-sm text-brand-600 font-medium">{t("kb.dropHere")}</p>
                        </div>
                    )}
                </div>
            )}

            {/* Upload progress — floating toast (top-right, non-blocking) */}
            {uploading && createPortal(
                <div className="fixed top-20 right-6 z-[60] animate-fade-in pointer-events-none">
                    <div className="bg-white rounded-xl shadow-lg border-2 border-brand-300 px-4 py-3 flex items-center gap-3 max-w-sm">
                        <svg className="w-5 h-5 animate-spin text-brand-500 shrink-0" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-steel-800 truncate">{t("kb.uploadProcessing")}</p>
                            <p className="text-[11px] text-steel-400 truncate">{t("kb.uploadProcessingNote")}</p>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Edit Tags Modal */}
            {editTagDocId && createPortal(
                <div
                    className="fixed inset-0 flex items-center justify-center z-50 p-4"
                    onClick={() => !tagSaving && setEditTagDocId(null)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-steel-100">
                            <h3 className="text-base font-bold text-steel-900">{t("kb.editTags")}</h3>
                            <p className="text-xs text-steel-400 mt-0.5">{t("kb.tagPlaceholder")}</p>
                        </div>
                        <div className="px-6 py-4">
                            {/* Tag input */}
                            <div className="flex items-center gap-2 mb-3">
                                <input
                                    type="text"
                                    value={editTagInput}
                                    onChange={(e) => setEditTagInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") { e.preventDefault(); handleAddTag(); }
                                    }}
                                    placeholder={t("kb.addTag")}
                                    className="flex-1 px-3 py-2 border border-steel-200 rounded-xl text-sm text-steel-800 placeholder:text-steel-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                                />
                                <button
                                    onClick={handleAddTag}
                                    className="px-3 py-2 bg-brand-400 text-steel-900 rounded-xl text-sm font-bold hover:bg-brand-500 transition-colors cursor-pointer"
                                >
                                    {t("kb.addTag")}
                                </button>
                            </div>
                            {/* Existing tag suggestions */}
                            {allTags.filter((t) => !editTags.includes(t)).length > 0 && (
                                <div className="mb-3">
                                    <p className="text-[11px] text-steel-400 mb-1.5">{t("kb.existingTags")}</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {allTags.filter((t) => !editTags.includes(t)).map((tag) => (
                                            <button
                                                key={tag}
                                                onClick={() => setEditTags((prev) => [...prev, tag])}
                                                className="inline-flex items-center gap-1 text-xs text-brand-700 bg-brand-50 border border-brand-200 px-2.5 py-1 rounded-full hover:bg-brand-100 transition-colors cursor-pointer"
                                            >
                                                <PlusIcon />
                                                {tag}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {/* Current tags on this document */}
                            <div>
                                <p className="text-[11px] text-steel-400 mb-1.5">{t("kb.currentTags")}</p>
                                <div className="flex flex-wrap gap-2 min-h-[32px]">
                                    {editTags.length === 0 && (
                                        <span className="text-xs text-steel-400 italic">{t("kb.noTags")}</span>
                                    )}
                                    {editTags.map((tag) => (
                                        <span
                                            key={tag}
                                            className="inline-flex items-center gap-1 text-xs text-steel-700 bg-steel-100 border border-steel-200 px-2.5 py-1 rounded-full"
                                        >
                                            {tag}
                                            <button
                                                onClick={() => handleRemoveTag(tag)}
                                                className="text-steel-400 hover:text-red-500 cursor-pointer ml-0.5"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                                                    <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                                                </svg>
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="px-6 py-3 border-t border-steel-100 flex items-center justify-end gap-2">
                            <button
                                onClick={() => setEditTagDocId(null)}
                                disabled={tagSaving}
                                className="px-4 py-2 text-sm text-steel-600 hover:text-steel-900 cursor-pointer disabled:opacity-50"
                            >
                                {t("common.cancel")}
                            </button>
                            <button
                                onClick={handleSaveTags}
                                disabled={tagSaving}
                                className="px-4 py-2 bg-brand-400 text-steel-900 rounded-full text-sm font-bold hover:bg-brand-500 transition-colors cursor-pointer disabled:opacity-50"
                            >
                                {tagSaving ? t("common.saving") : t("common.save")}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Link Bots Modal */}
            {linkDocId && createPortal(
                <div
                    className="fixed inset-0 flex items-center justify-center z-50 p-4"
                    onClick={() => !linkSaving && setLinkDocId(null)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-steel-100">
                            <h3 className="text-base font-bold text-steel-900">{t("kb.linkModalTitle")}</h3>
                            <p className="text-xs text-steel-400 mt-0.5">{t("kb.linkModalDesc")}</p>
                        </div>
                        <div className="flex-1 overflow-y-auto px-3 py-2">
                            {bots.length === 0 ? (
                                <div className="py-10 text-center text-sm text-steel-400">{t("kb.noBots")}</div>
                            ) : (
                                <ul className="divide-y divide-steel-100">
                                    {bots.map((b) => {
                                        const checked = linkSelection.has(b.id);
                                        return (
                                            <li key={b.id}>
                                                <label className="flex items-center gap-3 px-3 py-2.5 hover:bg-steel-50 rounded-lg cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => toggleBotSelection(b.id)}
                                                        className="w-4 h-4 accent-brand-500 cursor-pointer"
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-sm font-medium text-steel-800 truncate">{b.name}</p>
                                                        {b.description && (
                                                            <p className="text-xs text-steel-400 truncate">{b.description}</p>
                                                        )}
                                                    </div>
                                                    {!b.is_active && (
                                                        <span className="text-[10px] text-steel-400 bg-steel-100 px-1.5 py-0.5 rounded">
                                                            {t("bots.inactive")}
                                                        </span>
                                                    )}
                                                </label>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                        <div className="px-6 py-3 border-t border-steel-100 flex items-center justify-end gap-2">
                            <button
                                onClick={() => setLinkDocId(null)}
                                disabled={linkSaving}
                                className="px-4 py-2 text-sm text-steel-600 hover:text-steel-900 cursor-pointer disabled:opacity-50"
                            >
                                {t("common.cancel")}
                            </button>
                            <button
                                onClick={handleSaveLinks}
                                disabled={linkSaving}
                                className="px-4 py-2 bg-brand-400 text-steel-900 rounded-full text-sm font-bold hover:bg-brand-500 transition-colors cursor-pointer disabled:opacity-50"
                            >
                                {linkSaving ? t("common.saving") : t("common.save")}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Document Preview Modal — portal to body for perfect centering */}
            {previewDocId && createPortal(
                <DocumentViewer
                    documentId={previewDocId}
                    organizationId={orgId}
                    showActions={isOrgAdmin}
                    onClose={() => setPreviewDocId(null)}
                />,
                document.body
            )}
        </div>
    );
}
