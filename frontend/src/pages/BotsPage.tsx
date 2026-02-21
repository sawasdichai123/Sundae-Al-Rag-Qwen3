/**
 * BotsPage — Bot Management with Create/Edit (Figma-matched)
 *
 * List view: Bot cards with search + "Create bot +" button
 * Create/Edit view: Form with name, description, system prompt, knowledge link
 *
 * Figma ref: Bots Page.png, Create Bots Page.png
 * API: botsApi (endpoints.ts)
 */

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { botsApi, documentsApi } from "../api/endpoints";
import { useAuthStore } from "../store/authStore";
import type { Bot, Document } from "../types";

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

function BackIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
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

function BotAvatar({ name: _name }: { name: string }) {
    return (
        <div className="w-14 h-14 rounded-2xl bg-brand-100 flex items-center justify-center text-2xl shrink-0">
            🤖
        </div>
    );
}

// ── Component ───────────────────────────────────────────────────

type ViewMode = "list" | "create" | "edit";

export default function BotsPage() {
    const [bots, setBots] = useState<Bot[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<ViewMode>("list");
    const [editingBot, setEditingBot] = useState<Bot | null>(null);
    const [saving, setSaving] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // Form state
    const [formName, setFormName] = useState("");
    const [formDescription, setFormDescription] = useState("");
    const [formPrompt, setFormPrompt] = useState("");
    const [formWebEnabled, setFormWebEnabled] = useState(true);

    // Knowledge selection state
    const [showKnowledgeModal, setShowKnowledgeModal] = useState(false);
    const [allDocuments, setAllDocuments] = useState<Document[]>([]);
    const [linkedDocIds, setLinkedDocIds] = useState<Set<string>>(new Set());
    const [docsLoading, setDocsLoading] = useState(false);
    const [linkingDocId, setLinkingDocId] = useState<string | null>(null);

    const user = useAuthStore((s) => s.user);
    const orgId = (user?.organization_id ?? import.meta.env.VITE_DEFAULT_ORG_ID) as string;

    // ── Load bots ───────────────────────────────────────────────
    const loadBots = useCallback(async () => {
        if (!orgId) { setLoading(false); return; }
        setLoading(true);
        try {
            const res = await botsApi.list(orgId);
            setBots(res.data);
        } catch (err) {
            console.error("[Bots] Failed to load bots:", err);
        } finally {
            setLoading(false);
        }
    }, [orgId]);

    useEffect(() => {
        loadBots();
    }, [loadBots]);

    // ── Load documents for knowledge modal ──────────────────────
    const loadDocuments = useCallback(async (botId?: string) => {
        if (!orgId) return;
        setDocsLoading(true);
        try {
            const res = await documentsApi.list(orgId);
            setAllDocuments(res.data);
            // Pre-select documents already linked to this bot
            if (botId) {
                const alreadyLinked = new Set(
                    res.data.filter((d: Document) => d.bot_id === botId).map((d: Document) => d.id)
                );
                setLinkedDocIds(alreadyLinked);
            } else {
                setLinkedDocIds(new Set());
            }
        } catch (err) {
            console.error("[Bots] Failed to load documents:", err);
        } finally {
            setDocsLoading(false);
        }
    }, [orgId]);

    // ── Toggle document link ────────────────────────────────────
    const toggleDocLink = async (docId: string) => {
        if (!editingBot || linkingDocId) return;
        setLinkingDocId(docId);
        try {
            const isLinked = linkedDocIds.has(docId);
            const newBotId = isLinked ? null : editingBot.id;
            await documentsApi.linkBot(docId, orgId, newBotId);
            // Update local state
            setLinkedDocIds((prev) => {
                const next = new Set(prev);
                if (isLinked) {
                    next.delete(docId);
                } else {
                    next.add(docId);
                }
                return next;
            });
        } catch (err) {
            console.error("[Bots] Failed to toggle document link:", err);
            alert("เชื่อมต่อเอกสารไม่สำเร็จ");
        } finally {
            setLinkingDocId(null);
        }
    };

    // ── Form helpers ────────────────────────────────────────────
    const resetForm = () => {
        setFormName("");
        setFormDescription("");
        setFormPrompt("");
        setFormWebEnabled(true);
        setEditingBot(null);
        setAllDocuments([]);
        setLinkedDocIds(new Set());
    };

    const openCreate = () => {
        resetForm();
        setViewMode("create");
    };

    const openEdit = (bot: Bot) => {
        setEditingBot(bot);
        setFormName(bot.name);
        setFormDescription(bot.description || "");
        setFormPrompt(bot.prompt || bot.system_prompt || "");
        setFormWebEnabled(bot.is_web_enabled);
        setViewMode("edit");
        // Load documents to show linked ones
        loadDocuments(bot.id);
    };

    const goBack = () => {
        resetForm();
        setViewMode("list");
    };

    // ── Save handler ────────────────────────────────────────────
    const handleSave = async () => {
        if (!orgId || !formName.trim()) return;
        setSaving(true);

        try {
            if (viewMode === "create") {
                await botsApi.create({
                    name: formName.trim(),
                    organization_id: orgId,
                    description: formDescription.trim() || undefined,
                    system_prompt: formPrompt.trim() || undefined,
                    is_web_enabled: formWebEnabled,
                });
            } else if (viewMode === "edit" && editingBot) {
                await botsApi.update(editingBot.id, orgId, {
                    name: formName.trim(),
                    description: formDescription.trim(),
                    system_prompt: formPrompt.trim(),
                    is_web_enabled: formWebEnabled,
                } as Partial<Bot>);
            }
            await loadBots();
            goBack();
        } catch (err) {
            console.error("[Bots] Save failed:", err);
            alert("บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง");
        } finally {
            setSaving(false);
        }
    };

    // ── Delete handler ──────────────────────────────────────────
    const handleDelete = async (botId: string) => {
        if (!orgId) return;
        try {
            await botsApi.delete(botId, orgId);
            setDeleteConfirm(null);
            await loadBots();
        } catch (err) {
            console.error("[Bots] Delete failed:", err);
            alert("ลบไม่สำเร็จ กรุณาลองอีกครั้ง");
        }
    };

    // ── Filtered list ───────────────────────────────────────────
    const filtered = bots.filter((b) =>
        b.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // ── Linked documents for display ────────────────────────────
    const linkedDocs = allDocuments.filter((d) => linkedDocIds.has(d.id));

    // ── Knowledge Selection Modal ───────────────────────────────
    const knowledgeModal = showKnowledgeModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 animate-fade-in" onClick={() => setShowKnowledgeModal(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="px-6 py-4 border-b border-steel-100 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-steel-900">เลือกเอกสารเชื่อมต่อกับ Bot</h3>
                    <button
                        onClick={() => setShowKnowledgeModal(false)}
                        className="text-steel-400 hover:text-steel-800 transition-colors cursor-pointer text-lg"
                    >
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4">
                    {docsLoading ? (
                        <div className="flex items-center justify-center py-12 text-steel-400">
                            <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                        </div>
                    ) : allDocuments.length === 0 ? (
                        <div className="text-center py-12">
                            <div className="text-3xl mb-3">📄</div>
                            <p className="text-sm text-steel-500">ยังไม่มีเอกสาร</p>
                            <p className="text-xs text-steel-400 mt-1">อัปโหลด PDF ใน Knowledge Base ก่อน</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {allDocuments.map((doc) => {
                                const isLinked = linkedDocIds.has(doc.id);
                                const isLinking = linkingDocId === doc.id;
                                const isLinkedToOther = doc.bot_id && doc.bot_id !== editingBot?.id;
                                const isNotReady = doc.status !== "ready";
                                const isDisabled = isLinking || !!isLinkedToOther || isNotReady;
                                return (
                                    <button
                                        key={doc.id}
                                        onClick={() => {
                                            if (!isDisabled) toggleDocLink(doc.id);
                                        }}
                                        disabled={isDisabled}
                                        className={`w-full text-left px-4 py-3 rounded-xl border transition-all cursor-pointer disabled:cursor-not-allowed ${isLinked
                                            ? "border-brand-400 bg-brand-50"
                                            : isDisabled
                                                ? "border-steel-100 bg-steel-50 opacity-50"
                                                : "border-steel-200 hover:border-brand-300 hover:bg-brand-50/30"
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            {/* Checkbox */}
                                            <div
                                                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${isLinked
                                                    ? "border-brand-400 bg-brand-400"
                                                    : "border-steel-300"
                                                    }`}
                                            >
                                                {isLinked && (
                                                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                    </svg>
                                                )}
                                            </div>
                                            {/* Doc info */}
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-steel-800 truncate">{doc.name}</p>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${doc.status === "ready" ? "bg-emerald-50 text-emerald-600"
                                                        : doc.status === "processing" ? "bg-amber-50 text-amber-600"
                                                            : doc.status === "error" ? "bg-red-50 text-red-600"
                                                                : "bg-steel-100 text-steel-500"
                                                        }`}>
                                                        {doc.status === "ready" ? "พร้อมใช้" : doc.status === "processing" ? "กำลังประมวลผล" : doc.status === "error" ? "ข้อผิดพลาด" : doc.status}
                                                    </span>
                                                    {doc.file_size_bytes && (
                                                        <span className="text-[10px] text-steel-400">
                                                            {(doc.file_size_bytes / 1024).toFixed(0)} KB
                                                        </span>
                                                    )}
                                                    {isLinkedToOther && (
                                                        <span className="text-[10px] text-steel-400">เชื่อมกับ Bot อื่น</span>
                                                    )}
                                                    {isNotReady && !isLinkedToOther && (
                                                        <span className="text-[10px] text-red-400">ใช้งานไม่ได้</span>
                                                    )}
                                                </div>
                                            </div>
                                            {isLinking && (
                                                <svg className="w-4 h-4 animate-spin text-brand-400 shrink-0" viewBox="0 0 24 24" fill="none">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                                </svg>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-steel-100 flex justify-between items-center">
                    <p className="text-xs text-steel-400">
                        เลือกแล้ว {linkedDocIds.size} เอกสาร
                    </p>
                    <button
                        onClick={() => setShowKnowledgeModal(false)}
                        className="bg-brand-400 text-steel-900 px-5 py-2 rounded-full text-sm font-bold hover:bg-brand-500 transition-colors cursor-pointer"
                    >
                        เสร็จสิ้น
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );

    // ── Create / Edit View ──────────────────────────────────────
    if (viewMode === "create" || viewMode === "edit") {
        return (
            <div className="animate-fade-in max-w-2xl">
                {knowledgeModal}

                {/* Back button */}
                <button
                    onClick={goBack}
                    className="flex items-center gap-2 text-sm text-steel-500 hover:text-steel-800 transition-colors mb-6 cursor-pointer"
                >
                    <BackIcon />
                    <span>Back</span>
                </button>

                {/* Bot Avatar + Name */}
                <div className="flex items-center gap-4 mb-8">
                    <BotAvatar name={formName} />
                    <div>
                        <input
                            type="text"
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            placeholder="ชื่อบอท"
                            className="text-xl font-bold text-steel-900 bg-transparent border-none outline-none placeholder:text-steel-300 w-full"
                        />
                        <p className="text-xs text-steel-400 mt-0.5">
                            {editingBot ? `รหัส: ${editingBot.id.slice(0, 8)}...` : "รหัสโมเดล (สร้างอัตโนมัติ)"}
                        </p>
                    </div>
                </div>

                {/* Description */}
                <div className="mb-6">
                    <label className="block text-sm font-bold text-steel-800 mb-2">คำอธิบาย</label>
                    <textarea
                        value={formDescription}
                        onChange={(e) => setFormDescription(e.target.value)}
                        placeholder="เพิ่มคำอธิบายสั้น ๆ สำหรับโมเดลที่ทำ"
                        rows={3}
                        className="w-full px-4 py-3 bg-white border border-steel-200 rounded-2xl text-sm text-steel-800 placeholder:text-steel-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all resize-none"
                    />
                </div>

                {/* System Prompt */}
                <div className="mb-6">
                    <label className="block text-sm font-bold text-steel-800 mb-1">พารามิเตอร์ของบอท</label>
                    <p className="text-xs text-steel-400 mb-2">ระบบพรอมต์</p>
                    <textarea
                        value={formPrompt}
                        onChange={(e) => setFormPrompt(e.target.value)}
                        placeholder="เพิ่มคำอธิบายสั้น ๆ สำหรับโมเดลที่ทำ"
                        rows={6}
                        className="w-full px-4 py-3 bg-white border border-steel-200 rounded-2xl text-sm text-steel-800 placeholder:text-steel-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all resize-none"
                    />
                </div>

                {/* Web Enabled Toggle */}
                <div className="mb-6 flex items-center justify-between p-4 bg-white rounded-2xl border border-steel-200">
                    <div>
                        <p className="text-sm font-bold text-steel-800">เปิดใช้ Web Chat</p>
                        <p className="text-xs text-steel-400 mt-0.5">อนุญาตให้ใช้ bot ผ่าน Web Chat</p>
                    </div>
                    <button
                        onClick={() => setFormWebEnabled(!formWebEnabled)}
                        className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${formWebEnabled ? "bg-brand-400" : "bg-steel-200"}`}
                    >
                        <span className={`absolute top-[2px] left-0 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200 ${formWebEnabled ? "translate-x-[22px]" : "translate-x-[2px]"}`} />
                    </button>
                </div>

                {/* Knowledge Link */}
                <div className="mb-6">
                    <label className="block text-sm font-bold text-steel-800 mb-1">ความรู้</label>
                    <p className="text-xs text-steel-400 mb-3">
                        หากต้องการเชื่อมต่อฐานความรู้ที่นี่ ให้เพิ่มข้อมูลลงในพื้นที่ทำงาน "ความรู้" ก่อน
                    </p>
                    <button
                        onClick={() => {
                            if (viewMode === "edit" && editingBot) {
                                loadDocuments(editingBot.id);
                                setShowKnowledgeModal(true);
                            } else {
                                alert("กรุณาสร้าง Bot ก่อน แล้วจึงเชื่อมต่อเอกสาร");
                            }
                        }}
                        className="inline-flex items-center gap-1.5 bg-brand-400 text-steel-900 px-4 py-2 rounded-full text-sm font-bold hover:bg-brand-500 transition-colors cursor-pointer"
                    >
                        เลือกความรู้
                    </button>

                    {/* Linked documents chips */}
                    {linkedDocs.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {linkedDocs.map((doc) => (
                                <span
                                    key={doc.id}
                                    className="inline-flex items-center gap-1.5 text-xs font-medium bg-brand-50 text-brand-700 pl-3 pr-1.5 py-1.5 rounded-full border border-brand-200"
                                >
                                    📄 {doc.name.length > 30 ? doc.name.slice(0, 30) + "…" : doc.name}
                                    <button
                                        onClick={() => toggleDocLink(doc.id)}
                                        className="w-4 h-4 rounded-full bg-brand-200 text-brand-700 flex items-center justify-center hover:bg-brand-300 transition-colors cursor-pointer text-[10px]"
                                    >
                                        ✕
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Save Button */}
                <div className="flex gap-3 pt-4 border-t border-steel-100">
                    <button
                        onClick={handleSave}
                        disabled={saving || !formName.trim()}
                        className="bg-brand-400 text-steel-900 px-8 py-2.5 rounded-full text-sm font-bold hover:bg-brand-500 transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
                    >
                        {saving ? "กำลังบันทึก..." : viewMode === "create" ? "สร้าง Bot" : "บันทึก"}
                    </button>
                    <button
                        onClick={goBack}
                        className="px-6 py-2.5 text-steel-500 hover:text-steel-800 text-sm font-medium transition-colors cursor-pointer"
                    >
                        ยกเลิก
                    </button>
                </div>
            </div>
        );
    }

    // ── List View ───────────────────────────────────────────────
    return (
        <div className="animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-steel-900">Bots</h1>
                <button
                    onClick={openCreate}
                    className="inline-flex items-center gap-1.5 bg-brand-400 text-steel-900 px-5 py-2.5 rounded-full text-sm font-bold hover:bg-brand-500 transition-colors cursor-pointer shadow-sm"
                >
                    Create bot
                    <PlusIcon />
                </button>
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
                <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-dashed border-steel-200">
                    <div className="text-4xl mb-4">🤖</div>
                    <p className="text-sm text-steel-500 font-medium mb-1">
                        {searchQuery ? "ไม่พบ Bot ที่ค้นหา" : "ยังไม่มี Bot"}
                    </p>
                    <p className="text-xs text-steel-400 mb-4">
                        {searchQuery ? "ลองค้นหาด้วยชื่ออื่น" : "สร้าง Bot แรกของคุณเพื่อเริ่มใช้งาน"}
                    </p>
                    {!searchQuery && (
                        <button
                            onClick={openCreate}
                            className="text-sm text-brand-600 hover:text-brand-700 font-medium cursor-pointer"
                        >
                            + สร้าง Bot ใหม่
                        </button>
                    )}
                </div>
            )}

            {/* Bot Cards */}
            {!loading && filtered.length > 0 && (
                <div className="space-y-3">
                    {filtered.map((bot) => (
                        <div
                            key={bot.id}
                            onClick={() => openEdit(bot)}
                            className="group bg-white rounded-2xl border border-dashed border-steel-200 hover:border-brand-400 hover:shadow-md hover:shadow-brand-100/30 transition-all duration-200 p-5 cursor-pointer"
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h3 className="text-sm font-bold text-steel-900">{bot.name}</h3>
                                        {!bot.is_active && (
                                            <span className="text-[10px] font-medium bg-steel-100 text-steel-400 px-2 py-0.5 rounded-full">
                                                ปิดใช้งาน
                                            </span>
                                        )}
                                        {bot.is_web_enabled && (
                                            <span className="text-[10px] font-medium bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">
                                                Web
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-steel-500 line-clamp-2">
                                        {bot.prompt || bot.system_prompt || bot.description || "ไม่มีคำอธิบาย"}
                                    </p>
                                </div>

                                {/* Delete */}
                                <div className="shrink-0 ml-3" onClick={(e) => e.stopPropagation()}>
                                    {deleteConfirm === bot.id ? (
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => handleDelete(bot.id)}
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
                                            onClick={() => setDeleteConfirm(bot.id)}
                                            className="opacity-0 group-hover:opacity-100 text-steel-300 hover:text-red-500 transition-all cursor-pointer p-1"
                                            title="ลบ Bot"
                                        >
                                            <TrashIcon />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
