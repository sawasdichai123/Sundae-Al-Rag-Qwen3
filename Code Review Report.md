# SUNDAE Project — Full Code Review Report

**Review Date:** 2026-03-22 (initial) · 2026-03-28 (Round 3 re-review) · 2026-04-04 (Round 4 re-review) · 2026-04-04 (Round 6 re-review) · 2026-04-04 (Round 9 re-review) · 2026-04-05 (Sprint 3 implementation)
**Reviewer:** Claude Code
**Scope:** Backend (routers, core, services) + Frontend (pages, stores, API, components)
**Branch:** Ver_1.0 (latest review)

---

## Decisions & Exclusions

> Items agreed upon during review sessions — **do NOT re-open these.**

| ID | Decision | Reason |
|----|----------|--------|
| ~~D-1~~ | ~~widget.py excluded from scope~~ | **Reopened in Round 3** — widget.py now reviewed |
| D-2 | **S-1: Support role has no Inbox** | Intentional design — "ตั้งใจให้เป็นแบบนั้น" |
| D-3 | **B-4: Reply only in human_takeover** | Correct flow — user calls admin → auto human_takeover → admin replies |
| D-4 | **OrgSwitcher hard reload** is intentional | `window.location.href = "/"` flushes all org-scoped state |

## Already Fixed

### Round 1 — Manual Fixes (Auth Model & UI Logic)

| ID | Fix | Files Changed |
|----|-----|---------------|
| F-1 | **Inbox auth model** — org owner can now list sessions, change status, send replies | `inbox.py` — created `_require_inbox_manager()` helper |
| F-2 | **verify_session_access** — org owner can now read member sessions | `auth.py` — added org_members owner check |
| F-3 | **Rules of Hooks** — moved `useOrgStore` before conditional return | `DashboardPage.tsx` |
| F-4 | **Organization type sync** — added `slug?`, `status?`, `updated_at?` | `types/index.ts` |
| F-5 | **Removed duplicate DB queries** — merged verify_organization into _require_inbox_manager | `inbox.py` |
| F-6 | **Merged duplicate chat_sessions query** in send_admin_message | `inbox.py` |
| F-7 | **Cleaned unused import** — removed `require_role` from inbox.py | `inbox.py` |

### Round 2 — Agent Batch Fixes (Code Review Issues)

| ID | Fix | Files Changed |
|----|-----|---------------|
| F-8 | **Platform user ID override** — force `platform_user_id = user.id` for web platform | `chat.py` |
| F-9 | **Filename sanitization** — regex strips unsafe chars, allows Thai | `document.py` |
| F-10 | **Extracted text size limit** — max 10MB after PDF extraction | `document.py` |
| F-11 | **Email validation** — regex check on invite_member | `organization.py` |
| F-12 | **Duplicate email check optimized** — O(N) → O(1) with 2 targeted queries | `organization.py` |
| F-13 | **CORS tightened** — specific methods/headers instead of `["*"]` | `main.py` |
| F-14 | **LINE event validation** — `.get()` with safe defaults instead of direct access | `webhook_line.py` |
| F-15 | **LINE message truncation** — auto-truncate > 2000 chars | `line_service.py` |
| F-16 | **Ollama health timeout** — 3s → 10s | `health.py` |
| F-17 | **Message length limit** — max 10,000 chars in send_admin_message | `inbox.py` |
| F-18 | **Bot name validation** — empty check + max 100 chars | `bot.py` |
| F-19 | **Bot system_prompt validation** — max 10,000 chars | `bot.py` |
| F-20 | **React Error Boundary** — wraps all routes, Thai fallback UI | `ErrorBoundary.tsx`, `App.tsx` |
| F-21 | **PDF upload validation** — type check in file picker (not just drag-drop) | `KnowledgeBasePage.tsx` |

### Round 3 — i18n Implementation + Bug Fixes

| ID | Fix | Files Changed |
|----|-----|---------------|
| F-22 | **i18n system** — Zustand locale store + `useT()` hook + JSON translations (~370 keys) | `i18n/index.ts`, `i18n/th.json`, `i18n/en.json` |
| F-23 | **Language toggle** — TH/EN pill button in header + auth pages | `LanguageToggle.tsx`, `DashboardLayout.tsx`, `AuthLayout.tsx` |
| F-24 | **All pages i18n** — hardcoded Thai → `t("key")` across 18 files | LoginPage, ForgotPasswordPage, ResetPasswordPage, DashboardPage, KnowledgeBasePage, BotsPage, InboxPage, WebChatPage, ApprovalsPage, OrganizationPage, ProfilePage, CreateOrgPage, DangerZonePage, IntegrationPage, OrgSwitcher, ErrorBoundary |
| F-25 | **useT() infinite re-render fix** — memoized `t` function with `useCallback([locale])` | `i18n/index.ts` |
| F-26 | **Missing translation key** — added `approvals.loadFailed` | `th.json`, `en.json` |
| F-27 | **CORS PATCH method** — added PATCH to allowed methods list | `main.py` |

### Round 4 — i18n Completion + UX Cleanup

| ID | Fix | Files Changed |
|----|-----|---------------|
| F-28 | **i18n: App.tsx + ProtectedRoute.tsx** — replaced hardcoded loading Thai strings with `t()` calls (`common.checkingSession`, `common.loadingOrg`, `common.loadingPermission`) | `App.tsx`, `ProtectedRoute.tsx` |
| F-29 | **i18n: InboxPage timeAgo()** — `justNow` string now uses `t("common.justNow")` (partial fix — other time strings remain) | `InboxPage.tsx` |
| F-30 | **i18n: CreateOrgPage + LoginPage placeholders** — replaced hardcoded placeholder text with `t()` calls | `CreateOrgPage.tsx`, `LoginPage.tsx` |
| F-31 | **IntegrationPage non-functional toggle** — now loads/saves real LINE config via API | `IntegrationPage.tsx`, `endpoints.ts` |
| F-32 | **OrganizationPage dead code** — removed unused `handleLeave`, `useNavigate`, `leaving` state | `OrganizationPage.tsx` |
| F-33 | **ProfilePage locale hardcode** — `.toLocaleDateString("th-TH")` → `.toLocaleDateString()` | `ProfilePage.tsx` |

### False Positives (Removed from Count)

| ID | Issue | Finding |
|----|-------|---------|
| FP-1 | chat.py: Missing Org Isolation in /request-human | Already had `.eq("organization_id")` — secure |
| FP-2 | chat.py: Missing Org Verification in /send-message | Already had `verify_organization()` — secure |

