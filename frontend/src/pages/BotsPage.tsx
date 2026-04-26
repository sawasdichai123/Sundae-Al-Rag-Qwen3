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
import { botsApi, documentsApi, orgApi } from "../api/endpoints";
import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";
import { useToastStore } from "../store/toastStore";
import type { Bot, Document, OrgMember } from "../types";
import { useT } from "../i18n";

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
    const t = useT();
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

    // Visibility state
    const [formVisibility, setFormVisibility] = useState<"all" | "restricted">("all");
    const [formVisibleTo, setFormVisibleTo] = useState<string[]>([]);
    const [formVisibilityLabel, setFormVisibilityLabel] = useState("");
    const [showMemberModal, setShowMemberModal] = useState(false);
    const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
    const [membersLoading, setMembersLoading] = useState(false);

    // Knowledge selection state
    const [showKnowledgeModal, setShowKnowledgeModal] = useState(false);
    const [allDocuments, setAllDocuments] = useState<Document[]>([]);
    const [linkedDocIds, setLinkedDocIds] = useState<Set<string>>(new Set());
    const [docsLoading, setDocsLoading] = useState(false);
    const [linkingDocId, setLinkingDocId] = useState<string | null>(null);

    const user = useAuthStore((s) => s.user);
    const toast = useToastStore((s) => s.addToast);
    const activeOrgId = useOrgStore((s) => s.activeOrgId);
    const orgId = (activeOrgId ?? user?.organization_id ?? import.meta.env.VITE_DEFAULT_ORG_ID) as string;

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
                    res.data
                        .filter((d: Document) => (d.bot_ids ?? []).includes(botId))
                        .map((d: Document) => d.id)
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

    // ── Load org members for visibility modal ────────────────────
    const loadMembers = useCallback(async () => {
        if (!orgId) return;
        setMembersLoading(true);
        try {
            const res = await orgApi.listMembers(orgId);
            setOrgMembers(res.data);
        } catch (err) {
            console.error("[Bots] Failed to load members:", err);
        } finally {
            setMembersLoading(false);
        }
    }, [orgId]);

    // ── Toggle document link ────────────────────────────────────
    const toggleDocLink = async (docId: string) => {
        if (!editingBot || linkingDocId) return;
        setLinkingDocId(docId);
        try {
            const isLinked = linkedDocIds.has(docId);
            const doc = allDocuments.find((d) => d.id === docId);
            const current = new Set<string>(doc?.bot_ids ?? []);
            if (isLinked) current.delete(editingBot.id);
            else current.add(editingBot.id);
            const nextBotIds = Array.from(current);
            await documentsApi.linkBots(docId, orgId, nextBotIds);
            // Update local state — keep allDocuments in sync so subsequent toggles work
            setAllDocuments((prev) =>
                prev.map((d) => (d.id === docId ? { ...d, bot_ids: nextBotIds } : d))
            );
            setLinkedDocIds((prev) => {
                const next = new Set(prev);
                if (isLinked) next.delete(docId);
                else next.add(docId);
                return next;
            });
        } catch (err) {
            console.error("[Bots] Failed to toggle document link:", err);
            toast("error", t("bots.linkFailed"));
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
        setFormVisibility("all");
        setFormVisibleTo([]);
        setFormVisibilityLabel("");
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
        setFormPrompt(bot.system_prompt || "");
        setFormWebEnabled(bot.is_web_enabled);
        setFormVisibility(bot.visibility || "all");
        setFormVisibleTo(bot.visible_to || []);
        setFormVisibilityLabel(bot.visibility_label || "");
        setViewMode("edit");
        loadDocuments(bot.id);
        if (bot.visibility === "restricted") loadMembers();
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
                    visibility: formVisibility,
                    visible_to: formVisibility === "restricted" ? formVisibleTo : [],
                    visibility_label: formVisibility === "restricted" ? (formVisibilityLabel.trim() || null) : null,
                });
            } else if (viewMode === "edit" && editingBot) {
                await botsApi.update(editingBot.id, orgId, {
                    name: formName.trim(),
                    description: formDescription.trim(),
                    system_prompt: formPrompt.trim(),
                    is_web_enabled: formWebEnabled,
                    visibility: formVisibility,
                    visible_to: formVisibility === "restricted" ? formVisibleTo : [],
                    visibility_label: formVisibility === "restricted" ? (formVisibilityLabel.trim() || null) : null,
                } as Partial<Bot>);
            }
            await loadBots();
            goBack();
        } catch (err: unknown) {
            console.error("[Bots] Save failed:", err);
            const axErr = err as { response?: { status?: number } };
            if (axErr?.response?.status === 409) {
                toast("error", t("bots.duplicateName"));
            } else {
                toast("error", t("bots.saveFailed"));
            }
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
            toast("error", t("bots.deleteFailed"));
        }
    };

    // ── Visibility filter ───────────────────────────────────────
    const [visibilityFilter, setVisibilityFilter] = useState<string | null>(null);

    const visibilityGroups = Array.from(
        new Set(bots.map((b) => b.visibility === "restricted" ? (b.visibility_label || t("bots.badgeRestricted")) : null).filter(Boolean))
    ) as string[];

    // ── Filtered list ───────────────────────────────────────────
    const filtered = bots.filter((b) => {
        const matchesSearch = (b.name ?? "").toLowerCase().includes(searchQuery.toLowerCase());
        if (!visibilityFilter) return matchesSearch;
        if (visibilityFilter === "__all__") return matchesSearch && b.visibility === "all";
        return matchesSearch && b.visibility === "restricted" && (b.visibility_label || t("bots.badgeRestricted")) === visibilityFilter;
    });

    // ── Linked documents for display ────────────────────────────
    const linkedDocs = allDocuments.filter((d) => linkedDocIds.has(d.id));

    // ── Knowledge Selection Modal ───────────────────────────────
    const knowledgeModal = showKnowledgeModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center animate-fade-in" onClick={() => setShowKnowledgeModal(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="px-6 py-4 border-b border-steel-100 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-steel-900">{t("bots.selectDocs")}</h3>
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
                            <p className="text-sm text-steel-500">{t("bots.noDocs")}</p>
                            <p className="text-xs text-steel-400 mt-1">{t("bots.uploadFirst")}</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {allDocuments.map((doc) => {
                                const isLinked = linkedDocIds.has(doc.id);
                                const isLinking = linkingDocId === doc.id;
                                const isNotReady = doc.status !== "ready";
                                const isDisabled = isLinking || isNotReady;
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
                                                        {doc.status === "ready" ? t("kb.statusReady") : doc.status === "processing" ? t("kb.statusProcessing") : doc.status === "error" ? t("kb.statusError") : doc.status}
                                                    </span>
                                                    {doc.file_size_bytes && (
                                                        <span className="text-[10px] text-steel-400">
                                                            {(doc.file_size_bytes / 1024).toFixed(0)} KB
                                                        </span>
                                                    )}
                                                    {isNotReady && (
                                                        <span className="text-[10px] text-red-400">{t("bots.notAvailable")}</span>
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
                        {t("bots.selectedCount").replace("{n}", String(linkedDocIds.size))}
                    </p>
                    <button
                        onClick={() => setShowKnowledgeModal(false)}
                        className="bg-brand-400 text-steel-900 px-5 py-2 rounded-full text-sm font-bold hover:bg-brand-500 transition-colors cursor-pointer"
                    >
                        {t("bots.done")}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );

    // ── Member Selection Modal ──────────────────────────────────
    const memberModal = showMemberModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center animate-fade-in" onClick={() => setShowMemberModal(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-steel-100 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-steel-900">{t("bots.selectMembers")}</h3>
                    <button onClick={() => setShowMemberModal(false)} className="text-steel-400 hover:text-steel-800 transition-colors cursor-pointer text-lg">✕</button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                    {membersLoading ? (
                        <div className="flex items-center justify-center py-12 text-steel-400">
                            <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                        </div>
                    ) : orgMembers.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-sm text-steel-500">{t("bots.noMembers")}</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {orgMembers.filter((m) => m.org_role !== "admin").map((member) => {
                                const isSelected = formVisibleTo.includes(member.user_id);
                                return (
                                    <button
                                        key={member.user_id}
                                        onClick={() => {
                                            setFormVisibleTo((prev) =>
                                                isSelected ? prev.filter((id) => id !== member.user_id) : [...prev, member.user_id]
                                            );
                                        }}
                                        className={`w-full text-left px-4 py-3 rounded-xl border transition-all cursor-pointer ${isSelected ? "border-brand-400 bg-brand-50" : "border-steel-200 hover:border-brand-300 hover:bg-brand-50/30"}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${isSelected ? "border-brand-400 bg-brand-400" : "border-steel-300"}`}>
                                                {isSelected && (
                                                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                    </svg>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-steel-800 truncate">
                                                    {[member.first_name, member.last_name].filter(Boolean).join(" ") || member.email}
                                                </p>
                                                <p className="text-[11px] text-steel-400 truncate">{member.email}</p>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
                <div className="px-6 py-3 border-t border-steel-100 flex justify-between items-center">
                    <p className="text-xs text-steel-400">
                        {t("bots.selectedMembers").replace("{n}", String(formVisibleTo.length))}
                    </p>
                    <button onClick={() => setShowMemberModal(false)} className="bg-brand-400 text-steel-900 px-5 py-2 rounded-full text-sm font-bold hover:bg-brand-500 transition-colors cursor-pointer">
                        {t("bots.memberSelectDone")}
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
                {memberModal}

                {/* Back button */}
                <button
                    onClick={goBack}
                    className="flex items-center gap-2 text-sm text-steel-500 hover:text-steel-800 transition-colors mb-6 cursor-pointer"
                >
                    <BackIcon />
                    <span>{t("bots.back")}</span>
                </button>

                {/* Bot Avatar + Name */}
                <div className="flex items-center gap-4 mb-8">
                    <BotAvatar name={formName} />
                    <div>
                        <input
                            type="text"
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            placeholder={t("bots.botName")}
                            className="text-xl font-bold text-steel-900 bg-white border border-steel-200 rounded-xl px-4 py-2 outline-none placeholder:text-steel-400 w-full focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all"
                        />
                        <p className="text-xs text-steel-400 mt-0.5">
                            {editingBot ? `${t("bots.botIdPrefix")} ${editingBot.id.slice(0, 8)}...` : t("bots.botIdAuto")}
                        </p>
                    </div>
                </div>

                {/* Description */}
                <div className="mb-6">
                    <label className="block text-sm font-bold text-steel-800 mb-2">{t("bots.description")}</label>
                    <textarea
                        value={formDescription}
                        onChange={(e) => setFormDescription(e.target.value)}
                        placeholder={t("bots.descriptionPlaceholder")}
                        rows={3}
                        className="w-full px-4 py-3 bg-white border border-steel-200 rounded-2xl text-sm text-steel-800 placeholder:text-steel-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all resize-none"
                    />
                </div>

                {/* System Prompt */}
                <div className="mb-6">
                    <label className="block text-sm font-bold text-steel-800 mb-1">{t("bots.parameters")}</label>
                    <p className="text-xs text-steel-400 mb-2">{t("bots.systemPrompt")}</p>
                    <textarea
                        value={formPrompt}
                        onChange={(e) => setFormPrompt(e.target.value)}
                        placeholder={t("bots.systemPromptPlaceholderHint")}
                        rows={6}
                        className="w-full px-4 py-3 bg-white border border-steel-200 rounded-2xl text-sm text-steel-800 placeholder:text-steel-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all resize-none"
                    />
                </div>

                {/* Web Enabled Toggle */}
                <div className="mb-4 flex items-center justify-between p-4 bg-white rounded-2xl border border-steel-200">
                    <div>
                        <p className="text-sm font-bold text-steel-800">{t("bots.webChatEnabled")}</p>
                        <p className="text-xs text-steel-400 mt-0.5">{t("bots.webChatEnabledDesc")}</p>
                    </div>
                    <button
                        onClick={() => setFormWebEnabled(!formWebEnabled)}
                        className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${formWebEnabled ? "bg-brand-400" : "bg-steel-200"}`}
                    >
                        <span className={`absolute top-[2px] left-0 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200 ${formWebEnabled ? "translate-x-[22px]" : "translate-x-[2px]"}`} />
                    </button>
                </div>

                {/* Visibility Toggle */}
                <div className="mb-6 p-4 bg-white rounded-2xl border border-steel-200">
                    <p className="text-sm font-bold text-steel-800 mb-3">{t("bots.visibility")}</p>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={() => setFormVisibility("all")}
                            className={`flex-1 p-3 rounded-xl border-2 text-left transition-all cursor-pointer ${formVisibility === "all" ? "border-brand-400 bg-brand-50" : "border-steel-200 hover:border-steel-300"}`}
                        >
                            <p className="text-sm font-bold text-steel-800">{t("bots.visibilityAll")}</p>
                            <p className="text-[11px] text-steel-400 mt-0.5">{t("bots.visibilityAllDesc")}</p>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setFormVisibility("restricted");
                                if (orgMembers.length === 0) loadMembers();
                            }}
                            className={`flex-1 p-3 rounded-xl border-2 text-left transition-all cursor-pointer ${formVisibility === "restricted" ? "border-brand-400 bg-brand-50" : "border-steel-200 hover:border-steel-300"}`}
                        >
                            <p className="text-sm font-bold text-steel-800">{t("bots.visibilityRestricted")}</p>
                            <p className="text-[11px] text-steel-400 mt-0.5">{t("bots.visibilityRestrictedDesc")}</p>
                        </button>
                    </div>

                    {formVisibility === "restricted" && (
                        <div className="mt-3">
                            <div className="mb-3">
                                <label className="block text-xs font-medium text-steel-600 mb-1">{t("bots.groupName")}</label>
                                <input
                                    type="text"
                                    value={formVisibilityLabel}
                                    onChange={(e) => setFormVisibilityLabel(e.target.value)}
                                    placeholder={t("bots.groupNamePlaceholder")}
                                    className="w-full max-w-xs px-3 py-2 bg-white border border-steel-200 rounded-xl text-sm text-steel-800 placeholder:text-steel-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all"
                                />
                                {/* Existing group suggestions */}
                                {(() => {
                                    const existingGroups = Array.from(
                                        new Map(
                                            bots
                                                .filter((b) => b.visibility === "restricted" && b.visibility_label && b.id !== editingBot?.id)
                                                .map((b) => [b.visibility_label!, b.visible_to] as [string, string[]])
                                        )
                                    );
                                    const suggestions = existingGroups.filter(([label]) => label !== formVisibilityLabel);
                                    if (suggestions.length === 0) return null;
                                    return (
                                        <div className="mt-2">
                                            <p className="text-[11px] text-steel-400 mb-1">{t("bots.existingGroups")}</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {suggestions.map(([label, members]) => (
                                                    <button
                                                        key={label}
                                                        type="button"
                                                        onClick={() => {
                                                            setFormVisibilityLabel(label);
                                                            setFormVisibleTo(members);
                                                            if (orgMembers.length === 0) loadMembers();
                                                        }}
                                                        className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full hover:bg-amber-100 transition-colors cursor-pointer"
                                                    >
                                                        <span>+</span> {label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    if (orgMembers.length === 0) loadMembers();
                                    setShowMemberModal(true);
                                }}
                                className="inline-flex items-center gap-1.5 bg-brand-400 text-steel-900 px-4 py-2 rounded-full text-sm font-bold hover:bg-brand-500 transition-colors cursor-pointer"
                            >
                                {t("bots.selectMembers")}
                            </button>
                            {formVisibleTo.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {formVisibleTo.map((uid) => {
                                        const member = orgMembers.find((m) => m.user_id === uid);
                                        return (
                                            <span key={uid} className="inline-flex items-center gap-1.5 text-xs font-medium bg-brand-50 text-brand-700 pl-3 pr-1.5 py-1.5 rounded-full border border-brand-200">
                                                {member ? (member.first_name || member.email) : uid.slice(0, 8) + "…"}
                                                <button
                                                    type="button"
                                                    onClick={() => setFormVisibleTo((prev) => prev.filter((id) => id !== uid))}
                                                    className="w-4 h-4 rounded-full bg-brand-200 text-brand-700 flex items-center justify-center hover:bg-brand-300 transition-colors cursor-pointer text-[10px]"
                                                >
                                                    ✕
                                                </button>
                                            </span>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Knowledge Link */}
                <div className="mb-6">
                {viewMode === "create" ? (
                    <div className="p-4 bg-steel-50 rounded-2xl border border-dashed border-steel-200">
                        <p className="text-sm font-bold text-steel-500">📄 {t("bots.knowledgeBase")}</p>
                        <p className="text-xs text-steel-400 mt-1">{t("bots.knowledgeCreateNote")}</p>
                    </div>
                ) : (
                  <>
                    <label className="block text-sm font-bold text-steel-800 mb-1">{t("bots.knowledgeBase")}</label>
                    <p className="text-xs text-steel-400 mb-3">
                        {t("bots.knowledgeBaseDesc")}
                    </p>
                    <button
                        onClick={() => {
                            if (editingBot) {
                                loadDocuments(editingBot.id);
                                setShowKnowledgeModal(true);
                            }
                        }}
                        className="inline-flex items-center gap-1.5 bg-brand-400 text-steel-900 px-4 py-2 rounded-full text-sm font-bold hover:bg-brand-500 transition-colors cursor-pointer"
                    >
                        {t("bots.selectKnowledge")}
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
                  </>
                )}
                </div>

                {/* Save Button */}
                <div className="flex gap-3 pt-4 border-t border-steel-100">
                    <button
                        onClick={handleSave}
                        disabled={saving || !formName.trim()}
                        className="bg-brand-400 text-steel-900 px-8 py-2.5 rounded-full text-sm font-bold hover:bg-brand-500 transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
                    >
                        {saving ? t("bots.saving") : viewMode === "create" ? t("bots.create") : t("common.save")}
                    </button>
                    <button
                        onClick={goBack}
                        className="px-6 py-2.5 text-steel-500 hover:text-steel-800 text-sm font-medium transition-colors cursor-pointer"
                    >
                        {t("common.cancel")}
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
                <div>
                    <h1 className="text-2xl font-bold text-steel-900">{t("bots.title")}</h1>
                    {bots.length > 0 && (
                        <p className="text-xs text-steel-400 mt-0.5">{t("bots.totalBots").replace("{n}", String(bots.length))}</p>
                    )}
                </div>
                <button
                    onClick={openCreate}
                    className="inline-flex items-center gap-1.5 bg-brand-400 text-steel-900 px-5 py-2.5 rounded-full text-sm font-bold hover:bg-brand-500 transition-colors cursor-pointer shadow-sm"
                >
                    {t("bots.createBot")}
                    <PlusIcon />
                </button>
            </div>

            {/* Search + Filter */}
            <div className="flex flex-col gap-3 mb-6">
                <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400">
                        <SearchIcon />
                    </span>
                    <input
                        type="text"
                        placeholder={t("bots.searchPlaceholder")}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full max-w-md pl-10 pr-4 py-2.5 bg-white border border-steel-200 rounded-xl text-sm text-steel-800 placeholder:text-steel-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition-all"
                    />
                </div>
                {visibilityGroups.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                            onClick={() => setVisibilityFilter(null)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                !visibilityFilter
                                    ? "bg-brand-400 text-steel-900"
                                    : "bg-steel-100 text-steel-600 hover:bg-steel-200"
                            }`}
                        >
                            {t("bots.filterAll")}
                        </button>
                        <button
                            onClick={() => setVisibilityFilter(visibilityFilter === "__all__" ? null : "__all__")}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                visibilityFilter === "__all__"
                                    ? "bg-blue-500 text-white"
                                    : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                            }`}
                        >
                            {t("bots.badgeAll")}
                        </button>
                        {visibilityGroups.map((group) => (
                            <button
                                key={group}
                                onClick={() => setVisibilityFilter(visibilityFilter === group ? null : group)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                    visibilityFilter === group
                                        ? "bg-amber-500 text-white"
                                        : "bg-amber-50 text-amber-600 hover:bg-amber-100"
                                }`}
                            >
                                {group}
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
                <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-dashed border-steel-200">
                    <div className="text-4xl mb-4">🤖</div>
                    <p className="text-sm text-steel-500 font-medium mb-1">
                        {searchQuery ? t("bots.noResults") : t("bots.empty")}
                    </p>
                    <p className="text-xs text-steel-400 mb-4">
                        {searchQuery ? t("bots.tryOther") : t("bots.createFirst")}
                    </p>
                    {!searchQuery && (
                        <button
                            onClick={openCreate}
                            className="text-sm text-brand-600 hover:text-brand-700 font-medium cursor-pointer"
                        >
                            {t("bots.createNew")}
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
                                                {t("bots.disabled")}
                                            </span>
                                        )}
                                        {bot.is_web_enabled && (
                                            <span className="text-[10px] font-medium bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">
                                                Web
                                            </span>
                                        )}
                                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${bot.visibility === "restricted" ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600"}`}>
                                            {bot.visibility === "restricted"
                                                ? (bot.visibility_label ? `${t("bots.badgeRestricted")}: ${bot.visibility_label}` : t("bots.badgeRestricted"))
                                                : t("bots.badgeAll")}
                                        </span>
                                    </div>
                                    <p className="text-xs text-steel-500 line-clamp-2">
                                        {bot.system_prompt || bot.description || t("bots.noDescription")}
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
                                            onClick={() => setDeleteConfirm(bot.id)}
                                            className="opacity-0 group-hover:opacity-100 text-steel-300 hover:text-red-500 transition-all cursor-pointer p-1"
                                            title={t("bots.deleteBot")}
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
