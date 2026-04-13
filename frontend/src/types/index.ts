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
    slug?: string;
    status?: string;
    logo_url?: string | null;
    created_at: string;
    updated_at?: string;
}

/** Maps to user_profiles table — extends Supabase auth.users */
export type UserRole = "user" | "support" | "admin";
export type OrgRole = "admin" | "member";

export interface UserProfile {
    id: string;                         // maps to auth.users.id
    organization_id: string | null;     // DEPRECATED — use org_members
    email: string;                      // also in user_profiles table
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
    role: UserRole;
    is_approved: boolean;
    created_at: string;
}

// ── Organization Membership (many-to-many) ──────────────────────

export interface OrgMembership {
    id: string;
    name: string;
    slug?: string | null;
    logo_url?: string | null;
    org_role: OrgRole;
    created_at: string;
}

export interface OrgMember {
    user_id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
    role: string | null;  // platform role (admin/support/user)
    org_role: OrgRole;
    joined_at: string;
}

export interface OrgInvitation {
    id: string;
    organization_id: string;
    invited_email: string;
    invited_by: string;
    invited_by_email?: string | null;
    status: "pending" | "accepted" | "declined" | "expired" | "revoked";
    created_at: string;
}

export interface MyInvitation {
    id: string;
    organization_id: string;
    org_name: string;
    invited_email: string;
    status: "pending" | "accepted" | "revoked";
    created_at: string;
}

export interface PendingUser {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
    role: string;
    is_approved: boolean;
    created_at: string;
}

// ── Bot Management ──────────────────────────────────────────────

export interface Bot {
    id: string;
    organization_id: string;
    name: string;
    description: string | null;
    system_prompt: string | null;
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
    storage_bytes: number | null;       // actual DB storage (chunks + embeddings)
    mime_type: string | null;
    status: DocumentStatus;
    created_at: string;
}

// ── Chat ────────────────────────────────────────────────────────

export type PlatformSource = "line" | "web" | "other";
export type SessionStatus = "active" | "human_takeover" | "helped" | "resolved";

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

export interface SourceReference {
    document_id: string;
    document_name: string | null;
    chunk_index: number;
    page_start: number | null;
    page_end: number | null;
    score: number;
}

export interface ChatAskResponse {
    answer: string;
    sources: SourceReference[];
    session_id: string | null;
}

export interface DocumentUploadResponse {
    document_id: string;
    filename: string;
    total_parent_chunks: number;
    total_child_chunks: number;
    status: string;
}