---

## Executive Summary (Current State — Round 3)

| Area | Critical | High | Medium | Low | Total |
|------|----------|------|--------|-----|-------|
| Backend Routers | 6 | 4 | 12 | 5 | **27** |
| Backend Core/Services | 0 | 0 | 8 | 6 | **14** |
| Frontend Pages | 5 | 2 | 12 | 16+ | **35+** |
| Frontend Stores/API/i18n | 8 | 6 | 14 | 10+ | **38+** |
| **Total** | **~19** | **~12** | **~46** | **~37** | **~114** |

> Note: Total increased from ~95 because widget.py (D-1) is now included and i18n gaps were discovered.
> 6 fixes in Round 3 (F-22 to F-27) offset by ~25 new findings from widget.py + i18n re-review.

### Overall Health Score

| Area | Score | Change |
|------|-------|--------|
| Backend Security | 7/10 | -1 (widget.py public endpoints + unauthenticated /health/metrics found) |
| Backend Error Handling | 7/10 | +0.5 (CORS PATCH fixed) |
| Frontend State Management | 7/10 | — (token refresh race still open) |
| Frontend UX/Error Handling | 6/10 | +0.5 (Error Boundary, i18n system added) |
| Frontend i18n Coverage | 8/10 | +0.5 (App.tsx + ProtectedRoute fixed; timeAgo partial; authStore/axios still open) |
| Frontend Security | 6/10 | — |
| **Overall** | **6.8/10** | **+0.2** |

---

# Part 1: Backend Review

---

## 1. Backend Routers

### 1.1 chat.py — RAG Chat Pipeline (Core Feature)

~~**CRITICAL: Missing Org Isolation in /request-human**~~ → **FP-1: Already secure**

~~**CRITICAL: Missing Org Verification in /send-message**~~ → **FP-2: Already secure**

~~**HIGH: Platform User ID Not Validated**~~ → **F-8: FIXED** — web platform now forces `platform_user_id = user.id`

**MEDIUM: Stream Session Upsert Race Condition**
- Lines 282-295: Try-insert / catch-exception / update pattern. Exception could be permission error, not "exists".
- **Fix:** Use database upsert directly.

---

### 1.2 document.py — PDF Upload & Chunking

~~**CRITICAL: File Upload Filename Not Sanitized**~~ → **F-9: FIXED** — regex sanitization with Thai support

**CRITICAL: Unverified Bot Ownership in link_document**
- Lines 211-259: Accepts `bot_id` without checking if current user can manage that bot (org member vs owner).
- **Fix:** Add explicit ownership/role check before linking.

~~**HIGH: No Validation of Extracted Text Size**~~ → **F-10: FIXED** — 10MB max text size

---

### 1.3 organization.py — Org CRUD & Members

**CRITICAL: First-Accepter Gets Owner Role**
- Lines 312-320: `accept_invitation` gives owner role to first user to accept, regardless of intent.
- **Risk:** Wrong user could become org owner by accepting first.
- **Fix:** Explicitly assign owner at creation, not acceptance.

**CRITICAL: Slug Collision Race Condition**
- Lines 141-146: Two concurrent creations with same name can both pass the uniqueness check.
- **Fix:** Rely on DB UNIQUE constraint + retry with different suffix.

~~**HIGH: No Email Validation on Invitations**~~ → **F-11: FIXED** — email regex validation

~~**MEDIUM: Inefficient Duplicate Email Check**~~ → **F-12: FIXED** — O(1) with 2 targeted queries

---

### 1.4 widget.py — Public Web Widget (Reopened Round 3)

**CRITICAL: No Rate Limiting on Public Endpoints**
- Widget endpoints are fully unauthenticated and public-facing. No rate limiting at all.
- **Risk:** Trivial DoS — attacker can spam `/widget/send` to exhaust server resources and Ollama/LLM capacity.
- **Fix:** Add rate limiter middleware (IP-based, e.g., 30 req/min per IP).

**HIGH: No max_length on Message Input**
- Widget `/send` endpoint accepts arbitrarily long messages.
- **Risk:** Oversize prompts sent to LLM, high token cost, slow responses, potential OOM.
- **Fix:** Validate message length (e.g., max 5,000 chars).

**HIGH: Session History Readable Without Auth**
- Widget session history endpoint returns full chat history with only a session ID.
- **Risk:** Session ID enumeration exposes other users' conversations.
- **Fix:** Add HMAC-signed session tokens or require proof of session ownership.

**HIGH: No Session Expiry or Cleanup**
- Widget sessions persist indefinitely with no TTL.
- **Risk:** Stale sessions accumulate in database.
- **Fix:** Add `expires_at` column, periodic cleanup job.

**MEDIUM: No CORS Restriction on Widget Endpoints**
- Widget can be embedded on any domain — no origin validation.
- **Fix:** Allow org-specific allowed origins configuration.

**MEDIUM: No Input Sanitization on Widget User Messages**
- Messages stored as-is. If displayed in admin Inbox, potential stored XSS.
- **Fix:** Sanitize or escape message content before storage.

---

### 1.5 webhook_line.py — LINE Integration

**CRITICAL: No Rate Limiting on Webhook**
- Lines 210-302: Unlimited events processed. DoS vector via rapid message sending.
- **Fix:** Add rate limiter (e.g., 100/minute per bot).

~~**HIGH: Missing Event Structure Validation**~~ → **F-14: FIXED** — `.get()` with safe defaults

**MEDIUM: Session Status Race Condition**
- Lines 148-157: Status checked before RAG, but admin could take over between check and response generation.
- **Fix:** Re-check status before sending AI response.

---

### 1.6 approval.py — User Approval

**CRITICAL: Race Condition in Auto-Accept Invitations**
- Lines 135-179: Non-atomic check-then-insert for `org_members` could create duplicates.
- **Fix:** Use DB UNIQUE constraint + upsert.

---

### 1.7 inbox.py — Chat Session Management

> **Note:** Auth model issues (F-1, F-2, F-5, F-6, F-7) fixed in Round 1.

~~**MEDIUM: No Message Content Length Limit**~~ → **F-17: FIXED** — max 10,000 chars

**MEDIUM: Missing Pagination**
- `list_sessions` returns all sessions. For org with 100k sessions, this is a problem.
- **Fix:** Add `limit/offset` or `page/page_size` parameters.

**MEDIUM: LINE Push Failure Not Reported to Admin**
- Lines 412-429: If LINE push fails, admin sees "sent" but user didn't receive.
- **Fix:** Return warning or mark message with `push_failed: true`.

