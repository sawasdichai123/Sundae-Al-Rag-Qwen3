/**
 * SUNDAE Frontend — TypeScript Interfaces
 *
 * Synced with the current Database Schema.
 * Source of truth: user_profiles (3-tier roles), bots (is_web_enabled),
 * chat_sessions (platform_source, platform_user_id, status).
 */

// ── Identity ────────────────────────────────────────────────────

export interface Organization {
    id: string;
    name: string;
    created_at: string;
}

/** Maps to user_profiles table — extends Supabase auth.users */
export type UserRole = "user" | "support" | "admin";

export interface UserProfile {
    id: string;                         // maps to auth.users.id
    organization_id: string | null;     // nullable until assigned
    email: string;                      // also in user_profiles table
    full_name: string | null;
    role: UserRole;
    is_approved: boolean;
    created_at: string;
}

// ── Bot Management ──────────────────────────────────────────────

export interface Bot {
    id: string;
    organization_id: string;
    name: string;
    description: string | null;
    prompt: string;                     // renamed from system_prompt
    system_prompt: string | null;       // backend alias
    line_access_token: string | null;
    is_active: boolean;
    is_web_enabled: boolean;
    created_at: string;
    updated_at: string;
}

// ── Knowledge Base ──────────────────────────────────────────────

export type DocumentStatus = "pending" | "processing" | "ready" | "error";

export interface Document {
    id: string;
    organization_id: string;
    bot_id: string | null;
    name: string;                       // renamed from filename
    file_path: string | null;
    file_size_bytes: number | null;
    mime_type: string | null;
    status: DocumentStatus;
    created_at: string;
}

// ── Chat ────────────────────────────────────────────────────────

export type PlatformSource = "line" | "web" | "other";
export type SessionStatus = "active" | "human_takeover" | "resolved";

export interface ChatSession {
    id: string;
    organization_id: string;
    bot_id: string | null;
    platform_user_id: string | null;
    platform_source: PlatformSource;
    status: SessionStatus;
    started_at: string;
    last_message_at: string;
}

export type MessageRole = "user" | "assistant" | "system" | "admin";

export interface ChatMessage {
    id: string;
    session_id: string;
    organization_id: string;
    role: MessageRole;
    content: string;
    metadata: Record<string, unknown>;
    created_at: string;
}

// ── API Responses ───────────────────────────────────────────────

export interface ChatAskResponse {
    answer: string;
    sources: Array<{
        document_id: string;
        chunk_index: number;
        score: number;
    }>;
    session_id: string | null;
}

export interface DocumentUploadResponse {
    document_id: string;
    filename: string;
    total_parent_chunks: number;
    total_child_chunks: number;
    status: string;
}
