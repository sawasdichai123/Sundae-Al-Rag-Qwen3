"""
Unit tests for the Human Handoff feature.

Covers:
  - POST /api/chat/request-human      (User requests handoff)
  - POST /api/inbox/sessions/{id}/messages  (Admin sends reply)
  - GET  /api/inbox/sessions/{id}/messages/new (Poll new messages)

Uses mocked Supabase + auth dependency overrides.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.auth import CurrentUser, get_current_user, require_approved, require_role
from app.main import app

# ── Constants ───────────────────────────────────────────────────

FAKE_ORG_ID = "11111111-1111-1111-1111-111111111111"
FAKE_BOT_ID = "22222222-2222-2222-2222-222222222222"
FAKE_SESSION_ID = "33333333-3333-3333-3333-333333333333"
FAKE_USER_ID = "44444444-4444-4444-4444-444444444444"
FAKE_ADMIN_ID = "55555555-5555-5555-5555-555555555555"


# ── Fake Users ──────────────────────────────────────────────────

FAKE_USER = CurrentUser(
    id=FAKE_USER_ID,
    email="user@test.com",
    role="user",
    is_approved=True,
    organization_id=FAKE_ORG_ID,
    full_name="Test User",
)

FAKE_ADMIN = CurrentUser(
    id=FAKE_ADMIN_ID,
    email="admin@test.com",
    role="admin",
    is_approved=True,
    organization_id=FAKE_ORG_ID,
    full_name="Test Admin",
)

FAKE_SUPPORT = CurrentUser(
    id="66666666-6666-6666-6666-666666666666",
    email="support@test.com",
    role="support",
    is_approved=True,
    organization_id=FAKE_ORG_ID,
    full_name="Test Support",
)

FAKE_UNAPPROVED = CurrentUser(
    id="77777777-7777-7777-7777-777777777777",
    email="pending@test.com",
    role="user",
    is_approved=False,
    organization_id=FAKE_ORG_ID,
    full_name="Pending User",
)


# ── Helpers ─────────────────────────────────────────────────────

def _override_auth_as(user: CurrentUser):
    """Override all auth dependencies to return the given fake user."""

    async def _fake_get_current_user():
        return user

    async def _fake_require_approved():
        if not user.is_approved:
            from fastapi import HTTPException, status
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your account is pending approval.",
            )
        return user

    def _fake_require_role(*allowed_roles):
        async def _check():
            if not user.is_approved:
                from fastapi import HTTPException, status
                raise HTTPException(status_code=403, detail="Not approved.")
            if user.role not in allowed_roles:
                from fastapi import HTTPException, status
                raise HTTPException(status_code=403, detail="Insufficient role.")
            return user
        return _check

    app.dependency_overrides[get_current_user] = _fake_get_current_user
    app.dependency_overrides[require_approved] = _fake_require_approved

    # Override each role-check dependency that's actually used
    # Since require_role is a factory, we override the inner function instances
    # The cleanest approach: patch at module level in individual tests


def _clear_overrides():
    app.dependency_overrides.clear()


def _mock_supabase() -> MagicMock:
    """Create a mock Supabase client with chainable query builder."""
    mock_client = MagicMock()

    mock_response = MagicMock()
    mock_response.data = []

    # Make all chained methods return a new chainable mock
    def make_chain():
        chain = MagicMock()
        chain.execute = AsyncMock(return_value=mock_response)
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.gt.return_value = chain
        chain.limit.return_value = chain
        chain.order.return_value = chain
        chain.insert.return_value = chain
        chain.update.return_value = chain
        chain.upsert.return_value = chain
        chain.single.return_value = chain
        return chain

    mock_client.table.side_effect = lambda name: make_chain()
    return mock_client


# ── Test Client ─────────────────────────────────────────────────

client = TestClient(app, raise_server_exceptions=False)


# ═══════════════════════════════════════════════════════════════
# Tests for POST /api/chat/request-human
# ═══════════════════════════════════════════════════════════════

class TestRequestHuman:
    """Tests for the user-facing handoff request endpoint."""

    def setup_method(self):
        _override_auth_as(FAKE_USER)

    def teardown_method(self):
        _clear_overrides()

    @patch("app.routers.chat.get_supabase")
    def test_request_human_success(self, mock_get_sb):
        """Valid request → 200, status changes to human_takeover, system message inserted."""
        mock_sb = MagicMock()

        # Session exists
        session_response = MagicMock()
        session_response.data = [{"id": FAKE_SESSION_ID, "status": "active"}]

        # Update returns success
        update_response = MagicMock()
        update_response.data = [{"id": FAKE_SESSION_ID, "status": "human_takeover"}]

        # Insert system message
        insert_response = MagicMock()
        insert_response.data = [{"id": "msg-1"}]

        call_count = {"n": 0}
        def table_side_effect(name):
            chain = MagicMock()
            call_count["n"] += 1
            if name == "chat_sessions":
                if call_count["n"] == 1:
                    # First call: select to verify session
                    chain.select.return_value = chain
                    chain.eq.return_value = chain
                    chain.limit.return_value = chain
                    chain.execute = AsyncMock(return_value=session_response)
                else:
                    # Second call: update status
                    chain.update.return_value = chain
                    chain.eq.return_value = chain
                    chain.execute = AsyncMock(return_value=update_response)
            elif name == "chat_messages":
                chain.insert.return_value = chain
                chain.execute = AsyncMock(return_value=insert_response)
            return chain

        mock_sb.table.side_effect = table_side_effect
        mock_get_sb.return_value = mock_sb

        response = client.post(
            "/api/chat/request-human",
            json={
                "session_id": FAKE_SESSION_ID,
                "organization_id": FAKE_ORG_ID,
                "bot_id": FAKE_BOT_ID,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["new_status"] == "human_takeover"
        assert data["session_id"] == FAKE_SESSION_ID

    @patch("app.routers.chat.get_supabase")
    def test_request_human_session_not_found(self, mock_get_sb):
        """Session does not exist → 404."""
        mock_sb = MagicMock()
        empty_response = MagicMock()
        empty_response.data = []

        chain = MagicMock()
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.limit.return_value = chain
        chain.execute = AsyncMock(return_value=empty_response)
        mock_sb.table.return_value = chain
        mock_get_sb.return_value = mock_sb

        response = client.post(
            "/api/chat/request-human",
            json={
                "session_id": "nonexistent-session",
                "organization_id": FAKE_ORG_ID,
                "bot_id": FAKE_BOT_ID,
            },
        )

        assert response.status_code == 404

    def test_request_human_missing_fields(self):
        """Missing required fields → 422."""
        response = client.post(
            "/api/chat/request-human",
            json={"session_id": FAKE_SESSION_ID},
        )
        assert response.status_code == 422


# ═══════════════════════════════════════════════════════════════
# Tests for POST /api/inbox/sessions/{id}/messages (Admin Reply)
# ═══════════════════════════════════════════════════════════════

class TestAdminSendMessage:
    """Tests for admin sending messages into a session."""

    def setup_method(self):
        _override_auth_as(FAKE_ADMIN)

    def teardown_method(self):
        _clear_overrides()

    @patch("app.routers.inbox.get_supabase")
    def test_admin_send_message_success(self, mock_get_sb):
        """Admin sends reply → 200, message inserted with role=admin."""
        mock_sb = MagicMock()

        # Session exists and is human_takeover
        session_response = MagicMock()
        session_response.data = [{"id": FAKE_SESSION_ID, "status": "human_takeover"}]

        # Update last_message_at
        update_response = MagicMock()
        update_response.data = [{"id": FAKE_SESSION_ID}]

        # Insert message
        msg_id = str(uuid.uuid4())
        insert_response = MagicMock()
        insert_response.data = [{
            "id": msg_id,
            "session_id": FAKE_SESSION_ID,
            "organization_id": FAKE_ORG_ID,
            "role": "admin",
            "content": "สวัสดีครับ ผมมาช่วยคุณ",
            "metadata": {"sender_user_id": FAKE_ADMIN_ID, "sender_email": "admin@test.com"},
            "created_at": "2026-03-03T10:00:00Z",
        }]

        call_count = {"n": 0}
        def table_side_effect(name):
            chain = MagicMock()
            call_count["n"] += 1
            if name == "chat_sessions":
                if call_count["n"] == 1:
                    chain.select.return_value = chain
                    chain.eq.return_value = chain
                    chain.limit.return_value = chain
                    chain.execute = AsyncMock(return_value=session_response)
                else:
                    chain.update.return_value = chain
                    chain.eq.return_value = chain
                    chain.execute = AsyncMock(return_value=update_response)
            elif name == "chat_messages":
                chain.insert.return_value = chain
                chain.execute = AsyncMock(return_value=insert_response)
            return chain

        mock_sb.table.side_effect = table_side_effect
        mock_get_sb.return_value = mock_sb

        response = client.post(
            f"/api/inbox/sessions/{FAKE_SESSION_ID}/messages",
            json={"content": "สวัสดีครับ ผมมาช่วยคุณ"},
            params={"organization_id": FAKE_ORG_ID},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "admin"
        assert data["content"] == "สวัสดีครับ ผมมาช่วยคุณ"
        assert data["session_id"] == FAKE_SESSION_ID

    @patch("app.routers.inbox.get_supabase")
    def test_admin_send_empty_message_returns_400(self, mock_get_sb):
        """Empty content → 400."""
        response = client.post(
            f"/api/inbox/sessions/{FAKE_SESSION_ID}/messages",
            json={"content": "   "},
            params={"organization_id": FAKE_ORG_ID},
        )

        assert response.status_code == 400

    @patch("app.routers.inbox.get_supabase")
    def test_admin_send_to_nonexistent_session(self, mock_get_sb):
        """Session not found → 404."""
        mock_sb = MagicMock()
        empty_response = MagicMock()
        empty_response.data = []

        chain = MagicMock()
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.limit.return_value = chain
        chain.execute = AsyncMock(return_value=empty_response)
        mock_sb.table.return_value = chain
        mock_get_sb.return_value = mock_sb

        response = client.post(
            f"/api/inbox/sessions/nonexistent/messages",
            json={"content": "hello"},
            params={"organization_id": FAKE_ORG_ID},
        )

        assert response.status_code == 404

    @patch("app.routers.inbox.get_supabase")
    def test_admin_send_auto_escalates_active_session(self, mock_get_sb):
        """When session is 'active', sending admin message auto-sets to 'human_takeover'."""
        mock_sb = MagicMock()

        # Session is currently active
        session_response = MagicMock()
        session_response.data = [{"id": FAKE_SESSION_ID, "status": "active"}]

        update_response = MagicMock()
        update_response.data = [{"id": FAKE_SESSION_ID}]

        insert_response = MagicMock()
        insert_response.data = [{
            "id": "msg-new",
            "session_id": FAKE_SESSION_ID,
            "organization_id": FAKE_ORG_ID,
            "role": "admin",
            "content": "ผมช่วยได้ครับ",
            "metadata": {},
            "created_at": "2026-03-03T10:00:00Z",
        }]

        update_called_with = {}
        call_count = {"n": 0}
        def table_side_effect(name):
            chain = MagicMock()
            call_count["n"] += 1
            if name == "chat_sessions":
                if call_count["n"] == 1:
                    chain.select.return_value = chain
                    chain.eq.return_value = chain
                    chain.limit.return_value = chain
                    chain.execute = AsyncMock(return_value=session_response)
                else:
                    def capture_update(data):
                        update_called_with.update(data)
                        chain2 = MagicMock()
                        chain2.eq.return_value = chain2
                        chain2.execute = AsyncMock(return_value=update_response)
                        return chain2
                    chain.update.side_effect = capture_update
            elif name == "chat_messages":
                chain.insert.return_value = chain
                chain.execute = AsyncMock(return_value=insert_response)
            return chain

        mock_sb.table.side_effect = table_side_effect
        mock_get_sb.return_value = mock_sb

        response = client.post(
            f"/api/inbox/sessions/{FAKE_SESSION_ID}/messages",
            json={"content": "ผมช่วยได้ครับ"},
            params={"organization_id": FAKE_ORG_ID},
        )

        assert response.status_code == 200
        # Verify the update included status change
        assert update_called_with.get("status") == "human_takeover"


# ═══════════════════════════════════════════════════════════════
# Tests for GET /api/inbox/sessions/{id}/messages/new (Polling)
# ═══════════════════════════════════════════════════════════════

class TestPollNewMessages:
    """Tests for polling new messages (used by WebChat + Inbox auto-refresh)."""

    def setup_method(self):
        _override_auth_as(FAKE_USER)

    def teardown_method(self):
        _clear_overrides()

    @patch("app.routers.inbox.get_supabase")
    def test_poll_returns_new_messages(self, mock_get_sb):
        """Poll after timestamp → returns only newer messages."""
        mock_sb = MagicMock()
        poll_response = MagicMock()
        poll_response.data = [
            {
                "id": "msg-admin-1",
                "session_id": FAKE_SESSION_ID,
                "organization_id": FAKE_ORG_ID,
                "role": "admin",
                "content": "สวัสดีครับ",
                "metadata": {"sender_user_id": FAKE_ADMIN_ID},
                "created_at": "2026-03-03T10:01:00Z",
            },
        ]

        chain = MagicMock()
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.gt.return_value = chain
        chain.order.return_value = chain
        chain.execute = AsyncMock(return_value=poll_response)
        mock_sb.table.return_value = chain
        mock_get_sb.return_value = mock_sb

        response = client.get(
            f"/api/inbox/sessions/{FAKE_SESSION_ID}/messages/new",
            params={
                "organization_id": FAKE_ORG_ID,
                "after": "2026-03-03T10:00:00Z",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["role"] == "admin"
        assert data[0]["content"] == "สวัสดีครับ"

    @patch("app.routers.inbox.get_supabase")
    def test_poll_returns_empty_when_no_new(self, mock_get_sb):
        """No new messages → returns empty list."""
        mock_sb = MagicMock()
        empty_response = MagicMock()
        empty_response.data = []

        chain = MagicMock()
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.gt.return_value = chain
        chain.order.return_value = chain
        chain.execute = AsyncMock(return_value=empty_response)
        mock_sb.table.return_value = chain
        mock_get_sb.return_value = mock_sb

        response = client.get(
            f"/api/inbox/sessions/{FAKE_SESSION_ID}/messages/new",
            params={
                "organization_id": FAKE_ORG_ID,
                "after": "2026-03-03T12:00:00Z",
            },
        )

        assert response.status_code == 200
        assert response.json() == []

    def test_poll_missing_after_param_returns_422(self):
        """Missing 'after' query param → 422."""
        response = client.get(
            f"/api/inbox/sessions/{FAKE_SESSION_ID}/messages/new",
            params={"organization_id": FAKE_ORG_ID},
        )
        assert response.status_code == 422

    @patch("app.routers.inbox.get_supabase")
    def test_poll_returns_multiple_message_types(self, mock_get_sb):
        """Poll returns system + admin messages in order."""
        mock_sb = MagicMock()
        poll_response = MagicMock()
        poll_response.data = [
            {
                "id": "msg-sys-1",
                "session_id": FAKE_SESSION_ID,
                "organization_id": FAKE_ORG_ID,
                "role": "system",
                "content": "ผู้ใช้ขอพูดคุยกับเจ้าหน้าที่",
                "metadata": {},
                "created_at": "2026-03-03T10:00:01Z",
            },
            {
                "id": "msg-admin-1",
                "session_id": FAKE_SESSION_ID,
                "organization_id": FAKE_ORG_ID,
                "role": "admin",
                "content": "ยินดีให้บริการครับ",
                "metadata": {"sender_user_id": FAKE_ADMIN_ID},
                "created_at": "2026-03-03T10:00:30Z",
            },
        ]

        chain = MagicMock()
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.gt.return_value = chain
        chain.order.return_value = chain
        chain.execute = AsyncMock(return_value=poll_response)
        mock_sb.table.return_value = chain
        mock_get_sb.return_value = mock_sb

        response = client.get(
            f"/api/inbox/sessions/{FAKE_SESSION_ID}/messages/new",
            params={
                "organization_id": FAKE_ORG_ID,
                "after": "2026-03-03T10:00:00Z",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["role"] == "system"
        assert data[1]["role"] == "admin"


# ═══════════════════════════════════════════════════════════════
# Tests for Authorization / Access Control
# ═══════════════════════════════════════════════════════════════

class TestHandoffAuthorization:
    """Verify that only appropriate roles can access handoff endpoints."""

    def teardown_method(self):
        _clear_overrides()

    def test_unapproved_user_cannot_request_human(self):
        """Unapproved user → 403."""
        _override_auth_as(FAKE_UNAPPROVED)

        response = client.post(
            "/api/chat/request-human",
            json={
                "session_id": FAKE_SESSION_ID,
                "organization_id": FAKE_ORG_ID,
                "bot_id": FAKE_BOT_ID,
            },
        )

        assert response.status_code == 403

    @patch("app.routers.inbox.get_supabase")
    def test_regular_user_can_poll_messages(self, mock_get_sb):
        """Regular approved user can poll for new messages (needed for WebChat)."""
        _override_auth_as(FAKE_USER)

        mock_sb = MagicMock()
        empty_response = MagicMock()
        empty_response.data = []
        chain = MagicMock()
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.gt.return_value = chain
        chain.order.return_value = chain
        chain.execute = AsyncMock(return_value=empty_response)
        mock_sb.table.return_value = chain
        mock_get_sb.return_value = mock_sb

        response = client.get(
            f"/api/inbox/sessions/{FAKE_SESSION_ID}/messages/new",
            params={
                "organization_id": FAKE_ORG_ID,
                "after": "2026-03-03T10:00:00Z",
            },
        )

        # User role with require_approved → should work
        assert response.status_code == 200
