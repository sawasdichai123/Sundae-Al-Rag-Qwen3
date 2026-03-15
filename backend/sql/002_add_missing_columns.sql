-- ============================================================================
-- SUNDAE — Database Schema Migration 002
--
-- Adds missing columns to bots and chat_sessions tables
-- to align with the frontend TypeScript types.
--
-- ⚠️  Already applied to Supabase on 2026-02-28
--     This file is kept for documentation / fresh-install reference only.
-- ============================================================================

-- ── Bots: Add columns for LINE integration and web chat toggle ──────────
ALTER TABLE bots ADD COLUMN IF NOT EXISTS line_access_token TEXT;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS is_web_enabled BOOLEAN NOT NULL DEFAULT true;

-- ── Chat Sessions: Add status, platform_source, platform_user_id ────────
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'human_takeover', 'resolved'));
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS platform_source TEXT DEFAULT 'web';
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS platform_user_id TEXT;
