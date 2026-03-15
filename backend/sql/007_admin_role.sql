-- ============================================================================
-- 007: Add 'admin' role to chat_messages for Human Handoff
-- ============================================================================
-- Problem: Admin/support agents cannot send messages into chat sessions
--          because the role CHECK constraint only allows user/assistant/system.
-- Fix:     Add 'admin' role so human agents can reply to escalated sessions.
-- ============================================================================

ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_role_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_role_check
    CHECK (role IN ('user', 'assistant', 'system', 'admin'));
