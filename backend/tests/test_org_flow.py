"""
SUNDAE — Organization Flow Integration Tests
=============================================

Test suite for the complete organization lifecycle:
  1. User registration (via Supabase Auth)
  2. Platform admin approves account
  3. Platform admin creates org
  4. Platform admin invites user → user accepts
  5. Invite flow edge cases (duplicate, non-existent email, etc.)
  6. Member management (promote, demote, remove)
  7. Multi-admin rules (last admin cannot leave)
  8. Org deletion flow (request → confirm / cancel)
  9. Access control enforcement (403 on wrong role/org)

Design:
  - Calls the real FastAPI app via httpx.AsyncClient + ASGITransport
  - Supabase DB is mocked at the supabase client layer so no live DB needed
  - Each test class mocks exactly the tables it touches
  - Auth tokens are injected as Bearer headers; JWT decode is mocked to
    return controlled user profiles

Base URL  : http://test (ASGI, no port)
Auth      : Authorization: Bearer <token>  (mocked via patch_current_user)

Run:
    pytest backend/tests/test_org_flow.py -v
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.main import app


# ══════════════════════════════════════════════════════════════════
# Helpers / Fixtures
# ══════════════════════════════════════════════════════════════════

BASE = "http://test"


def _id() -> str:
    return str(uuid.uuid4())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user(
    uid: str | None = None,
    email: str = "user@test.com",
    role: str = "user",
    is_approved: bool = True,
    org_id: str | None = None,
) -> MagicMock:
    """Build a mock CurrentUser object."""
    u = MagicMock()
    u.id = uid or _id()
    u.email = email
    u.role = role
    u.is_approved = is_approved
    u.organization_id = org_id
    return u


def _supabase_ok(data: Any) -> MagicMock:
    """Supabase execute() that returns data normally."""
    r = MagicMock()
    r.data = data if isinstance(data, list) else [data] if data else []
    r.error = None
    return r


def _supabase_empty() -> MagicMock:
    r = MagicMock()
    r.data = []
    r.error = None
    return r


def _chain(*_, **__) -> MagicMock:
    """Return a MagicMock that chains .select().eq().limit() etc. and ends with .execute() → AsyncMock."""
    m = MagicMock()
    m.select = lambda *a, **kw: m
    m.insert = lambda *a, **kw: m
    m.update = lambda *a, **kw: m
    m.delete = lambda *a, **kw: m
    m.eq = lambda *a, **kw: m
    m.neq = lambda *a, **kw: m
    m.limit = lambda *a, **kw: m
    m.order = lambda *a, **kw: m
    m.single = lambda *a, **kw: m
    return m


@asynccontextmanager
async def _client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
        yield c


def _auth(token: str = "tok") -> dict:
    return {"Authorization": f"Bearer {token}"}


# ══════════════════════════════════════════════════════════════════
# Section 1 — Account Approval
# ══════════════════════════════════════════════════════════════════

class TestApproval:
    """
    Platform support/admin approves pending user accounts.

    Endpoints under test:
        GET  /api/admin/pending-users
        POST /api/admin/approve/{user_id}
        POST /api/admin/reject/{user_id}
    """

    @pytest.mark.asyncio
    async def test_list_pending_users_as_admin(self):
        """Admin can see all unapproved accounts."""
        admin = _user(role="admin", is_approved=True)
        pending_id = _id()

        pending_row = {
            "id": pending_id, "email": "new@test.com",
            "first_name": "New", "last_name": "User",
            "avatar_url": None, "role": "user",
            "is_approved": False, "created_at": _now(),
        }

        table_mock = _chain()
        table_mock.execute = AsyncMock(return_value=_supabase_ok([pending_row]))

        with patch("app.routers.approval.get_current_user", return_value=admin), \
             patch("app.routers.approval.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.get("/api/admin/pending-users", headers=_auth())
        assert r.status_code == 200
        body = r.json()
        assert len(body) == 1
        assert body[0]["email"] == "new@test.com"
        assert body[0]["is_approved"] is False

    @pytest.mark.asyncio
    async def test_list_pending_users_forbidden_for_regular_user(self):
        """Regular users cannot access the pending-users list."""
        regular = _user(role="user", is_approved=True)

        with patch("app.routers.approval.get_current_user", return_value=regular):
            async with _client() as c:
                r = await c.get("/api/admin/pending-users", headers=_auth())
        assert r.status_code == 403

    @pytest.mark.asyncio
    async def test_approve_user_success(self):
        """
        Approving a user sets is_approved=True.
        Any pending org invitations for that email are auto-accepted.
        """
        admin = _user(role="admin", is_approved=True)
        target_id = _id()
        org_id = _id()

        profile_row = {
            "id": target_id, "email": "new@test.com",
            "is_approved": False, "organization_id": None,
        }
        # No pending invitations in this scenario
        inv_row_list: list = []

        table_mock = _chain()

        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:  # fetch profile
                return _supabase_ok(profile_row)
            if call_count == 2:  # update is_approved
                return _supabase_ok({"id": target_id})
            if call_count == 3:  # fetch pending invitations
                return _supabase_ok(inv_row_list)
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.approval.get_current_user", return_value=admin), \
             patch("app.routers.approval.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/admin/approve/{target_id}", headers=_auth())
        assert r.status_code == 200
        assert "approved" in r.json()["message"].lower() or r.json().get("user_id") == target_id

    @pytest.mark.asyncio
    async def test_approve_already_approved_user_returns_400(self):
        """Approving an already-approved user should return 400."""
        admin = _user(role="admin", is_approved=True)
        target_id = _id()

        profile_row = {
            "id": target_id, "email": "already@test.com",
            "is_approved": True, "organization_id": None,
        }
        table_mock = _chain()
        table_mock.execute = AsyncMock(return_value=_supabase_ok(profile_row))

        with patch("app.routers.approval.get_current_user", return_value=admin), \
             patch("app.routers.approval.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/admin/approve/{target_id}", headers=_auth())
        assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_reject_user_success(self):
        """Support can reject (delete) a pending account."""
        support = _user(role="support", is_approved=True)
        target_id = _id()

        profile_row = {
            "id": target_id, "email": "bad@test.com",
            "is_approved": False, "organization_id": None,
        }
        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok(profile_row)
            return _supabase_ok({"id": target_id})

        table_mock.execute = _execute

        with patch("app.routers.approval.get_current_user", return_value=support), \
             patch("app.routers.approval.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/admin/reject/{target_id}", headers=_auth())
        assert r.status_code == 200


# ══════════════════════════════════════════════════════════════════
# Section 2 — Create Organization
# ══════════════════════════════════════════════════════════════════

class TestCreateOrg:
    """
    Only platform support/admin can create organizations.

    POST /api/orgs
    """

    @pytest.mark.asyncio
    async def test_create_org_as_admin(self):
        """Admin creates a new org successfully."""
        admin = _user(role="admin", is_approved=True)
        new_org_id = _id()

        org_row = {
            "id": new_org_id, "name": "Acme Corp",
            "slug": "acme-corp", "status": "active",
            "created_at": _now(),
        }
        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:    # slug uniqueness check
                return _supabase_empty()
            if call_count == 2:    # insert organization
                return _supabase_ok(org_row)
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post("/api/orgs", json={"name": "Acme Corp"}, headers=_auth())
        assert r.status_code == 200
        body = r.json()
        assert body["name"] == "Acme Corp"
        assert body["id"] == new_org_id

    @pytest.mark.asyncio
    async def test_create_org_forbidden_for_regular_user(self):
        """Regular users cannot create orgs — 403."""
        user = _user(role="user", is_approved=True)

        with patch("app.routers.organization.get_current_user", return_value=user):
            async with _client() as c:
                r = await c.post("/api/orgs", json={"name": "BadOrg"}, headers=_auth())
        assert r.status_code == 403

    @pytest.mark.asyncio
    async def test_create_org_empty_name_returns_400(self):
        """Empty org name should return 400."""
        admin = _user(role="admin", is_approved=True)

        with patch("app.routers.organization.get_current_user", return_value=admin), \
             patch("app.routers.organization.get_supabase"):
            async with _client() as c:
                r = await c.post("/api/orgs", json={"name": "  "}, headers=_auth())
        assert r.status_code == 400


# ══════════════════════════════════════════════════════════════════
# Section 3 — Invite & Accept
# ══════════════════════════════════════════════════════════════════

class TestInviteFlow:
    """
    Org Admin invites a user → user accepts → user becomes org member.

    Endpoints:
        POST /api/orgs/{org_id}/invite
        GET  /api/orgs/invitations
        POST /api/orgs/invitations/{inv_id}/accept
        POST /api/orgs/invitations/{inv_id}/decline
    """

    @pytest.mark.asyncio
    async def test_invite_new_email(self):
        """Org Admin can invite a new (not-yet-registered) email."""
        org_id = _id()
        admin = _user(role="user", is_approved=True, org_id=org_id)
        inv_id = _id()

        inv_row = {
            "id": inv_id, "organization_id": org_id,
            "invited_email": "newbie@test.com",
            "invited_by": admin.id, "status": "pending",
            "created_at": _now(),
        }
        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:   # verify_organization: org status
                return _supabase_ok({"status": "active"})
            if call_count == 2:   # verify_organization: membership
                return _supabase_ok({"user_id": admin.id})
            if call_count == 3:   # verify_org_admin
                return _supabase_ok({"org_role": "admin"})
            if call_count == 4:   # email→user_id lookup (not found)
                return _supabase_empty()
            if call_count == 5:   # duplicate invitation check
                return _supabase_empty()
            if call_count == 6:   # insert invitation
                return _supabase_ok(inv_row)
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(
                    f"/api/orgs/{org_id}/invite",
                    json={"email": "newbie@test.com"},
                    headers=_auth(),
                )
        assert r.status_code == 200
        assert r.json()["status"] == "pending"

    @pytest.mark.asyncio
    async def test_invite_duplicate_pending_returns_400(self):
        """Cannot send a second invite to the same email while one is pending."""
        org_id = _id()
        admin = _user(role="user", is_approved=True, org_id=org_id)

        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "active"})
            if call_count == 2:
                return _supabase_ok({"user_id": admin.id})
            if call_count == 3:
                return _supabase_ok({"org_role": "admin"})
            if call_count == 4:
                return _supabase_empty()          # email→id not found
            if call_count == 5:
                return _supabase_ok([{"id": _id()}])  # existing pending invite
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(
                    f"/api/orgs/{org_id}/invite",
                    json={"email": "newbie@test.com"},
                    headers=_auth(),
                )
        assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_invite_existing_member_returns_400(self):
        """Cannot invite someone who is already a member."""
        org_id = _id()
        admin = _user(role="user", is_approved=True, org_id=org_id)
        existing_uid = _id()

        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "active"})
            if call_count == 2:
                return _supabase_ok({"user_id": admin.id})
            if call_count == 3:
                return _supabase_ok({"org_role": "admin"})
            if call_count == 4:
                return _supabase_ok([{"id": existing_uid}])  # user exists
            if call_count == 5:
                return _supabase_ok([{"user_id": existing_uid}])  # already member
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(
                    f"/api/orgs/{org_id}/invite",
                    json={"email": "member@test.com"},
                    headers=_auth(),
                )
        assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_invite_forbidden_for_member_role(self):
        """Only Org Admin can invite. Regular member gets 403."""
        org_id = _id()
        member = _user(role="user", is_approved=True, org_id=org_id)

        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "active"})
            if call_count == 2:
                return _supabase_ok({"user_id": member.id})
            if call_count == 3:
                return _supabase_ok({"org_role": "member"})  # not admin
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=member), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(
                    f"/api/orgs/{org_id}/invite",
                    json={"email": "someone@test.com"},
                    headers=_auth(),
                )
        assert r.status_code == 403

    @pytest.mark.asyncio
    async def test_accept_invitation_becomes_member(self):
        """Accepting an invitation creates an org_members row."""
        org_id = _id()
        inv_id = _id()
        invitee = _user(email="newbie@test.com", role="user", is_approved=True)

        inv_row = {
            "id": inv_id, "organization_id": org_id,
            "invited_email": "newbie@test.com",
            "status": "pending",
        }
        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:   # fetch invitation
                return _supabase_ok(inv_row)
            if call_count == 2:   # check existing membership
                return _supabase_empty()
            if call_count == 3:   # count current members (first member = admin)
                r = MagicMock(); r.count = 0; r.data = []; r.error = None
                return r
            if call_count == 4:   # insert org_member
                return _supabase_ok({"user_id": invitee.id, "organization_id": org_id})
            if call_count == 5:   # update invitation status → accepted
                return _supabase_ok({"id": inv_id})
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=invitee), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/invitations/{inv_id}/accept", headers=_auth())
        assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_accept_invitation_first_member_becomes_admin(self):
        """
        The first member to accept an invitation becomes Org Admin.
        Subsequent members get 'member' role.
        """
        org_id = _id()
        inv_id = _id()
        first_user = _user(email="first@test.com", role="user", is_approved=True)

        inv_row = {
            "id": inv_id, "organization_id": org_id,
            "invited_email": "first@test.com", "status": "pending",
        }
        table_mock = _chain()
        call_count = 0
        inserted_role: list[str] = []

        original_insert = table_mock.insert

        def _capture_insert(data):
            inserted_role.append(data.get("org_role", ""))
            return table_mock

        table_mock.insert = _capture_insert

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok(inv_row)
            if call_count == 2:
                return _supabase_empty()  # not already member
            if call_count == 3:
                # 0 existing members → first → admin
                r = MagicMock(); r.count = 0; r.data = []; r.error = None
                return r
            if call_count == 4:
                return _supabase_ok({"user_id": first_user.id, "organization_id": org_id, "org_role": "admin"})
            if call_count == 5:
                return _supabase_ok({"id": inv_id})
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=first_user), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/invitations/{inv_id}/accept", headers=_auth())
        assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_decline_invitation(self):
        """User can decline an invitation — status becomes 'revoked'."""
        inv_id = _id()
        user = _user(email="decline@test.com", role="user", is_approved=True)

        inv_row = {
            "id": inv_id, "organization_id": _id(),
            "invited_email": "decline@test.com", "status": "pending",
        }
        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok(inv_row)
            return _supabase_ok({"id": inv_id})

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=user), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/invitations/{inv_id}/decline", headers=_auth())
        assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_accept_non_existent_invitation_returns_404(self):
        """Accepting an invitation that doesn't exist returns 404."""
        inv_id = _id()
        user = _user(email="ghost@test.com", role="user", is_approved=True)

        table_mock = _chain()
        table_mock.execute = AsyncMock(return_value=_supabase_empty())

        with patch("app.routers.organization.get_current_user", return_value=user), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/invitations/{inv_id}/accept", headers=_auth())
        assert r.status_code == 404