---

### 1.8 bot.py — Bot Management

~~**MEDIUM: No Field Validation**~~ → **F-18 + F-19: FIXED** — name (100 chars) + system_prompt (10k chars)

**MEDIUM: Inactive Bots Listed**
- `list_bots` doesn't filter by `is_active`.

---

### 1.9 health.py — Health Check

~~**MEDIUM: Ollama Timeout Too Short**~~ → **F-16: FIXED** — 3s → 10s

**HIGH: /health/metrics Endpoint Unauthenticated** *(New in Round 3)*
- `/health/metrics` exposes server CPU, memory, disk, request counts without any auth.
- **Risk:** Information disclosure — attacker can monitor server load patterns.
- **Fix:** Require admin auth or move behind internal-only route.

---

## 2. Backend Core/Services

### 2.1 main.py

~~**HIGH: CORS Configuration Too Permissive**~~ → **F-13: FIXED** — specific methods/headers

**MEDIUM: Model Warmup Failure Doesn't Block Startup**
- Background task warmup means server starts with broken AI pipeline; first requests fail.
- **Fix:** Add health check endpoint or fail-fast startup.

---

### 2.2 auth.py

> **Note:** verify_session_access org owner bypass (F-2) fixed in Round 1.

**MEDIUM: X-Active-Org Header Not Validated**
- Lines 188-190: User can set any org in header without verification at this level.
- **Mitigation:** Each endpoint calls `verify_organization()`, but if one forgets, tenant isolation breaks.

**MEDIUM: Cache Not Multi-Process Safe**
- Lines 63-93: Simple dict cache; won't sync across uvicorn workers.
- **Fix:** Redis cache for production, or keep current with shorter TTL.

**MEDIUM: DB Errors Return Wrong Status Code**
- Lines 167-180: Returns 403 for ANY DB error (including timeouts).
- **Fix:** Distinguish between "not found" and "DB unavailable" (503).

---

### 2.3 config.py

**LOW: Missing Range Validation**
- `reranker_score_threshold` has no 0.0-1.0 bounds check.
- `parent_chunk_size` could be less than `parent_chunk_overlap`.
- **Fix:** Add `ge=0.0, le=1.0` and cross-field validators.

---

### 2.4 llm_generator.py

**MEDIUM: JSON Decode Outside try Block**
- Lines 168-195: `response.json()` called outside try; `JSONDecodeError` not caught.
- **Fix:** Wrap in try-except.

**MEDIUM: Stream Error Handling Incomplete**
- Lines 263-282: Silent continuation on JSON decode error could lose tokens.
- **Fix:** Log warnings, track if any tokens yielded.

**LOW: Non-Streaming Timeout Too Long**
- Line 123: 300s (5 min) for non-streaming. User won't wait that long.
- **Fix:** 30s for non-streaming, 300s for streaming.

---

### 2.5 database.py

**MEDIUM: No Connection Retry**
- 30s timeout with no retry on failure.
- **Fix:** Exponential backoff, 3 retries.

---

### 2.6 line_service.py

~~**MEDIUM: LINE Message Length Not Validated**~~ → **F-15: FIXED** — auto-truncate > 2000 chars

---

### 2.7 vector_search.py & chunking.py

- **Good:** Strong multi-tenant isolation in every function.
- **LOW:** Batch sizes hardcoded (100 parent, 50 child). Make configurable.

---

# Part 2: Frontend Review

---

## 3. Frontend Pages

### 3.1 WebChatPage.tsx — CRITICAL

**Memory Leak & Polling Issues**
- Lines 277-350: Message polling interval not properly cancelled when `selectedSession`/`orgId` changes rapidly.
- Lines 115-151: `historyLoadedRef` prevents re-loading, but if user authenticates mid-session, history won't reload.

**Race Condition: Multiple Tabs**
- Lines 396-401: `localStorage` for session IDs — multiple tabs overwrite each other.
- Lines 468-543: `abortControllerRef` overwritten if user sends two messages quickly.

**Session Restoration Bug**
- Line 216: Default poll timestamp `"1970-01-01T00:00:00Z"` fetches entire history on first poll.

**Performance**
- Line 577-580: No memo optimization for chat bubbles; re-renders on every keystroke.
- Line 91: `platformUserId` creates random UUID each render if `user.id` undefined.

---

### 3.2 InboxPage.tsx — HIGH

**Race Condition in Polling**
- Lines 187-223: Multiple intervals; message could be missed or duplicated between full load and polling.
- Lines 135-140: Session list polling interval — memory leak if component unmounts.

**UX Issues**
- ~~Reply composer only shows in "human_takeover"~~ → **D-3: Intentional design** (correct flow)
- Line 165: Auto-scroll happens on every message change, could scroll during typing.

**Type Issues**
- Lines 18-38: Local type definitions duplicate types from `types/index.ts`.

---

### 3.3 LoginPage.tsx

**Security**
- Lines 89-92: `signOut()` with `.catch(() => {})` silently fails; old session could remain.
- Lines 137-143: Displays auth error message directly — potential XSS if error contains user input.

---

### 3.4 KnowledgeBasePage.tsx

~~**Upload Validation Gap**~~ → **F-21: FIXED** — PDF type check in file picker

**Performance**
- Line 183-185: Document filtering on every render; should use `useMemo`.

---

### 3.5 BotsPage.tsx

**Rules of Hooks Risk**
- Line 183: `loadDocuments(bot.id)` dependency behavior could be stale.

**UX**
- Knowledge linking during bot creation shows warning but unclear path forward.

---

### 3.6 ResetPasswordPage.tsx

**Session Management Bug**
- Lines 59-66: `Promise.race` with 10s timeout could cause false error on slow networks.

---

### 3.7 DashboardPage.tsx

> **Note:** Rules of Hooks (F-3) fixed in Round 1.

**Unhandled Promise**
- Lines 245-283: `Promise.allSettled` result handling has potential null reference.

**Missing Dependency**
- Line 283: `isSupport` in dependency array but not used in effect body.

---

### 3.8 OrganizationPage.tsx

**UX Bug**
- Lines 98-99: After deletion, `window.location.href` causes full page reload instead of SPA navigation.

---

### 3.9 IntegrationPage.tsx

~~**Non-functional Feature**~~
~~Lines 103-106: Toggle state doesn't persist. User toggles, refreshes, changes lost.~~ → **F-31: FIXED** — toggle + credentials persist via real API

---

## 4. Frontend Stores/API/Components

### 4.1 supabaseClient.ts — CRITICAL

