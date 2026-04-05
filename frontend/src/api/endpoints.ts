/**
 * SUNDAE Frontend — API Endpoint Definitions
 *
 * Centralized API calls matching the FastAPI backend endpoints.
 * Updated for Omnichannel support (Web + LINE).
 */

import apiClient, { getValidToken, refreshTokenOnce } from "./axios";
import type {
    Bot,
    ChatAskResponse,
    Document,
    DocumentUploadResponse,
    OrgInvitation,
    OrgMember,
    SourceReference,
    OrgMembership,
    MyInvitation,
    PendingUser,
    PlatformSource,
} from "../types";

// ── Documents ───────────────────────────────────────────────────

export const documentsApi = {
    /** Upload a PDF document for processing. */
    upload: (file: File, botId: string | null, organizationId: string) => {
        const formData = new FormData();
        formData.append("file", file);
        if (botId) formData.append("bot_id", botId);
        formData.append("organization_id", organizationId);

        return apiClient.post<DocumentUploadResponse>(
            "/api/documents/upload",
            formData,
            {
                headers: { "Content-Type": "multipart/form-data" },
                timeout: 300_000, // PDF parsing + chunking + embedding อาจใช้เวลา 5 นาที
            }
        );
    },

    /** List all documents for an organization. */
    list: (organizationId: string) =>
        apiClient.get<Document[]>("/api/documents", {
            params: { organization_id: organizationId },
        }),

    /** Get document status by ID. */
    getStatus: (documentId: string, organizationId: string) =>
        apiClient.get<Document>(`/api/documents/${documentId}`, {
            params: { organization_id: organizationId },
        }),

    /** Delete a document. */
    delete: (documentId: string, organizationId: string) =>
        apiClient.delete(`/api/documents/${documentId}`, {
            params: { organization_id: organizationId },
        }),

    /** Link or unlink a document to/from a bot. */
    linkBot: (documentId: string, organizationId: string, botId: string | null) =>
        apiClient.patch(`/api/documents/${documentId}/link-bot`, null, {
            params: { organization_id: organizationId, bot_id: botId },
        }),
};

// ── Chat (Omnichannel) ──────────────────────────────────────────

export interface ChatAskParams {
    userQuery: string;
    organizationId: string;
    botId: string;
    platformUserId: string;
    platformSource?: PlatformSource;
    sessionId?: string;
}