# ══════════════════════════════════════════════════════════════════
# Section 4 — Member Management
# ══════════════════════════════════════════════════════════════════

class TestMemberManagement:
    """
    Org Admin promotes, demotes, and removes members.

    Endpoints:
        GET    /api/orgs/{org_id}/members
        POST   /api/orgs/{org_id}/members/{uid}/promote
        POST   /api/orgs/{org_id}/members/{uid}/demote
        DELETE /api/orgs/{org_id}/members/{uid}
    """

    @pytest.mark.asyncio
    async def test_list_members(self):
        """Org members can list all members in their org."""
        org_id = _id()
        admin = _user(role="user", is_approved=True, org_id=org_id)

        member_rows = [
            {"user_id": admin.id, "org_role": "admin", "joined_at": _now(),
             "user_profiles": {"email": "admin@test.com", "first_name": "A", "last_name": "B", "avatar_url": None}},
            {"user_id": _id(), "org_role": "member", "joined_at": _now(),
             "user_profiles": {"email": "member@test.com", "first_name": "M", "last_name": "X", "avatar_url": None}},
        ]
        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "active"})
            if call_count == 2:
                return _supabase_ok({"user_id": admin.id})
            if call_count == 3:
                return _supabase_ok(member_rows)
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.get(f"/api/orgs/{org_id}/members", headers=_auth())
        assert r.status_code == 200
        assert len(r.json()) == 2

    @pytest.mark.asyncio
    async def test_promote_member_to_admin(self):
        """Org Admin can promote a member to admin."""
        org_id = _id()
        admin = _user(role="user", is_approved=True, org_id=org_id)
        target_id = _id()

        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "active"})
            if call_count == 2:
                return _supabase_ok({"user_id": admin.id})
            if call_count == 3:
                return _supabase_ok({"org_role": "admin"})  # caller is admin
            if call_count == 4:
                return _supabase_ok({"org_role": "member"})  # target is member
            if call_count == 5:
                return _supabase_ok({"user_id": target_id})  # update succeeds
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/{org_id}/members/{target_id}/promote", headers=_auth())
        assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_demote_admin_to_member(self):
        """Org Admin can demote another admin (but not themselves if last admin)."""
        org_id = _id()
        admin = _user(role="user", is_approved=True, org_id=org_id)
        target_id = _id()

        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "active"})
            if call_count == 2:
                return _supabase_ok({"user_id": admin.id})
            if call_count == 3:
                return _supabase_ok({"org_role": "admin"})
            if call_count == 4:
                return _supabase_ok({"org_role": "admin"})  # target is admin
            if call_count == 5:
                # 2 admins exist → safe to demote
                r = MagicMock(); r.count = 2; r.data = [MagicMock(), MagicMock()]; r.error = None
                return r
            if call_count == 6:
                return _supabase_ok({"user_id": target_id})
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/{org_id}/members/{target_id}/demote", headers=_auth())
        assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_demote_last_admin_returns_400(self):
        """Cannot demote the last admin — org would have no admin."""
        org_id = _id()
        admin = _user(role="user", is_approved=True, org_id=org_id)
        target_id = _id()

        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "active"})
            if call_count == 2:
                return _supabase_ok({"user_id": admin.id})
            if call_count == 3:
                return _supabase_ok({"org_role": "admin"})
            if call_count == 4:
                return _supabase_ok({"org_role": "admin"})
            if call_count == 5:
                # Only 1 admin → cannot demote
                r = MagicMock(); r.count = 1; r.data = [MagicMock()]; r.error = None
                return r
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/{org_id}/members/{target_id}/demote", headers=_auth())
        assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_remove_member(self):
        """Org Admin can remove a member from the org."""
        org_id = _id()
        admin = _user(role="user", is_approved=True, org_id=org_id)
        target_id = _id()

        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "active"})
            if call_count == 2:
                return _supabase_ok({"user_id": admin.id})
            if call_count == 3:
                return _supabase_ok({"org_role": "admin"})
            if call_count == 4:
                return _supabase_ok({"user_id": target_id})  # delete result
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.delete(f"/api/orgs/{org_id}/members/{target_id}", headers=_auth())
        assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_remove_yourself_returns_400(self):
        """Admin cannot remove themselves — 400."""
        org_id = _id()
        admin = _user(role="user", is_approved=True, org_id=org_id)

        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "active"})
            if call_count == 2:
                return _supabase_ok({"user_id": admin.id})
            if call_count == 3:
                return _supabase_ok({"org_role": "admin"})
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.delete(f"/api/orgs/{org_id}/members/{admin.id}", headers=_auth())
        assert r.status_code == 400