**Token Refresh Race Condition (Cross-Tab)**
- Lines 106-132: `refreshOnce()` — multiple tabs can race, corrupting token state.
- Lines 165-181: `consecutiveRefreshFailures` counter can increment too fast, forcing re-login.

**Lock Timeout**
- Line 62: `lockQueues.clear()` on tab visible could corrupt state if refresh is in progress.

**Fix:** Implement `BroadcastChannel` for cross-tab token sync.

---

### 4.2 axios.ts — CRITICAL

**Token Refresh Called From Multiple Points**
- Lines 27, 130, 156: `refreshTokenOnce()` called from interceptor, response handler, and `askStream`.
- **Risk:** Concurrent refreshes can invalidate token.

**Token Cache Expiry Window**
- Lines 80-116: 5-minute buffer might be too tight; token could expire between check and API call.
- **Fix:** Increase buffer to 10-15 minutes.

**Timeout Promise Leak**
- Lines 95-96: `timeoutPromise` in `getValidToken()` never cancelled if session resolved quickly.

---

### 4.3 authStore.ts

**Missing Error Recovery**
- Lines 128-134: `fetchProfile` failure sets `authError` but no retry path.

**Type Casting Without Validation**
- Line 147: `profile.role as UserRole` without checking valid enum.

---

### 4.4 orgStore.ts

**localStorage Race Condition**
- Lines 32, 67-70: Direct access without error handling; stale on app reload.

**fetchFailed Never Resets**
- Line 75: Once true, no retry mechanism.

---

### 4.5 App.tsx / ProtectedRoute.tsx

~~**No Error Boundary**~~ → **F-20: FIXED** — ErrorBoundary component wrapping routes

**No "Access Denied" Screen**
- ProtectedRoute silently redirects without explaining why.

**Auth Timeout Too Short**
- Line 48: 5s timeout for initial auth on slow networks.

---

### 4.6 i18n Gaps Found in Round 3 Re-Review *(NEW)*

~~**CRITICAL: authStore.ts Hardcoded Thai Error Messages**~~
~~Error messages like "ไม่สามารถโหลดข้อมูลผู้ใช้ได้", "กรุณาเข้าสู่ระบบใหม่" bypass i18n entirely.~~ → **F-40: FIXED** — `getT()` non-hook helper; all auth errors now use `t("auth.*")` keys.

~~**CRITICAL: axios.ts Forced Redirect Loses User Data**~~
~~On 401, `window.location.href = "/login"` fires immediately, discarding any unsaved form data.~~ → **F-41: FIXED** — dispatches `CustomEvent("session-expired")`; `AuthProvider` handles gracefully via `signOut()`.

**HIGH: WebChatPage Stale Closure with t()**
- `t` function captured in polling callbacks may reference stale locale if user switches language mid-chat.
- **Fix:** Use `useRef` for `t` in polling callbacks, or read locale directly from store.

~~**HIGH: InboxPage Hardcoded Thai in timeAgo()**~~
~~`justNow`, "วันที่แล้ว", "ชั่วโมงที่แล้ว" hardcoded Thai.~~ → **F-42: FIXED** — `timeAgo()` now accepts `TimeAgoLabels` interface; all strings passed via `t()`.

~~**HIGH: LoginPage registerMsg Success Detection Relies on Emoji**~~
~~Line checks for "✅" emoji in message string to determine success vs error styling.~~ → **F-38: FIXED** — `registerSuccess: boolean` state used for CSS class selection.

**HIGH: ForgotPasswordPage / ResetPasswordPage Hardcoded Thai**
- Several strings still hardcoded Thai after i18n pass (toast messages, edge case texts).
- **Fix:** Add missing keys to JSON files and replace hardcoded strings.

~~**HIGH: App.tsx Hardcoded Thai in Loading/Timeout States**~~
~~"กำลังโหลด..." and timeout messages not covered by i18n.~~ → **F-28: FIXED** — `checkingSession`, `loadingOrg`, `loadingPermission` now use `t()`

**MEDIUM: supabaseClient.ts forceReauth Clears Session Without Page Check**
- `forceReauth()` calls `signOut()` + redirect regardless of what page user is on.
- Could interrupt critical flows (e.g., mid-payment, mid-form).
- **Fix:** Check current route before force-clearing; queue reauth for non-critical pages.

### 4.7 DashboardLayout.tsx

**Unapproved User State Stale**
- Line 166: If approval status changes, PendingApprovalLockout doesn't update without refresh.

**PendingApproval Poll Hammers API**
- Lines 336-337: Polls every 10s with no backoff.

---

### ~~4.8 OrgSwitcher.tsx — Hard Page Reload~~ (D-4: Intentional)

---

# Part 3: Prioritized Recommendations (Updated)

---

## ~~Immediate (Sprint 1)~~ — DONE

| # | Issue | Status |
|---|-------|--------|
| ~~1~~ | ~~Org isolation in chat.py~~ | **FP — Already secure** |
| ~~2~~ | ~~Filename sanitization~~ | **F-9: FIXED** |
| ~~3~~ | ~~Platform user ID validation~~ | **F-8: FIXED** |
| ~~4~~ | ~~CORS tightening~~ | **F-13: FIXED** |
| ~~5~~ | ~~Email validation~~ | **F-11: FIXED** |
| 6 | **Rate limiting** on webhook_line.py | **OPEN** — requires infrastructure (nginx/middleware) |
| ~~7~~ | ~~**Token refresh race condition** — cross-tab sync~~ | **F-46: FIXED** — BroadcastChannel cross-tab sync |
| ~~8~~ | ~~React Error Boundary~~ | **F-20: FIXED** |
| ~~9*~~ | ~~**Widget.py rate limiting** — public unauthenticated endpoints~~ | **F-34: FIXED** — slowapi 20–30/min limits |
| ~~10*~~ | ~~**Widget.py session auth** — session history enumerable~~ | **F-35: FIXED** — HMAC-SHA256 session tokens |
| ~~11*~~ | ~~**Widget.py message length** — no max_length~~ | **F-36: FIXED** — max_length=5000 |

| ~~12*~~ | ~~**ExternalOrgGuard** — uses deprecated `user.organization_id`~~ | **N-47: FIXED** — `homeOrgId` derived from `orgs` store with admin fallback |
| ~~13*~~ | ~~**DashboardLayout** — Organization nav hidden from members~~ | **N-48: FIXED** — `requireOrgAdmin` removed from /organization nav item |

