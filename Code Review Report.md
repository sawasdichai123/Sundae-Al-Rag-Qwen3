# SUNDAE Project — Full Code Review Report

**Review Date:** 2026-03-22 (initial) · 2026-03-28 (Round 3 re-review)
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
| Frontend i18n Coverage | 7.5/10 | NEW (system works but gaps in authStore, axios, timeAgo, App.tsx) |
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

**Non-functional Feature**
- Lines 103-106: Toggle state doesn't persist. User toggles, refreshes, changes lost.

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

**CRITICAL: authStore.ts Hardcoded Thai Error Messages**
- Error messages like "ไม่สามารถโหลดข้อมูลผู้ใช้ได้", "กรุณาเข้าสู่ระบบใหม่" bypass i18n entirely.
- These appear as toast/error messages — user sees Thai regardless of locale setting.
- **Fix:** Replace with `t("auth.loadFailed")` etc. (requires passing `t` to store or using store-level translations).

**CRITICAL: axios.ts Forced Redirect Loses User Data**
- On 401, `window.location.href = "/login"` fires immediately, discarding any unsaved form data.
- **Fix:** Emit event → let component show "session expired" dialog → user chooses to redirect.

**HIGH: WebChatPage Stale Closure with t()**
- `t` function captured in polling callbacks may reference stale locale if user switches language mid-chat.
- **Fix:** Use `useRef` for `t` in polling callbacks, or read locale directly from store.

**HIGH: InboxPage Hardcoded Thai in timeAgo()**
- `timeAgo()` helper returns hardcoded Thai strings ("วันที่แล้ว", "ชั่วโมงที่แล้ว") not covered by i18n.
- **Fix:** Replace with `t("common.daysAgo")` etc.

**HIGH: LoginPage registerMsg Success Detection Relies on Emoji**
- Line checks for "✅" emoji in message string to determine success vs error styling.
- **Risk:** Fragile — changing translation text breaks the logic.
- **Fix:** Use a separate `isSuccess` boolean flag instead of parsing message content.

**HIGH: ForgotPasswordPage / ResetPasswordPage Hardcoded Thai**
- Several strings still hardcoded Thai after i18n pass (toast messages, edge case texts).
- **Fix:** Add missing keys to JSON files and replace hardcoded strings.

**HIGH: App.tsx Hardcoded Thai in Loading/Timeout States**
- "กำลังโหลด..." and timeout messages not covered by i18n.
- **Fix:** These are outside React tree where `useT()` works — use direct store read or static translations.

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
| 7 | **Token refresh race condition** — cross-tab sync | **OPEN** — complex frontend refactor |
| ~~8~~ | ~~React Error Boundary~~ | **F-20: FIXED** |
| 9* | **Widget.py rate limiting** — public unauthenticated endpoints | **OPEN** — CRITICAL, needs middleware |
| 10* | **Widget.py session auth** — session history enumerable | **OPEN** — HIGH, needs HMAC tokens |
| 11* | **Widget.py message length** — no max_length | **OPEN** — HIGH, quick fix |

**Sprint 1 progress: 6/11 done** (5 remaining — 3 new from widget.py)

## Short Term (Sprint 2) — Robustness

| # | Issue | Location | Status |
|---|-------|----------|--------|
| 9 | Add **pagination** to list_sessions, admin org list | inbox.py, organization.py | OPEN |
| ~~10~~ | ~~Message length validation~~ | ~~inbox.py~~ | **F-17: FIXED** |
| ~~11~~ | ~~LINE message truncation~~ | ~~line_service.py~~ | **F-15: FIXED** |
| 12 | **DB connection retry** with exponential backoff | database.py | OPEN |
| 13 | Fix **WebChatPage polling memory leaks** | WebChatPage.tsx | OPEN |
| 14 | Fix **InboxPage polling race conditions** | InboxPage.tsx | OPEN |
| ~~15~~ | ~~Bot field validation~~ | ~~bot.py~~ | **F-18/F-19: FIXED** |
| ~~16~~ | ~~PDF upload validation~~ | ~~KnowledgeBasePage.tsx~~ | **F-21: FIXED** |
| ~~17~~ | ~~Duplicate email check optimization~~ | ~~organization.py~~ | **F-12: FIXED** |
| ~~18~~ | ~~LINE event structure validation~~ | ~~webhook_line.py~~ | **F-14: FIXED** |
| 19* | **i18n gaps: authStore.ts** — hardcoded Thai errors | authStore.ts | OPEN |
| 20* | **i18n gaps: axios.ts** — forced redirect + Thai messages | axios.ts | OPEN |
| 21* | **i18n gaps: InboxPage timeAgo()** — hardcoded Thai | InboxPage.tsx | OPEN |
| 22* | **i18n gaps: App.tsx** — loading/timeout Thai strings | App.tsx | OPEN |
| 23* | **i18n gaps: ForgotPassword/ResetPassword** — remaining Thai | ForgotPasswordPage, ResetPasswordPage | OPEN |
| 24* | **LoginPage registerMsg** — emoji-based success detection | LoginPage.tsx | OPEN |
| 25* | **/health/metrics auth** — unauthenticated server metrics | health.py | OPEN |

**Sprint 2 progress: 6/17 done** (11 remaining — 7 new from Round 3)

## Long Term (Sprint 3+) — Architecture

| # | Issue | Location | Effort |
|---|-------|----------|--------|
| 19 | **Redis cache** for multi-process auth | auth.py | 4h |
| 20 | **Owner assignment** at org creation (not first-accept) | organization.py:312 | 2h |
| 21 | **Centralized error handling** — user-friendly messages | All pages | 1d |
| 22 | Config validation on **startup** (Supabase, Ollama reachable) | main.py | 2h |
| 23 | **BroadcastChannel** for cross-tab state sync | supabaseClient.ts | 4h |
| 24 | Replace localStorage token with **httpOnly cookies** | Backend + Frontend | 1d |

**Sprint 3 progress: 0/6 done**

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
| **Grand total** | **~149** |
| False positives removed | -2 |
| **Fixed (Round 1 — Manual)** | **-7** |
| **Fixed (Round 2 — Agents)** | **-14** |
| **Fixed (Round 3 — i18n + CORS)** | **-6** |
| Intentional design (D-2,D-3,D-4) | -3 |
| **Remaining** | **~117** |
| **Fix rate** | **21% resolved (27 of ~149)** |

---

*Report generated by Claude Code — 2026-03-22*
*Last updated: 2026-03-28 — Round 3 re-review complete. Widget.py included. i18n system added (F-22–F-27). Sprint 1: 6/11. Sprint 2: 6/17.*
