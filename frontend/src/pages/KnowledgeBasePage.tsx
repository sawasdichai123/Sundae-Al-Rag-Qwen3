/**
 * KnowledgeBasePage — Document Management (Figma-matched)
 *
 * Displays knowledge collections (documents) as cards.
 * Allows uploading PDFs, viewing status, and deleting documents.
 *
 * Figma ref: Knowledge Page.png, Knowledge Page2.png
 * API: documentsApi (endpoints.ts)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { documentsApi } from "../api/endpoints";
import { useAuthStore } from "../store/authStore";
import type { Document } from "../types";

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

// ── Status Badge ────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
    const config: Record<string, { label: string; className: string }> = {
        pending: { label: "รอดำเนินการ", className: "bg-steel-100 text-steel-500" },
        processing: { label: "กำลังประมวลผล", className: "bg-amber-50 text-amber-600" },
        ready: { label: "พร้อมใช้", className: "bg-emerald-50 text-emerald-600" },
        error: { label: "ข้อผิดพลาด", className: "bg-red-50 text-red-600" },
    };
    const { label, className } = config[status] || config.pending;
    return (
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${className}`}>
            {status === "processing" && <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />}
            {status === "ready" && <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />}
            {label}
        </span>
    );
}

// ── Time Format ─────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "เมื่อสักครู่";
    if (mins < 60) return `${mins} นาทีก่อน`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ชม. ก่อน`;
    const days = Math.floor(hours / 24);
    return `${days} วันก่อน`;
}

// ── Component ───────────────────────────────────────────────────

export default function KnowledgeBasePage() {
    const [documents, setDocuments] = useState<Document[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [uploading, setUploading] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const user = useAuthStore((s) => s.user);
    const orgId = (user?.organization_id ?? import.meta.env.VITE_DEFAULT_ORG_ID) as string;

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

    useEffect(() => {
        loadDocuments();
    }, [loadDocuments]);

    // ── Upload handler ──────────────────────────────────────────
    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !orgId) return;

        setUploading(true);
        try {
            await documentsApi.upload(file, "", orgId);
            await loadDocuments();
        } catch (err) {
            console.error("[Knowledge] Upload failed:", err);
            alert("อัปโหลดล้มเหลว กรุณาลองอีกครั้ง");
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
            alert("ลบไม่สำเร็จ กรุณาลองอีกครั้ง");
        }
    };

    // ── Drag & Drop ─────────────────────────────────────────────
    const [dragOver, setDragOver] = useState(false);

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (!file || !orgId) return;
        if (file.type !== "application/pdf") {
            alert("กรุณาอัปโหลดไฟล์ PDF เท่านั้น");
            return;
        }
        setUploading(true);
        try {
            await documentsApi.upload(file, "", orgId);
            await loadDocuments();
        } catch (err) {
            console.error("[Knowledge] Drop upload failed:", err);
            alert("อัปโหลดล้มเหลว");
        } finally {
            setUploading(false);
        }
    };

    // ── Filtered list ───────────────────────────────────────────
    const filtered = documents.filter((d) =>
        d.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // ── Render ───────────────────────────────────────────────────
    return (
        <div className="animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-steel-900">Knowledge</h1>
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center gap-1.5 bg-brand-400 text-steel-900 px-5 py-2.5 rounded-full text-sm font-bold hover:bg-brand-500 transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
                >
                    <PlusIcon />
                    {uploading ? "กำลังอัปโหลด..." : "Add knowledge collection"}
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={handleUpload}
                />
            </div>

            {/* Search */}
            <div className="relative mb-6">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400">
                    <SearchIcon />
                </span>
                <input
                    type="text"
                    placeholder="Search Models"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full max-w-md pl-10 pr-4 py-2.5 bg-white border border-steel-200 rounded-xl text-sm text-steel-800 placeholder:text-steel-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all"
                />
            </div>

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center py-20">
                    <div className="flex items-center gap-3 text-steel-400">
                        <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span className="text-sm">กำลังโหลด...</span>
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
                        {searchQuery ? "ไม่พบเอกสารที่ค้นหา" : "ยังไม่มีเอกสาร"}
                    </p>
                    <p className="text-xs text-steel-400">
                        {searchQuery ? "ลองค้นหาด้วยคำอื่น" : "Drag and drop a file to upload or select a file to view"}
                    </p>
                    {!searchQuery && (
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="mt-4 text-sm text-brand-600 hover:text-brand-700 font-medium cursor-pointer"
                        >
                            เลือกไฟล์
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
                                        <h3 className="text-sm font-bold text-steel-900 truncate">
                                            {doc.name}
                                        </h3>
                                        <p className="text-xs text-steel-400 mt-1 line-clamp-2">
                                            {doc.mime_type || "PDF Document"}
                                            {doc.file_size_bytes
                                                ? ` · ${(doc.file_size_bytes / 1024).toFixed(0)} KB`
                                                : ""}
                                        </p>
                                        <div className="flex items-center gap-3 mt-2">
                                            <StatusBadge status={doc.status} />
                                            <span className="text-[11px] text-steel-400">
                                                Update ล่าสุด {timeAgo(doc.created_at)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Delete Button */}
                                <div className="shrink-0 ml-3">
                                    {deleteConfirm === doc.id ? (
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => handleDelete(doc.id)}
                                                className="text-xs text-red-600 font-medium hover:text-red-700 cursor-pointer"
                                            >
                                                ยืนยันลบ
                                            </button>
                                            <button
                                                onClick={() => setDeleteConfirm(null)}
                                                className="text-xs text-steel-400 hover:text-steel-600 cursor-pointer"
                                            >
                                                ยกเลิก
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setDeleteConfirm(doc.id)}
                                            className="opacity-0 group-hover:opacity-100 text-steel-300 hover:text-red-500 transition-all cursor-pointer p-1"
                                            title="ลบเอกสาร"
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
                            <p className="text-sm text-brand-600 font-medium">วางไฟล์ที่นี่เพื่ออัปโหลด</p>
                        </div>
                    )}
                </div>
            )}

            {/* Upload progress overlay */}
            {uploading && (
                <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-xl p-8 flex flex-col items-center gap-4 max-w-sm mx-4">
                        <svg className="w-8 h-8 animate-spin text-brand-400" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <p className="text-sm font-medium text-steel-800">กำลังอัปโหลดและประมวลผล...</p>
                        <p className="text-xs text-steel-400">อาจใช้เวลาสักครู่ในการ chunk และ embed</p>
                    </div>
                </div>
            )}
        </div>
    );
}
