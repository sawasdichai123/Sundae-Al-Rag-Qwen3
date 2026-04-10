/**
 * SUNDAE Chat Widget — Embeddable Script v2
 *
 * Usage:
 *   <script src="https://YOUR_SERVER/static/widget.js"
 *           data-org-id="ORG_UUID"
 *           data-server="https://YOUR_SERVER"
 *           data-theme="#ffd100"
 *           data-title="SUNDAE Chat">
 *   </script>
 *
 * Features:
 *   - Bot selection screen (when org has multiple web-enabled bots)
 *   - "Switch Bot" button in header
 *   - Human takeover mode: AI stops, admin replies via Inbox
 *   - Polling for admin replies (3s open / 10s minimised)
 *   - Unread message badge on FAB while widget is closed
 *   - Session + HMAC token persisted in localStorage
 *   - SSE streaming AI responses
 */

(function () {
  "use strict";

  // ── Config ─────────────────────────────────────────────────────
  const scriptTag = document.currentScript;
  const ORG_ID = scriptTag?.getAttribute("data-org-id") || "";
  const SERVER = (scriptTag?.getAttribute("data-server") || "").replace(/\/$/, "");
  const THEME_COLOR = scriptTag?.getAttribute("data-theme") || "#6C63FF";
  const TITLE = scriptTag?.getAttribute("data-title") || "SUNDAE Chat";

  if (!ORG_ID || !SERVER) {
    console.error("[SUNDAE Widget] Missing data-org-id or data-server attribute.");
    return;
  }

  // ── State ──────────────────────────────────────────────────────
  let currentBotId = "";
  let sessionId = null;
  let sessionToken = null;
  let sessionStatus = "active";
  let lastPollTs = null;
  let pollHandle = null;
  let isOpen = false;
  let isLoading = false;
  let allBots = [];          // [{id, name}, ...]
  let viewMode = "loading";  // "selector" | "chat"
  let unreadCount = 0;

  // ── Storage helpers ────────────────────────────────────────────
  function stKey(botId) { return "sundae_widget_" + botId; }

  function loadStored(botId) {
    try {
      var raw = localStorage.getItem(stKey(botId));
      if (!raw) { sessionId = null; sessionToken = null; lastPollTs = null; return; }
      var p = JSON.parse(raw);
      sessionId = p.id || null;
      sessionToken = p.token || null;
      lastPollTs = p.ts || null;
    } catch (_) { sessionId = null; sessionToken = null; lastPollTs = null; }
  }

  function saveStored(botId) {
    try {
      localStorage.setItem(stKey(botId), JSON.stringify({ id: sessionId, token: sessionToken, ts: lastPollTs }));
    } catch (_) {}
  }

  function clearStored(botId) {
    localStorage.removeItem(stKey(botId));
    sessionId = null; sessionToken = null; lastPollTs = null;
  }

  // ── Inject styles ──────────────────────────────────────────────
  var style = document.createElement("style");
  style.textContent = "\
    .sw-fab {\
      position: fixed; bottom: 24px; right: 24px; z-index: 99999;\
      width: 60px; height: 60px; border-radius: 50%;\
      background: " + THEME_COLOR + "; border: none; cursor: pointer;\
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);\
      display: flex; align-items: center; justify-content: center;\
      transition: transform 0.3s ease, box-shadow 0.3s ease;\
    }\
    .sw-fab:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(0,0,0,0.35); }\
    .sw-fab-icon { width: 28px; height: 28px; fill: #fff; }\
    .sw-badge {\
      position: absolute; top: -3px; right: -3px;\
      min-width: 18px; height: 18px; border-radius: 9px;\
      background: #ef4444; border: 2px solid #fff;\
      font-size: 10px; font-weight: 700; color: #fff;\
      display: none; align-items: center; justify-content: center; padding: 0 3px;\
    }\
    .sw-badge.sw-visible { display: flex; }\
    .sw-container {\
      position: fixed; bottom: 96px; right: 24px; z-index: 99999;\
      width: 380px; max-width: calc(100vw - 32px);\
      height: 540px; max-height: calc(100vh - 120px);\
      background: #fff; border-radius: 16px;\
      box-shadow: 0 8px 40px rgba(0,0,0,0.15);\
      display: flex; flex-direction: column;\
      overflow: hidden; font-family: Inter, 'Noto Sans Thai', sans-serif;\
      opacity: 0; transform: translateY(20px) scale(0.95);\
      transition: opacity 0.25s ease, transform 0.25s ease;\
      pointer-events: none;\
    }\
    .sw-container.sw-open { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }\
    .sw-header {\
      background: " + THEME_COLOR + "; color: #fff;\
      padding: 12px 16px; display: flex; align-items: center; gap: 8px;\
      flex-shrink: 0;\
    }\
    .sw-header-title { flex: 1; font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\
    .sw-switch-btn {\
      background: rgba(255,255,255,0.22); border: none; border-radius: 8px;\
      color: #fff; font-size: 11px; font-weight: 600; padding: 4px 9px;\
      cursor: pointer; transition: background 0.2s; white-space: nowrap;\
      display: none;\
    }\
    .sw-switch-btn:hover { background: rgba(255,255,255,0.38); }\
    .sw-switch-btn.sw-show { display: block; }\
    .sw-header-close {\
      background: none; border: none; color: #fff;\
      font-size: 22px; line-height: 1; cursor: pointer;\
      padding: 0 2px; opacity: 0.75; transition: opacity 0.2s;\
    }\
    .sw-header-close:hover { opacity: 1; }\
    .sw-banner {\
      padding: 7px 16px; font-size: 12px; font-weight: 500;\
      display: none; align-items: center; gap: 8px; flex-shrink: 0;\
    }\
    .sw-banner.sw-takeover { display: flex; background: #fffbeb; color: #92400e; border-bottom: 1px solid #fde68a; }\
    .sw-banner.sw-resolved { display: flex; background: #f0fdf4; color: #166534; border-bottom: 1px solid #bbf7d0; }\
    .sw-banner-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }\
    .sw-takeover .sw-banner-dot { background: #f59e0b; animation: sw-pulse 1.5s infinite; }\
    .sw-resolved .sw-banner-dot { background: #22c55e; }\
    @keyframes sw-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }\
    @keyframes sw-fadein { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }\
    .sw-messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }\
    .sw-msg {\
      max-width: 85%; padding: 10px 14px; border-radius: 14px;\
      font-size: 14px; line-height: 1.5; word-wrap: break-word;\
      animation: sw-fadein 0.2s ease;\
    }\
    .sw-msg-user { align-self: flex-end; background: " + THEME_COLOR + "; color: #fff; border-bottom-right-radius: 4px; }\
    .sw-msg-bot { align-self: flex-start; background: #f0f0f5; color: #1a1a2e; border-bottom-left-radius: 4px; }\
    .sw-msg-admin {\
      align-self: flex-start; background: #dbeafe; color: #1e3a5f;\
      border-bottom-left-radius: 4px; border-left: 3px solid #3b82f6;\
    }\
    .sw-msg-label { font-size: 10px; font-weight: 600; opacity: 0.65; display: block; margin-bottom: 3px; }\
    .sw-typing { background: #f0f0f5 !important; color: #999 !important; font-style: italic; }\
    .sw-welcome { text-align: center; color: #888; font-size: 13px; padding: 32px 20px 20px; line-height: 1.7; }\
    .sw-selector { padding: 20px 16px; }\
    .sw-selector-title { font-size: 13px; font-weight: 600; color: #555; margin-bottom: 14px; text-align: center; }\
    .sw-bot-btn {\
      width: 100%; padding: 12px 16px; margin-bottom: 8px;\
      background: #f8f9fa; border: 2px solid #e9ecef; border-radius: 12px;\
      font-size: 14px; font-weight: 600; color: #1a1a2e;\
      cursor: pointer; text-align: left; display: flex; align-items: center; gap: 10px;\
      transition: background 0.2s, border-color 0.2s; font-family: inherit;\
    }\
    .sw-bot-btn:hover { background: #f0f0f5; border-color: " + THEME_COLOR + "; }\
    .sw-input-area {\
      display: flex; gap: 8px; padding: 12px 16px;\
      border-top: 1px solid #eee; background: #fafafa; flex-shrink: 0;\
    }\
    .sw-input {\
      flex: 1; border: 1px solid #ddd; border-radius: 10px;\
      padding: 10px 14px; font-size: 14px; outline: none;\
      font-family: inherit; resize: none; transition: border-color 0.2s;\
    }\
    .sw-input:focus { border-color: " + THEME_COLOR + "; }\
    .sw-input:disabled { background: #f5f5f5; color: #aaa; }\
    .sw-send {\
      background: " + THEME_COLOR + "; border: none; border-radius: 10px;\
      color: #fff; padding: 0 16px; cursor: pointer;\
      font-size: 14px; font-weight: 600; transition: opacity 0.2s; flex-shrink: 0;\
    }\
    .sw-send:disabled { opacity: 0.45; cursor: not-allowed; }\
    .sw-send:hover:not(:disabled) { opacity: 0.82; }\
    .sw-spinner { display: flex; align-items: center; justify-content: center; height: 80px; color: #aaa; font-size: 13px; }\
  ";
  document.head.appendChild(style);

  // ── Build DOM ──────────────────────────────────────────────────
  // FAB
  var fab = document.createElement("button");
  fab.className = "sw-fab";
  fab.style.position = "relative";
  fab.setAttribute("aria-label", "Open chat");
  fab.innerHTML = '<svg class="sw-fab-icon" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg><span class="sw-badge" id="sw-badge"></span>';
  document.body.appendChild(fab);

  // Container
  var container = document.createElement("div");
  container.className = "sw-container";
  container.innerHTML = '\
    <div class="sw-header">\
      <span class="sw-header-title" id="sw-title"></span>\
      <button class="sw-switch-btn" id="sw-switch-btn">เปลี่ยนบอท</button>\
      <button class="sw-header-close" aria-label="Close">&times;</button>\
    </div>\
    <div class="sw-banner" id="sw-banner"><span class="sw-banner-dot"></span><span id="sw-banner-text"></span></div>\
    <div class="sw-messages" id="sw-messages"><div class="sw-spinner">กำลังโหลด...</div></div>\
    <div class="sw-input-area" id="sw-input-area" style="display:none">\
      <input class="sw-input" id="sw-input" type="text" placeholder="พิมพ์ข้อความ..." autocomplete="off" />\
      <button class="sw-send" id="sw-send" disabled>ส่ง</button>\
    </div>\
  ';
  document.body.appendChild(container);

  // DOM refs
  var badgeEl   = document.getElementById("sw-badge");
  var titleEl   = document.getElementById("sw-title");
  var switchBtn = document.getElementById("sw-switch-btn");
  var closeBtn  = container.querySelector(".sw-header-close");
  var banner    = document.getElementById("sw-banner");
  var bannerTxt = document.getElementById("sw-banner-text");
  var msgDiv    = document.getElementById("sw-messages");
  var inputArea = document.getElementById("sw-input-area");
  var inputEl   = document.getElementById("sw-input");
  var sendBtn   = document.getElementById("sw-send");

  // ── Event listeners ────────────────────────────────────────────
  fab.addEventListener("click", function () { toggle(true); });
  closeBtn.addEventListener("click", function () { toggle(false); });
  switchBtn.addEventListener("click", handleSwitchBot);
  inputEl.addEventListener("input", function () {
    sendBtn.disabled = !inputEl.value.trim() || isLoading || sessionStatus === "resolved" || sessionStatus === "helped";
  });
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  sendBtn.addEventListener("click", sendMessage);

  // ── Init ───────────────────────────────────────────────────────
  init();

  async function init() {
    try {
      var res = await fetch(SERVER + "/api/widget/bots?org_id=" + encodeURIComponent(ORG_ID));
      if (res.ok) allBots = await res.json();
    } catch (_) {}
    if (!allBots.length) {
      console.error("[SUNDAE Widget] No web-enabled bots found for this org.");
      return;
    }

    // Always show selector first (no bot is pre-selected)
    viewMode = "selector";
    showSelector();
  }

  // ── View: Bot Selector ─────────────────────────────────────────
  function showSelector() {
    titleEl.textContent = TITLE;
    switchBtn.classList.remove("sw-show");
    inputArea.style.display = "none";
    setBanner("none");
    stopPoll();
    msgDiv.innerHTML = "";

    var wrap = document.createElement("div");
    wrap.className = "sw-selector";
    var heading = document.createElement("p");
    heading.className = "sw-selector-title";
    heading.textContent = "เลือกบอทที่ต้องการคุยด้วย \uD83E\uDD16";
    wrap.appendChild(heading);

    allBots.forEach(function (bot) {
      var btn = document.createElement("button");
      btn.className = "sw-bot-btn";
      btn.innerHTML = "\uD83E\uDD16 " + escapeHtml(bot.name);
      btn.addEventListener("click", function () { selectBot(bot); });
      wrap.appendChild(btn);
    });
    msgDiv.appendChild(wrap);
  }

  function selectBot(bot) {
    currentBotId = bot.id;
    loadStored(currentBotId);
    viewMode = "chat";
    showChat(currentBotId);
  }

  // ── View: Chat ─────────────────────────────────────────────────
  async function showChat(botId) {
    var bot = allBots.find(function (b) { return b.id === botId; }) || { id: botId, name: TITLE };
    titleEl.textContent = bot.name;
    switchBtn.classList.add("sw-show");
    inputArea.style.display = "flex";
    msgDiv.innerHTML = "";
    stopPoll();
    sessionStatus = "active";
    setBanner("none");

    if (sessionId && sessionToken) {
      await loadHistory();
    } else {
      addWelcome();
    }
    sendBtn.disabled = !inputEl.value.trim() || isLoading;
  }

  function handleSwitchBot() {
    stopPoll();
    sessionStatus = "active";
    currentBotId = "";
    viewMode = "selector";
    showSelector();
  }


  // ── Messages ───────────────────────────────────────────────────
  function addWelcome() {
    var div = document.createElement("div");
    div.className = "sw-welcome";
    div.innerHTML = "สวัสดีค่ะ! \uD83D\uDC4B<br>มีอะไรให้ช่วยเหลือไหมคะ?";
    msgDiv.appendChild(div);
  }

  function addMessage(text, role) {
    var welcome = msgDiv.querySelector(".sw-welcome");
    if (welcome) welcome.remove();

    var div = document.createElement("div");
    if (role === "user") {
      div.className = "sw-msg sw-msg-user";
      div.textContent = text;
    } else if (role === "admin") {
      div.className = "sw-msg sw-msg-admin";
      var label = document.createElement("span");
      label.className = "sw-msg-label";
      label.textContent = "Admin";
      div.appendChild(label);
      div.appendChild(document.createTextNode(text));
    } else {
      div.className = "sw-msg sw-msg-bot";
      div.textContent = text;
    }
    msgDiv.appendChild(div);
    msgDiv.scrollTop = msgDiv.scrollHeight;
    return div;
  }

  // ── Send message (SSE stream) ──────────────────────────────────
  async function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || isLoading) return;

    isLoading = true;
    inputEl.value = "";
    inputEl.disabled = true;
    sendBtn.disabled = true;

    addMessage(text, "user");
    var botBubble = addMessage("กำลังพิมพ์...", "bot");
    botBubble.classList.add("sw-typing");

    try {
      var resp = await fetch(SERVER + "/api/widget/chat/" + currentBotId, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId, session_token: sessionToken }),
      });

      if (!resp.ok) {
        var errBody = await resp.json().catch(function () { return {}; });
        throw new Error(errBody.detail || "HTTP " + resp.status);
      }

      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      var fullAnswer = "";
      var firstToken = true;

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line.startsWith("data: ")) continue;
          var jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            var data = JSON.parse(jsonStr);
            if (data.type === "token") {
              if (firstToken) {
                botBubble.textContent = "";
                botBubble.classList.remove("sw-typing");
                firstToken = false;
              }
              fullAnswer += data.content;
              botBubble.textContent = fullAnswer;
              msgDiv.scrollTop = msgDiv.scrollHeight;
            } else if (data.type === "done") {
              if (data.session_id) {
                sessionId = data.session_id;
                sessionToken = data.session_token || null;
                lastPollTs = new Date().toISOString();
                saveStored(currentBotId);
              }
              if (data.session_status) {
                applyStatus(data.session_status);
              }
            }
          } catch (_) {}
        }
      }

      if (firstToken) {
        botBubble.classList.remove("sw-typing");
        if (!botBubble.textContent) botBubble.textContent = "ขออภัยค่ะ ไม่สามารถประมวลผลได้ในขณะนี้";
      }
    } catch (err) {
      console.error("[SUNDAE Widget]", err);
      botBubble.textContent = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
      botBubble.classList.remove("sw-typing");
    } finally {
      isLoading = false;
      var ended = sessionStatus === "resolved" || sessionStatus === "helped";
      inputEl.disabled = ended;
      sendBtn.disabled = !inputEl.value.trim() || ended;
      if (!ended) inputEl.focus();
    }
  }

  // ── Load history ───────────────────────────────────────────────
  async function loadHistory() {
    if (!sessionId || !sessionToken) { addWelcome(); return; }
    try {
      var url = SERVER + "/api/widget/history/" + encodeURIComponent(sessionId) +
                "?session_token=" + encodeURIComponent(sessionToken);
      var res = await fetch(url);
      if (!res.ok) {
        // Invalid or expired session — start fresh
        clearStored(currentBotId);
        addWelcome();
        return;
      }
      var msgs = await res.json();
      if (!msgs.length) { addWelcome(); return; }

      lastPollTs = msgs[msgs.length - 1].created_at;
      saveStored(currentBotId);

      msgs.forEach(function (msg) {
        if (msg.role === "user" || msg.role === "assistant" || msg.role === "admin") {
          addMessage(msg.content, msg.role === "assistant" ? "bot" : msg.role);
        }
      });

      // Sync current status + missed admin messages
      await pollOnce();
    } catch (err) {
      console.warn("[SUNDAE Widget] History load failed:", err);
      addWelcome();
    }
  }

  // ── Status & polling ───────────────────────────────────────────
  function applyStatus(status) {
    sessionStatus = status;
    setBanner(status);

    var ended = status === "resolved" || status === "helped";
    inputEl.disabled = ended;
    sendBtn.disabled = ended;
    inputEl.placeholder = ended ? "การสนทนาสิ้นสุดแล้ว" : "พิมพ์ข้อความ...";

    if (status === "human_takeover") {
      startPoll();
    } else {
      stopPoll();
    }
  }

  function setBanner(status) {
    banner.className = "sw-banner";
    if (status === "human_takeover") {
      banner.classList.add("sw-takeover");
      bannerTxt.textContent = "Admin กำลังช่วยเหลือคุณอยู่ กรุณารอสักครู่...";
    } else if (status === "resolved") {
      banner.classList.add("sw-resolved");
      bannerTxt.textContent = "การสนทนาสิ้นสุดแล้ว ขอบคุณที่ใช้บริการ";
    } else if (status === "helped") {
      banner.classList.add("sw-resolved");
      bannerTxt.textContent = "ปัญหาได้รับการแก้ไขแล้ว";
    }
  }

  function startPoll() {
    if (pollHandle) return;
    pollHandle = setInterval(function () { pollOnce(); }, isOpen ? 3000 : 10000);
  }

  function stopPoll() {
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
  }

  async function pollOnce() {
    if (!sessionId || !sessionToken || !lastPollTs) return;
    try {
      var url = SERVER + "/api/widget/poll/" + encodeURIComponent(sessionId) +
                "?after=" + encodeURIComponent(lastPollTs) +
                "&token=" + encodeURIComponent(sessionToken);
      var res = await fetch(url);
      if (!res.ok) return;
      var data = await res.json();

      // Status sync
      if (data.session_status && data.session_status !== sessionStatus) {
        applyStatus(data.session_status);
      }

      // New admin messages
      var newMsgs = (data.messages || []).filter(function (m) { return m.role === "admin"; });
      if (newMsgs.length > 0) {
        lastPollTs = newMsgs[newMsgs.length - 1].created_at;
        saveStored(currentBotId);

        if (isOpen && viewMode === "chat") {
          newMsgs.forEach(function (m) { addMessage(m.content, "admin"); });
        } else {
          // Widget is closed or on selector — show badge
          unreadCount += newMsgs.length;
          badgeEl.textContent = unreadCount;
          badgeEl.classList.add("sw-visible");
        }
      }
    } catch (_) {}
  }

  // ── Toggle open/close ──────────────────────────────────────────
  function toggle(open) {
    isOpen = open;
    container.classList.toggle("sw-open", open);

    if (open) {
      // Clear unread badge
      unreadCount = 0;
      badgeEl.textContent = "";
      badgeEl.classList.remove("sw-visible");

      if (viewMode === "chat") {
        inputEl.focus();
        pollOnce(); // catch up on missed messages immediately
      }

      // Speed up poll interval when widget is open
      if (pollHandle) {
        clearInterval(pollHandle);
        pollHandle = setInterval(function () { pollOnce(); }, 3000);
      }
    } else {
      // Slow down poll interval when widget is closed
      if (pollHandle) {
        clearInterval(pollHandle);
        pollHandle = setInterval(function () { pollOnce(); }, 10000);
      }
    }
  }

  // ── Utils ──────────────────────────────────────────────────────
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