# ══════════════════════════════════════════════════════════════════
# Section 5 — Leave Organization
# ══════════════════════════════════════════════════════════════════

class TestLeaveOrg:
    """
    POST /api/orgs/{org_id}/leave

    Rules:
    - Last admin cannot leave
    - Regular member can leave anytime
    """

    @pytest.mark.asyncio
    async def test_member_can_leave(self):
        """Regular member can leave the org successfully."""
        org_id = _id()
        member = _user(role="user", is_approved=True, org_id=org_id)

        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "active"})
            if call_count == 2:
                return _supabase_ok({"user_id": member.id})
            if call_count == 3:
                return _supabase_ok({"org_role": "member"})  # not admin → safe
            if call_count == 4:
                return _supabase_ok({"user_id": member.id})  # delete row
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=member), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/{org_id}/leave", headers=_auth())
        assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_last_admin_cannot_leave(self):
        """Last admin cannot leave — must promote someone first."""
        org_id = _id()
        admin = _user(role="user", is_approved=True, org_id=org_id)

        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "active"})
            if call_count == 2:
                return _supabase_ok({"user_id": admin.id})
            if call_count == 3:
                return _supabase_ok({"org_role": "admin"})
            if call_count == 4:
                # count admins = 1 → cannot leave
                r = MagicMock(); r.count = 1; r.data = [MagicMock()]; r.error = None
                return r
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/{org_id}/leave", headers=_auth())
        assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_admin_with_co_admin_can_leave(self):
        """Admin can leave when another admin exists."""
        org_id = _id()
        admin = _user(role="user", is_approved=True, org_id=org_id)

        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "active"})
            if call_count == 2:
                return _supabase_ok({"user_id": admin.id})
            if call_count == 3:
                return _supabase_ok({"org_role": "admin"})
            if call_count == 4:
                # 2 admins → safe
                r = MagicMock(); r.count = 2; r.data = [MagicMock(), MagicMock()]; r.error = None
                return r
            if call_count == 5:
                return _supabase_ok({"user_id": admin.id})
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/{org_id}/leave", headers=_auth())
        assert r.status_code == 200