**Sprint 1 progress: 12/13 done** (1 remaining: #6 rate limiting — infra)

## Short Term (Sprint 2) — Robustness

| # | Issue | Location | Status |
|---|-------|----------|--------|
| ~~9~~ | ~~Add **pagination** to list_sessions~~ | ~~inbox.py~~ | **F-43: FIXED** — `PagedSessionsResponse` + `.range()` |
| ~~10~~ | ~~Message length validation~~ | ~~inbox.py~~ | **F-17: FIXED** |
| ~~11~~ | ~~LINE message truncation~~ | ~~line_service.py~~ | **F-15: FIXED** |
| ~~12~~ | ~~**DB connection retry** with exponential backoff~~ | ~~database.py~~ | **F-39: FIXED** — 3-attempt retry, 2^n backoff |
| ~~13~~ | ~~Fix **WebChatPage polling memory leaks**~~ | ~~WebChatPage.tsx~~ | **F-44: FIXED** — `aborted` flag + cleanup |
| ~~14~~ | ~~Fix **InboxPage polling race conditions**~~ | ~~InboxPage.tsx~~ | **R9-F: FIXED** — `lastPollTimestampRef` reset on session select; poll skipped until `loadMessages` sets cursor |
| ~~15~~ | ~~Bot field validation~~ | ~~bot.py~~ | **F-18/F-19: FIXED** |
| ~~16~~ | ~~PDF upload validation~~ | ~~KnowledgeBasePage.tsx~~ | **F-21: FIXED** |
| ~~17~~ | ~~Duplicate email check optimization~~ | ~~organization.py~~ | **F-12: FIXED** |
| ~~18~~ | ~~LINE event structure validation~~ | ~~webhook_line.py~~ | **F-14: FIXED** |
| ~~19*~~ | ~~**i18n gaps: authStore.ts** — hardcoded Thai errors~~ | ~~authStore.ts~~ | **F-40: FIXED** — `getT()` non-hook helper |
| ~~20*~~ | ~~**i18n gaps: axios.ts** — forced redirect + Thai messages~~ | ~~axios.ts~~ | **F-41: FIXED** — `CustomEvent("session-expired")` |
| ~~21*~~ | ~~**i18n gaps: InboxPage timeAgo()**~~ | ~~InboxPage.tsx~~ | **F-42: FIXED** — full `TimeAgoLabels` interface |
| ~~22*~~ | ~~**i18n gaps: App.tsx** — loading/timeout Thai strings~~ | App.tsx | **FIXED (F-28)** |
| ~~23*~~ | ~~**i18n gaps: ForgotPassword/ResetPassword** — remaining Thai~~ | ~~ForgotPasswordPage, ResetPasswordPage~~ | **R9-C: FIXED** — `forgotPassword.sentDescBefore/After` + `resetPassword.updateFailed` keys added |
| ~~24*~~ | ~~**LoginPage registerMsg** — emoji-based success detection~~ | ~~LoginPage.tsx~~ | **F-38: FIXED** — `registerSuccess` boolean |
| ~~26*~~ | ~~**Remove all emojis from UI**~~ | ~~DashboardPage, InboxPage, WebChatPage~~ | **F-37: FIXED** — text labels + SVG icons |
| ~~25*~~ | ~~**/health/metrics auth** — unauthenticated server metrics~~ | ~~health.py~~ | **F-45: FIXED** — `Depends(get_current_user)` |

| ~~27*~~ | ~~**update_org slug collision** unhandled~~ | ~~organization.py~~ | **N-49: FIXED** — 2-attempt retry with 6-char random suffix |
| ~~28*~~ | ~~**InboxPage pagination frontend** — always page 1, no UI~~ | ~~InboxPage.tsx~~ | **N-50: FIXED** — `loadMoreSessions()` + Load More button + `totalSessions` state |
| ~~29*~~ | ~~**InboxPage dual heavy polling** — 41 req/min~~ | ~~InboxPage.tsx~~ | **N-51: FIXED** — sessions 3s→10s, messages 2s→5s (~18 req/min) |
| ~~30*~~ | ~~**widget.py hardcoded Thai in SSE**~~ | ~~widget.py~~ | **N-52: FIXED** — both strings replaced with English |
| ~~31*~~ | ~~**organization.py hardcoded Thai error messages**~~ | ~~organization.py~~ | **N-53: FIXED** — 11 Thai strings → English across promote/demote/delete/invite |
| ~~32*~~ | ~~**asyncio task warmup exceptions silently lost**~~ | ~~main.py~~ | **N-54: FIXED** — `add_done_callback` logs unhandled task exceptions |
| ~~33*~~ | ~~**Emoji lock icon in DashboardLayout sidebar**~~ | ~~DashboardLayout.tsx~~ | **N-55: FIXED** — SVG lock icon replaces emoji |

**Sprint 2 progress: 25/25 done** ✅

## Long Term (Sprint 3+) — Architecture

| # | Issue | Location | Effort |
|---|-------|----------|--------|
| ~~19~~ | ~~**Redis cache** for multi-process auth~~ | ~~auth.py~~ | **S3-19: FIXED** — optional `_RedisCache` with `_InMemoryCache` fallback; `REDIS_URL` config |
| 20 | **Owner assignment** at org creation (not first-accept) | organization.py:312 | **SKIPPED** — requires DB schema change (`invited_role` column); deferred indefinitely |
| ~~21~~ | ~~**Centralized error handling** — user-friendly messages~~ | ~~All pages~~ | **S3-21: FIXED** — `utils/apiError.ts` `getApiError()` utility; applied to 7 pages (19 call sites) |
| ~~22~~ | ~~Config validation on **startup** (Supabase, Ollama reachable)~~ | ~~main.py~~ | **S3-22: FIXED** — `_validate_startup_config()` checks required env vars + Ollama reachability |
| ~~23~~ | ~~**BroadcastChannel** for cross-tab state sync~~ | ~~supabaseClient.ts~~ | **F-46: FIXED** |
| 24 | Replace localStorage token with **httpOnly cookies** | Backend + Frontend | 1d |

| ~~25*~~ | ~~**`(pollData as any)` type casts** in InboxPage~~ | ~~InboxPage.tsx~~ | **N-56: FIXED** — `PollResponse` interface; type assertions removed |
| ~~26*~~ | ~~**`active_org_id` fallback** to deprecated field~~ | ~~auth.py~~ | **R9-M: FIXED** — `active_org_id = active_org_header or None` (no deprecated fallback) |
| ~~27*~~ | ~~**Startup worst-case 90s** (3×30s timeout)~~ | ~~database.py~~ | **N-58: FIXED** — timeout 30s→10s (max 30s startup worst-case) |
| ~~28*~~ | ~~**platformUserId random UUID** if user loads slowly~~ | ~~WebChatPage.tsx~~ | **N-59: FIXED** — `useEffect` updates ID when `user.id` becomes available |

**Sprint 3 progress: 9/10 done** (#20 owner assignment skipped — requires DB schema change)

---

# Appendix: File-by-File Issue Count (Current — After All Fixes)

| File | Critical | High | Medium | Low | Notes |
|------|----------|------|--------|-----|-------|
| **Backend** | | | | | |
| chat.py | 0 | 0 | 1 | 1 | ~~C2~~ FP, ~~H1~~ F-8 |
| document.py | 1 | 0 | 2 | 1 | ~~C1~~ F-9, ~~H1~~ F-10 |
| organization.py | 2 | 0 | 1 | 2 | ~~H1~~ F-11, ~~M1~~ F-12 |
| widget.py | 1 | 3 | 2 | 0 | Reopened Round 3 (was D-1) |
| webhook_line.py | 1 | 0 | 1 | 0 | ~~H1~~ F-14 |
| approval.py | 1 | 0 | 2 | 1 | |
| inbox.py | 0 | 0 | 2 | 0 | ~~M1~~ F-17 |
| bot.py | 0 | 0 | 1 | 0 | ~~M1~~ F-18/F-19 |
| health.py | 0 | 1 | 0 | 0 | ~~M1~~ F-16, +H1 metrics auth |
| main.py | 0 | 0 | 1 | 1 | ~~H1~~ F-13 |
| auth.py | 0 | 0 | 3 | 0 | |
| config.py | 0 | 0 | 0 | 2 | |
| database.py | 0 | 0 | 1 | 1 | |
| llm_generator.py | 0 | 0 | 2 | 1 | |
| line_service.py | 0 | 0 | 0 | 0 | ~~M1~~ F-15 |
| vector_search.py | 0 | 0 | 0 | 1 | |
| chunking.py | 0 | 0 | 0 | 1 | |
| line_auth.py | 0 | 0 | 0 | 2 | |
| **Frontend** | | | | | |
| WebChatPage.tsx | 2 | 1 | 3 | 3 | |
| InboxPage.tsx | 1 | 0 | 2 | 2 | |
| supabaseClient.ts | 2 | 1 | 2 | 1 | |
| axios.ts | 1 | 0 | 3 | 1 | |
| LoginPage.tsx | 0 | 1 | 1 | 1 | |
| KnowledgeBasePage.tsx | 0 | 0 | 1 | 2 | ~~M1~~ F-21 |
| BotsPage.tsx | 0 | 0 | 2 | 2 | |
| ResetPasswordPage.tsx | 0 | 1 | 0 | 1 | |
| DashboardPage.tsx | 0 | 0 | 2 | 1 | |
| DashboardLayout.tsx | 0 | 0 | 2 | 2 | |
| endpoints.ts | 0 | 1 | 2 | 2 | |
| authStore.ts | 1 | 0 | 2 | 1 | +C1 hardcoded Thai errors |
| orgStore.ts | 0 | 0 | 2 | 1 | |
| App.tsx / ProtectedRoute | 0 | 0 | 2 | 1 | ~~M1~~ F-20 |
| OrganizationPage.tsx | 0 | 0 | 1 | 1 | |
| i18n gaps (Round 3) | 2 | 4 | 1 | 0 | authStore, axios, InboxPage, App.tsx, LoginPage |
| Other pages | 0 | 0 | 2 | 2 | |

---

## Progress Tracker

| Metric | Value |
|--------|-------|
| Total issues found (Round 1+2) | ~124 |
| New issues (Round 3 — widget.py + i18n gaps) | +25 |
| **New issues (Round 6 — guard bug, polling, i18n backend)** | **+13** *(N-47–N-59)* |
| **Grand total** | **~162** |
| False positives confirmed (A, B, H) | -3 |
| **Fixed (Round 1 — Manual)** | **-7** |
| **Fixed (Round 2 — Agents)** | **-14** |
| **Fixed (Round 3 — i18n + CORS)** | **-6** |
| **Fixed (Round 4 — i18n completion + UX)** | **-5** *(F-28 to F-33)* |
| **Fixed (Round 5 — Code Review Implementation Plan, Phase 1–5)** | **-13** *(F-34 to F-46)* |
| **Fixed (Round 7 — Round 6 findings implementation)** | **-12** *(N-47–N-56, N-58–N-59)* |
| **Fixed (Round 9 — Non-LINE remaining issues)** | **-11** *(C, D, E, F, G, I, J, K, L, M/N-57, N/P)* |
| Intentional design (D-2,D-3,D-4) | -3 |
| **Remaining open** | **~88** |
| **Fix rate** | **~43% resolved (68 of ~159 net)** |

---

### Round 5 — Code Review Implementation Plan (Phase 1–5) [2026-04-04]

| ID | File | Fix |
|----|------|-----|
| F-34 | `backend/app/routers/widget.py` | Rate limiting via slowapi: `20/min` session, `30/min` chat/history |
| F-35 | `backend/app/routers/widget.py` | HMAC-SHA256 session tokens — `_sign_session()` + `_verify_session_token()` |
| F-36 | `backend/app/routers/widget.py` | `max_length=5000` on `WidgetChatRequest.message` |
| F-37 | `frontend/src/pages/DashboardPage.tsx`, `InboxPage.tsx`, `WebChatPage.tsx` | Remove emojis: text badge labels, SVG icons, `platformLabel()` replacing `platformIcon()` |
| F-38 | `frontend/src/pages/LoginPage.tsx` | `registerSuccess: boolean` state replaces emoji-string success detection |
| F-39 | `backend/app/core/database.py` | 3-attempt exponential backoff retry (1s→2s→4s) in `init_supabase()` |
| F-40 | `frontend/src/store/authStore.ts` + `frontend/src/i18n/index.ts` | `getT()` non-hook helper; authStore errors use `getT()("auth.*")` |
| F-41 | `frontend/src/api/axios.ts` + `frontend/src/App.tsx` | Session expired: `CustomEvent("session-expired")` dispatch + `useEffect` listener in `AuthProvider` |
| F-42 | `frontend/src/pages/InboxPage.tsx` | `timeAgo()` accepts full `TimeAgoLabels` interface; all time unit strings via `t()` |
| F-43 | `backend/app/routers/inbox.py` + `frontend/src/api/endpoints.ts` | Server-side pagination: `PagedSessionsResponse`, `.select(count="exact")`, `.range()` |
| F-44 | `frontend/src/pages/WebChatPage.tsx` | `aborted` flag prevents state updates after React effect cleanup |
| F-45 | `backend/app/routers/health.py` | `/health/metrics` now requires `Depends(get_current_user)` |
| F-46 | `frontend/src/api/supabaseClient.ts` | `BroadcastChannel("sundae-auth-sync")` for cross-tab token refresh coordination |

---

---

### Round 6 — New Issues Found [2026-04-04]

| ID | Severity | File | Issue |
|----|----------|------|-------|
| N-47 | **HIGH** | `App.tsx:167` | **ExternalOrgGuard uses deprecated `user.organization_id`** — guard is `isExternal = user.organization_id !== activeOrgId`. Users who joined org only via invitation (never had `organization_id` set) have `null` here, so `isExternal` is always `false`. Guard silently fails for invitation-joined platform staff. |
| N-48 | **HIGH** | `DashboardLayout.tsx:144` | **Organization nav item hidden from members** — `requireOrgAdmin: true` on `/organization` nav item means regular org members (role="member") have no sidebar link to the Org page. They can still access via URL, but no visual path to see member list or manage invitations. |
| N-49 | **MEDIUM** | `organization.py:549–552` | **update_org slug collision unhandled** — renaming an org computes a new slug and sends it directly to DB. If slug already exists in another org, DB throws and returns 500. No retry logic (unlike `create_org` which has the 2-attempt retry). |
| N-50 | **MEDIUM** | `InboxPage.tsx:131` | **Pagination backend ready but frontend always fetches page 1** — `listSessions()` uses `inboxApi.listSessions(orgId)` with no `page` param. `total` from paginated response is ignored. Orgs with > 20 sessions can't see older ones. No Load More / page nav UI. |
| N-51 | **MEDIUM** | `InboxPage.tsx:147–153, 200` | **Dual heavy polling** — sessions polled every 3s + messages every 2s ≈ 41 API calls/min when inbox is open. No backoff on errors. Load grows linearly with active admin users. |
| N-52 | **MEDIUM** | `widget.py:253, 381` | **Hardcoded Thai in widget SSE stream** — `"กำลังรอเจ้าหน้าที่ตอบกลับ"` (L253) and `"(ขออภัย เกิดข้อผิดพลาดขณะประมวลผล)"` (L381) are Thai-language strings in SSE tokens. Widget is for public visitors who may not speak Thai. |
| N-53 | **MEDIUM** | `organization.py:403,599,638,886,900,917,943,946,956` | **Multiple hardcoded Thai error messages in backend** — promote/demote/leave/delete validation errors return Thai text that surfaces directly in frontend toast. Non-Thai installations break. |
| N-54 | **MEDIUM** | `main.py:72` | **asyncio task warmup exceptions silently lost** — `asyncio.create_task(_warmup_models())` without storing the reference. If warmup raises unhandled exception, Python emits "Exception ignored in Task" to stderr only — not captured in structured logger. |
| N-55 | **MEDIUM** | `DashboardLayout.tsx:265` | **Emoji lock icon missed in Phase 3 cleanup** — `<div className="text-2xl mb-2">🔒</div>` in unapproved user sidebar still uses emoji. |
| N-56 | **LOW** | `InboxPage.tsx:209,216` | **`(pollData as any)` type assertions** — bypasses TypeScript safety on poll response. Should use `PollResponse` type from `types/index.ts`. |
| N-57 | **LOW** | `auth.py:191` | **`active_org_id` falls back to deprecated `organization_id`** — if `X-Active-Org` header is absent, falls back to `profile.organization_id` (deprecated single-org field). |
| N-58 | **LOW** | `database.py:48` | **Startup timeout worst-case 90s** — 3 attempts × 30s `asyncio.wait_for` timeout = up to 90s blocked startup before giving up. |
| N-59 | **LOW** | `WebChatPage.tsx:94` | **`platformUserId` may be random UUID when user loads slowly** — `useState(() => user?.id \|\| \`web-${...}\`)` initializer runs once. If `user` is null at mount (still loading), a random ID is generated and never updated even after user loads. |

---

### Round 7 — Round 6 Findings Implementation [2026-04-04]

| ID | File | Fix |
|----|------|-----|
| N-47 | `frontend/src/App.tsx`, `frontend/src/layouts/DashboardLayout.tsx` | ExternalOrgGuard: `homeOrgId` derived from `orgs.find(o => o.org_role === "admin")?.id` fallback; `isViewingExternalOrg` + `isStaffOnExternalOrg` derived from orgStore |
| N-48 | `frontend/src/layouts/DashboardLayout.tsx` | Removed `requireOrgAdmin` from `/organization` nav item — all authenticated users (admin/support/user) can see it |
| N-49 | `backend/app/routers/organization.py` | `update_org` slug collision: 2-attempt retry with 6-char random lowercase suffix on `unique`/`23505` DB error |
| N-50 | `frontend/src/pages/InboxPage.tsx`, `frontend/src/i18n/en.json`, `frontend/src/i18n/th.json` | Load More pagination: `totalSessions` state, `loadMoreSessions()` appends page N+1, Load More button shown when `sessions.length < totalSessions` |
| N-51 | `frontend/src/pages/InboxPage.tsx` | Sessions poll interval 3000→10_000ms, messages poll 2000→5000ms (~18 req/min vs ~41 req/min) |
| N-52 | `backend/app/routers/widget.py` | Handoff SSE: `"กำลังรอเจ้าหน้าที่"` → `"A human agent will respond shortly. Please wait."`. Error SSE: `"ขออภัย เกิดข้อผิดพลาด"` → `"(An error occurred while processing your request.)"` + removed `ensure_ascii=False` |
| N-53 | `backend/app/routers/organization.py` | 11 Thai strings in promote/demote/delete/invite flows → English: invitation expired, root org protection, missing requester, self-promote guard, member not found (×2), already admin, not admin, last admin guard, success messages |
| N-54 | `backend/app/main.py` | `asyncio.create_task(_warmup_models())` → store reference + `add_done_callback` logs unhandled exceptions via structured logger |
| N-55 | `frontend/src/layouts/DashboardLayout.tsx` | `<div class="text-2xl mb-2">🔒</div>` → inline SVG lock icon with `w-7 h-7 text-steel-400` |
| N-56 | `frontend/src/pages/InboxPage.tsx` | Added `PollResponse` interface `{ messages: Message[]; session_status: string }`; removed all `(pollData as any)` type assertions |
| N-58 | `backend/app/core/database.py` | `asyncio.wait_for` timeout 30s→10s (worst-case startup: 3×10s = 30s, down from 90s) |
| N-59 | `frontend/src/pages/WebChatPage.tsx` | `platformUserId` changed from `useState` initializer to state + `useEffect(() => { if (user?.id) setPlatformUserId(user.id) }, [user?.id])` |

---

### Round 9 — Non-LINE Remaining Issues Implementation [2026-04-04]

| ID | File | Fix |
|----|------|-----|
| A-FP | `backend/app/routers/document.py` | **False positive** — `link_document` already has `require_org_admin` + `.eq("organization_id", organization_id)` bot ownership check (lines 244–253). No change needed. |
| B-FP | `frontend/src/pages/LoginPage.tsx` | **False positive** — React JSX auto-escapes text content; no `dangerouslySetInnerHTML`. Auth error display is not XSS-vulnerable. No change needed. |
| R9-C | `frontend/src/pages/ForgotPasswordPage.tsx`, `frontend/src/pages/ResetPasswordPage.tsx`, `frontend/src/i18n/en.json`, `frontend/src/i18n/th.json` | ForgotPasswordPage: hardcoded Thai "กรุณาตรวจสอบอีเมล..." → `t("forgotPassword.sentDescBefore")` + `t("forgotPassword.sentDescAfter")`. ResetPasswordPage: hardcoded Thai error → `t("resetPassword.updateFailed")`. Added 3 new i18n keys in both JSON files. |
| R9-D | `frontend/src/pages/WebChatPage.tsx` | Stale closure fix: `tRef = useRef(t)` + `useEffect(() => { tRef.current = t }, [t])`. All 4 translated strings inside polling callback now use `tRef.current("...")` to prevent stale locale on language switch. |
| R9-E | `backend/app/services/llm_generator.py` | JSON decode wrapped in try-except (`JSONDecodeError` → log + return `FALLBACK_MESSAGE`). Stream non-JSON lines: log warning + `continue` instead of silently losing tokens. Non-streaming default timeout: 300s → 60s. |
| R9-F | `frontend/src/pages/InboxPage.tsx` | Polling race condition fix: `selectSession()` now resets `lastPollTimestampRef.current = null` before loading new session. Poll interval skips execution if `lastPollTimestampRef.current` is null (waits for `loadMessages` to set cursor). |
| R9-G | `frontend/src/pages/DashboardPage.tsx` | `Promise.allSettled` null reference fix: `raw?.sessions ?? (Array.isArray(raw) ? raw : [])` handles both paginated and legacy response shapes. Removed stale `isSupport` from `useEffect` dependency array. |
| H-FP | `frontend/src/pages/OrganizationPage.tsx` | **False positive** — `window.location.href` was already replaced with `navigate()` in a previous round (DangerZonePage fix). OrganizationPage already uses SPA navigation. No change needed. |
| R9-I | `frontend/src/layouts/DashboardLayout.tsx` | Replaced fixed `setInterval(poll, 10_000)` with exponential backoff: starts at 15s, doubles on each tick up to 60s ceiling. Skips fetch when `document.hidden`. Prevents API hammering when user is AFK. |
| R9-J | `backend/app/core/auth.py` | DB errors in `get_current_user` profile fetch now raise `HTTP 503 SERVICE_UNAVAILABLE` ("Unable to verify user profile. Please try again later.") instead of `HTTP 403`. Distinguishes infrastructure failures from auth failures. |
| R9-K | `frontend/src/store/orgStore.ts` | `fetchFailed` auto-retry: on error, schedules `setTimeout(() => { if (get().fetchFailed) get().fetchOrgs() }, 5000)`. If still failed after 5s, retries once. Allows UI to recover from transient network errors without user intervention. |
| R9-L | `frontend/src/api/axios.ts` | Token expiry buffer increased from 5 min (300s) to 10 min (600s) at all 3 check points. Timeout promise leak fixed: `timeoutId` stored in closure, cancelled via `sessionPromise.finally(() => clearTimeout(timeoutId))`. |
| R9-M | `backend/app/core/auth.py` | Removed deprecated `organization_id` fallback: `active_org_id = active_org_header or None` (was `active_org_header or profile.get("organization_id")`). Frontend always sends `X-Active-Org`; legacy field should not be used. Fixes N-57. |
| R9-N | `backend/app/core/config.py` | Added `ge=0.0, le=1.0` validators to `reranker_score_threshold`. Added configurable `parent_chunk_batch_size` (default 100) and `child_chunk_batch_size` (default 50) fields. |
| R9-P | `backend/app/services/vector_search.py` | `store_parent_chunks` and `store_child_chunks` now read batch sizes from `get_settings()` instead of hardcoded integers. Requires `from app.core.config import get_settings`. |

---

### Sprint 3 — Architecture Items Implementation [2026-04-05]

| ID | File | Fix |
|----|------|-----|
| S3-22 | `backend/app/main.py` | `_validate_startup_config()` in lifespan — checks `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` presence; probes Ollama at `{ollama_base_url}/api/tags` with 5s timeout (non-fatal warning if unreachable) |
| S3-19 | `backend/app/core/auth.py`, `backend/app/core/config.py`, `backend/requirements.txt` | Optional Redis cache: `_InMemoryCache` (per-process, existing behavior) and `_RedisCache` (distributed, multi-worker safe). Both expose async `get/set/invalidate/clear`. `_get_cache()` lazy-initializes: tries Redis if `REDIS_URL` set + reachable, falls back to in-memory on failure. Added `redis_url` + `cache_ttl_seconds` to config; `redis[asyncio]>=5.0.0` to requirements. |
| S3-20 | — | **SKIPPED** — owner assignment fix requires `invited_role` column in `org_invitations`. Deferred to avoid DB schema change. Thai strings in `invite_member` still fixed (email validation errors → English). |
| S3-21 | `frontend/src/utils/apiError.ts`, 7 page files | `getApiError(err, fallback)` utility: extracts `err.response.data.detail` (string or Pydantic array format), falls back to `err.message`, then to `fallback`. Replaces 19 verbose inline type casts across: `OrganizationPage`, `ApprovalsPage`, `CreateOrgPage`, `DangerZonePage`, `IntegrationPage`, `ProfilePage` |

---

*Report generated by Claude Code — 2026-03-22*
*Last updated: 2026-04-05 — Sprint 3 done (9/10; #20 skipped — DB schema change). Sprint 1: 12/13. Sprint 2: 25/25 ✅. Sprint 3: 9/10. Overall fix rate: ~49%.*
