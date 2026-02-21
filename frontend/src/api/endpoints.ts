/**
 * SUNDAE Frontend — API Endpoint Definitions
 *
 * Centralized API calls matching the FastAPI backend endpoints.
 * Updated for Omnichannel support (Web + LINE).
 */

import apiClient from "./axios";
import type {
    Bot,
    ChatAskResponse,
    Document,
    DocumentUploadResponse,
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

    /** Stream a response from the RAG pipeline via SSE. */
    askStream: async (
        params: ChatAskParams,
        onToken: (token: string) => void,
        onSources: (sources: Array<{ document_id: string; chunk_index: number; score: number }>) => void,
        onDone: () => void,
        onError: (error: string) => void,
    ) => {
        const { supabase } = await import("./supabaseClient");
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
            onError("Not authenticated");
            return;
        }

        const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
        const response = await fetch(`${baseUrl}/api/chat/ask/stream`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
            },
            body: JSON.stringify({
                user_query: params.userQuery,
                organization_id: params.organizationId,
                bot_id: params.botId,
                platform_user_id: params.platformUserId,
                platform_source: params.platformSource || "web",
                session_id: params.sessionId,
            }),
        });

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

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

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
                        onDone();
                    }
                } catch { /* skip malformed */ }
            }
        }
        onDone();
    },

    /** User requests a human agent to take over the session. */
    requestHuman: (sessionId: string, organizationId: string, botId: string) =>
        apiClient.post("/api/chat/request-human", {
            session_id: sessionId,
            organization_id: organizationId,
            bot_id: botId,
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
    listSessions: (organizationId: string) =>
        apiClient.get("/api/inbox/sessions", {
            params: { organization_id: organizationId },
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
};