export const chatApi = {
    /** Send a question to the RAG pipeline (omnichannel). */
    ask: ({
        userQuery,
        organizationId,
        botId,
        platformUserId,
        platformSource = "web",
        sessionId,
    }: ChatAskParams) =>
        apiClient.post<ChatAskResponse>("/api/chat/ask", {
            user_query: userQuery,
            organization_id: organizationId,
            bot_id: botId,
            platform_user_id: platformUserId,
            platform_source: platformSource,
            session_id: sessionId,
        }, {
            timeout: 300_000,
        }),

    /** Stream a response from the RAG pipeline via SSE.
     *  Returns an AbortController so the caller can cancel the request. */
    askStream: (
        params: ChatAskParams,
        onToken: (token: string) => void,
        onSources: (sources: SourceReference[]) => void,
        onDone: () => void,
        onError: (error: string) => void,
    ): AbortController => {
        // Create controller upfront so caller can abort before the async work starts
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90_000);

        // Fire-and-forget the async work (outer try/catch guarantees onError is always called)
        (async () => {
            try {
                if (controller.signal.aborted) {
                    onError("ยกเลิกคำขอแล้ว");
                    return;
                }

                console.log("[askStream] Step 1: getting valid token");

                // Get token — uses shared getValidToken() which auto-refreshes if near expiry
                const token = await getValidToken();
                console.log("[askStream] Step 1 done, token:", token ? "YES" : "NO");

                if (!token) {
                    try {
                        const { useToastStore } = await import("../store/toastStore");
                        useToastStore.getState().addToast(
                            "warning",
                            "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
                            8000,
                        );
                    } catch { /* ignore if toast not available */ }
                    await new Promise((r) => setTimeout(r, 1500));
                    window.location.href = "/login";
                    onError("Not authenticated");
                    return;
                }

                if (controller.signal.aborted) {
                    onError("ยกเลิกคำขอแล้ว");
                    return;
                }

                console.log("[askStream] Sending fetch to", import.meta.env.VITE_API_BASE_URL);
                const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8001";

                const payload = {
                    user_query: params.userQuery,
                    organization_id: params.organizationId,
                    bot_id: params.botId,
                    platform_user_id: params.platformUserId,
                    platform_source: params.platformSource || "web",
                    session_id: params.sessionId,
                };

                const doFetch = async (accessToken: string) => {
                    const headers: Record<string, string> = {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${accessToken}`,
                    };
                    try {
                        const activeOrgId = localStorage.getItem("sundae_active_org_id");
                        if (activeOrgId) headers["X-Active-Org"] = activeOrgId;
                    } catch { /* ignore */ }
                    return await fetch(`${baseUrl}/api/chat/ask/stream`, {
                        method: "POST",
                        headers,
                        body: JSON.stringify(payload),
                        signal: controller.signal,
                    });
                };

                let response = await doFetch(token);

                // Retry once on 401 (expired access token) — align behavior with axios interceptor
                if (response.status === 401) {
                    const freshToken = await refreshTokenOnce();
                    if (!freshToken) {
                        try {
                            const { useToastStore } = await import("../store/toastStore");
                            useToastStore.getState().addToast(
                                "warning",
                                "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
                                8000,
                            );
                        } catch { /* ignore if toast not available */ }
                        // Small delay so the toast is visible before redirect
                        await new Promise((r) => setTimeout(r, 1500));
                        window.location.href = "/login";
                        onError("Session expired (401)");
                        return;
                    }
                    response = await doFetch(freshToken);
                }

                if (!response.ok) {
                    onError(`HTTP ${response.status}`);
                    return;
                }

                const reader = response.body?.getReader();
                if (!reader) {
                    onError("No response body");
                    return;
                }

                const decoder = new TextDecoder();
                let buffer = "";
                let doneSignaled = false;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    clearTimeout(timeoutId);

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || "";

                    for (const line of lines) {
                        if (!line.startsWith("data: ")) continue;
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.type === "token") {
                                onToken(data.content);
                            } else if (data.type === "sources") {
                                onSources(data.sources);
                            } else if (data.type === "done") {
                                doneSignaled = true;
                                onDone();
                            }
                        } catch { /* skip malformed */ }
                    }
                }
                if (!doneSignaled) onDone();
            } catch (err: unknown) {
                console.error("[askStream] Error:", err);
                if (err instanceof Error && err.name === "AbortError") {
                    onError("ยกเลิกคำขอแล้ว");
                } else {
                    onError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
                }
            } finally {
                clearTimeout(timeoutId);
            }
        })();

        return controller;
    },

    /** User requests a human agent to take over the session. */
    requestHuman: (sessionId: string, organizationId: string, botId: string) =>
        apiClient.post("/api/chat/request-human", {
            session_id: sessionId,
            organization_id: organizationId,
            bot_id: botId,
        }),

    /** User cancels a pending human handoff request. */
    cancelHuman: (sessionId: string, organizationId: string) =>
        apiClient.post("/api/chat/cancel-human", {
            session_id: sessionId,
            organization_id: organizationId,
        }),

    /** Send a plain user message (no RAG) — used during human_takeover. */
    sendMessage: (sessionId: string, organizationId: string, content: string) =>
        apiClient.post("/api/chat/send-message", {
            session_id: sessionId,
            organization_id: organizationId,
            content,
        }),
};

// ── Bots ────────────────────────────────────────────────────────

export const botsApi = {
    /** Create a new bot. */
    create: (data: {
        name: string;
        organization_id: string;
        description?: string;
        system_prompt?: string;
        is_web_enabled?: boolean;
    }) => apiClient.post<Bot>("/api/bots", data),

    /** List all bots for an organization. */
    list: (organizationId: string) =>
        apiClient.get<Bot[]>("/api/bots", {
            params: { organization_id: organizationId },
        }),

    /** Get a single bot. */
    get: (botId: string, organizationId: string) =>
        apiClient.get<Bot>(`/api/bots/${botId}`, {
            params: { organization_id: organizationId },
        }),

    /** Update bot fields. */
    update: (botId: string, organizationId: string, data: Partial<Bot>) =>
        apiClient.put<Bot>(`/api/bots/${botId}`, data, {
            params: { organization_id: organizationId },
        }),

    /** Delete a bot. */
    delete: (botId: string, organizationId: string) =>
        apiClient.delete(`/api/bots/${botId}`, {
            params: { organization_id: organizationId },
        }),
};

// ── Inbox ───────────────────────────────────────────────────────

export const inboxApi = {
    /** List chat sessions for an organization. */
    listSessions: (organizationId: string, page = 1, pageSize = 20) =>
        apiClient.get("/api/inbox/sessions", {
            params: { organization_id: organizationId, page, page_size: pageSize },
        }),

    /** Get messages for a specific session. */
    getMessages: (sessionId: string, organizationId: string) =>
        apiClient.get(`/api/inbox/sessions/${sessionId}/messages`, {
            params: { organization_id: organizationId },
        }),

    /** Update session status. */
    updateStatus: (sessionId: string, organizationId: string, status: string) =>
        apiClient.put(
            `/api/inbox/sessions/${sessionId}/status`,
            { status },
            { params: { organization_id: organizationId } }
        ),

    /** Admin sends a reply message into a session. */
    sendMessage: (sessionId: string, organizationId: string, content: string) =>
        apiClient.post(
            `/api/inbox/sessions/${sessionId}/messages`,
            { content },
            { params: { organization_id: organizationId } }
        ),

    /** Poll for new messages after a given timestamp. */
    getNewMessages: (sessionId: string, organizationId: string, after: string) =>
        apiClient.get(`/api/inbox/sessions/${sessionId}/messages/new`, {
            params: { organization_id: organizationId, after },
        }),

    /** List current user's own chat sessions (any approved role). */
    mySessions: (organizationId: string) =>
        apiClient.get("/api/inbox/my-sessions", {
            params: { organization_id: organizationId },
        }),
};

// ── Admin (User Approval) ────────────────────────────────────────

export const adminApi = {
    /** List pending (unapproved) users. */
    listPending: () =>
        apiClient.get<PendingUser[]>("/api/admin/pending-users"),

    /** Approve a user — just sets is_approved=true. */
    approve: (userId: string) =>
        apiClient.post<{ message: string; user_id: string }>(
            `/api/admin/approve/${userId}`
        ),

    /** Reject a pending user. */
    reject: (userId: string) =>
        apiClient.post<{ message: string; user_id: string }>(
            `/api/admin/reject/${userId}`
        ),
};

// ── Organizations (Multi-tenant) ────────────────────────────────

export const orgApi = {
    /** Create a new organization. First invited user becomes Org Admin. */
    create: (name: string) =>
        apiClient.post<{ id: string; name: string; slug: string }>("/api/orgs", { name }),

    /** List user's organizations (via org_members). */
    list: () =>
        apiClient.get<OrgMembership[]>("/api/orgs"),

    /** Get organization details. */
    get: (orgId: string) =>
        apiClient.get<{ id: string; name: string; slug: string; status: string; created_at: string }>(
            `/api/orgs/${orgId}`
        ),

    /** Update organization name. */
    update: (orgId: string, name: string) =>
        apiClient.put(`/api/orgs/${orgId}`, { name }),

    /** Request organization deletion. */
    requestDeletion: (orgId: string) =>
        apiClient.post(`/api/orgs/${orgId}/request-deletion`),

    /** Confirm organization deletion (other party). */
    confirmDeletion: (orgId: string) =>
        apiClient.post(`/api/orgs/${orgId}/confirm-deletion`),

    /** List members of an organization. */
    listMembers: (orgId: string) =>
        apiClient.get<OrgMember[]>(`/api/orgs/${orgId}/members`),

    /** Invite a user by email. */
    invite: (orgId: string, email: string) =>
        apiClient.post<OrgInvitation>(`/api/orgs/${orgId}/invite`, { email }),

    /** Remove a member from an organization. */
    removeMember: (orgId: string, userId: string) =>
        apiClient.delete(`/api/orgs/${orgId}/members/${userId}`),

    /** List invitations sent to current user. */
    myInvitations: () =>
        apiClient.get<MyInvitation[]>("/api/orgs/invitations"),

    /** Accept an invitation. */
    acceptInvitation: (invitationId: string) =>
        apiClient.post(`/api/orgs/invitations/${invitationId}/accept`),

    /** Decline an invitation. */
    declineInvitation: (invitationId: string) =>
        apiClient.post(`/api/orgs/invitations/${invitationId}/decline`),

    /** Leave an organization. Last Org Admin cannot leave. */
    leave: (orgId: string) =>
        apiClient.post(`/api/orgs/${orgId}/leave`),

    /** Promote a member to Org Admin. */
    promoteMember: (orgId: string, userId: string) =>
        apiClient.post(`/api/orgs/${orgId}/members/${userId}/promote`),

    /** Demote an Org Admin to member. */
    demoteMember: (orgId: string, userId: string) =>
        apiClient.post(`/api/orgs/${orgId}/members/${userId}/demote`),

    /** Cancel pending deletion request. */
    cancelDeletion: (orgId: string) =>
        apiClient.post(`/api/orgs/${orgId}/cancel-deletion`),

    /** Update current user's profile (name + avatar). */
    updateProfile: (firstName: string, lastName: string, avatarUrl?: string | null) =>
        apiClient.put<{ first_name: string | null; last_name: string | null; avatar_url: string | null; email: string }>(
            "/api/orgs/profile/me",
            { first_name: firstName, last_name: lastName, ...(avatarUrl !== undefined ? { avatar_url: avatarUrl } : {}) },
        ),

    /** Get LINE integration config for an org. */
    getLineConfig: (orgId: string) =>
        apiClient.get<{ is_line_enabled: boolean; has_credentials: boolean; webhook_url: string }>(
            `/api/orgs/${orgId}/line-config`
        ),

    /** Update LINE integration credentials / toggle. */
    updateLineConfig: (orgId: string, data: {
        line_channel_secret?: string;
        line_access_token?: string;
        is_line_enabled?: boolean;
    }) =>
        apiClient.put<{ is_line_enabled: boolean; has_credentials: boolean; webhook_url: string }>(
            `/api/orgs/${orgId}/line-config`,
            data,
        ),
};