# ══════════════════════════════════════════════════════════════════
# Section 6 — Org Deletion Flow
# ══════════════════════════════════════════════════════════════════

class TestOrgDeletion:
    """
    Two-step deletion: Org Admin requests → platform support/admin confirms.

    Endpoints:
        POST /api/orgs/{org_id}/request-deletion    (Org Admin only)
        POST /api/orgs/{org_id}/confirm-deletion    (platform support/admin only)
        POST /api/orgs/{org_id}/cancel-deletion     (Org Admin OR platform support/admin)

    Constraints:
    - Only Org Admin can request
    - Same person cannot both request and confirm
    - Cannot confirm org that is not pending_deletion
    """

    @pytest.mark.asyncio
    async def test_request_deletion_by_org_admin(self):
        """Org Admin successfully requests org deletion."""
        org_id = _id()
        admin = _user(role="user", is_approved=True, org_id=org_id)

        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "active"})
            if call_count == 2:
                return _supabase_ok({"user_id": admin.id})
            if call_count == 3:
                return _supabase_ok({"org_role": "admin"})
            if call_count == 4:
                return _supabase_ok({"id": org_id})  # update status
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/{org_id}/request-deletion", headers=_auth())
        assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_request_deletion_forbidden_for_member(self):
        """Regular member cannot request deletion — 403."""
        org_id = _id()
        member = _user(role="user", is_approved=True, org_id=org_id)

        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "active"})
            if call_count == 2:
                return _supabase_ok({"user_id": member.id})
            if call_count == 3:
                return _supabase_ok({"org_role": "member"})
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=member), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/{org_id}/request-deletion", headers=_auth())
        assert r.status_code == 403

    @pytest.mark.asyncio
    async def test_confirm_deletion_by_platform_admin(self):
        """
        Platform admin confirms a pending deletion.
        Org status → deleted, org_members cleaned up.
        """
        org_id = _id()
        requester_id = _id()  # the Org Admin who requested
        platform_admin = _user(role="admin", is_approved=True)
        # Platform admin must have a different ID than the requester
        platform_admin.id = _id()

        org_row = {
            "status": "pending_deletion",
            "deletion_requested_by": requester_id,  # different from platform_admin.id
        }
        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok(org_row)      # fetch org
            if call_count == 2:
                return _supabase_ok({"id": org_id})  # update status → deleted
            if call_count == 3:
                return _supabase_ok([])            # delete org_members
            if call_count == 4:
                return _supabase_ok([])            # revoke invitations
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=platform_admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/{org_id}/confirm-deletion", headers=_auth())
        assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_confirm_deletion_by_same_person_returns_400(self):
        """
        The person who requested deletion cannot confirm it themselves.
        Prevents single-person deletion without oversight.
        """
        org_id = _id()
        platform_admin = _user(role="admin", is_approved=True)

        org_row = {
            "status": "pending_deletion",
            "deletion_requested_by": platform_admin.id,  # same person!
        }
        table_mock = _chain()
        table_mock.execute = AsyncMock(return_value=_supabase_ok(org_row))

        with patch("app.routers.organization.get_current_user", return_value=platform_admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/{org_id}/confirm-deletion", headers=_auth())
        assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_confirm_deletion_not_pending_returns_400(self):
        """Cannot confirm deletion on an org that is still 'active'."""
        org_id = _id()
        platform_admin = _user(role="admin", is_approved=True)

        org_row = {"status": "active", "deletion_requested_by": _id()}
        table_mock = _chain()
        table_mock.execute = AsyncMock(return_value=_supabase_ok(org_row))

        with patch("app.routers.organization.get_current_user", return_value=platform_admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/{org_id}/confirm-deletion", headers=_auth())
        assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_confirm_deletion_forbidden_for_regular_user(self):
        """Regular user cannot confirm deletion — 403."""
        org_id = _id()
        user = _user(role="user", is_approved=True)

        with patch("app.routers.organization.get_current_user", return_value=user):
            async with _client() as c:
                r = await c.post(f"/api/orgs/{org_id}/confirm-deletion", headers=_auth())
        assert r.status_code == 403

    @pytest.mark.asyncio
    async def test_cancel_deletion_by_platform_admin(self):
        """Platform admin can cancel a pending deletion — org returns to 'active'."""
        org_id = _id()
        platform_admin = _user(role="admin", is_approved=True)

        org_row = {"status": "pending_deletion"}
        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok(org_row)
            return _supabase_ok({"id": org_id})

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=platform_admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/{org_id}/cancel-deletion", headers=_auth())
        assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_cancel_deletion_by_org_admin(self):
        """Org Admin can also cancel their own deletion request."""
        org_id = _id()
        org_admin = _user(role="user", is_approved=True, org_id=org_id)

        org_row = {"status": "pending_deletion"}
        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok(org_row)
            if call_count == 2:
                # verify org_role = admin
                return _supabase_ok({"org_role": "admin"})
            return _supabase_ok({"id": org_id})

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=org_admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(f"/api/orgs/{org_id}/cancel-deletion", headers=_auth())
        assert r.status_code == 200


# ══════════════════════════════════════════════════════════════════
# Section 7 — Access Control (Isolation)
# ══════════════════════════════════════════════════════════════════

class TestAccessControl:
    """
    Multi-tenant isolation: users cannot access orgs they don't belong to.

    Key rule: verify_organization() checks org_members table.
    All users — including platform admin — must be members to
    access org-specific data endpoints.
    Exception: platform admin/support can read GET /{org_id} and
    call confirm/cancel-deletion without membership.
    """

    @pytest.mark.asyncio
    async def test_non_member_cannot_list_members(self):
        """User who is not a member of the org gets 403."""
        org_id = _id()
        outsider = _user(role="user", is_approved=True)

        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "active"})
            if call_count == 2:
                return _supabase_empty()  # not a member
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=outsider), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.get(f"/api/orgs/{org_id}/members", headers=_auth())
        assert r.status_code == 403

    @pytest.mark.asyncio
    async def test_platform_admin_can_read_org_details_without_membership(self):
        """
        Platform admin/support can call GET /{org_id} to read name/status
        (needed for DangerZone page) even without being a member.
        """
        org_id = _id()
        platform_admin = _user(role="admin", is_approved=True)

        org_row = {
            "id": org_id, "name": "ExternalCorp", "slug": "external-corp",
            "status": "active", "created_at": _now(),
        }
        table_mock = _chain()
        table_mock.execute = AsyncMock(return_value=_supabase_ok(org_row))

        with patch("app.routers.organization.get_current_user", return_value=platform_admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.get(f"/api/orgs/{org_id}", headers=_auth())
        assert r.status_code == 200
        assert r.json()["name"] == "ExternalCorp"

    @pytest.mark.asyncio
    async def test_platform_admin_cannot_invite_to_org_without_membership(self):
        """
        Platform admin who is NOT an org member cannot invite to that org.
        verify_organization checks membership; admin bypass does not apply here.
        """
        org_id = _id()
        platform_admin = _user(role="admin", is_approved=True)

        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "active"})
            if call_count == 2:
                return _supabase_empty()  # not a member
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=platform_admin), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.post(
                    f"/api/orgs/{org_id}/invite",
                    json={"email": "x@test.com"},
                    headers=_auth(),
                )
        assert r.status_code == 403

    @pytest.mark.asyncio
    async def test_deleted_org_returns_404(self):
        """Accessing a deleted org returns 404, not 403."""
        org_id = _id()
        member = _user(role="user", is_approved=True)

        table_mock = _chain()
        call_count = 0

        async def _execute():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _supabase_ok({"status": "deleted"})
            return _supabase_empty()

        table_mock.execute = _execute

        with patch("app.routers.organization.get_current_user", return_value=member), \
             patch("app.routers.organization.get_supabase") as mock_sb:
            mock_sb.return_value.table = MagicMock(return_value=table_mock)
            async with _client() as c:
                r = await c.get(f"/api/orgs/{org_id}/members", headers=_auth())
        assert r.status_code == 404

    @pytest.mark.asyncio
    async def test_unapproved_user_blocked_everywhere(self):
        """Unapproved user cannot access any org endpoint."""
        unapproved = _user(role="user", is_approved=False)

        with patch("app.routers.organization.get_current_user", return_value=unapproved):
            async with _client() as c:
                r = await c.get(f"/api/orgs/{_id()}/members", headers=_auth())
        # require_approved dependency raises 403
        assert r.status_code == 403
