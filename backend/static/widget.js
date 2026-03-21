/**
 * SUNDAE Chat Widget — Embeddable Script
 *
 * Usage: Add to any website:
 *   <script src="https://YOUR_SERVER/static/widget.js"
 *           data-bot-id="BOT_UUID"
 *           data-server="https://YOUR_SERVER"
 *           data-theme="#6C63FF"
 *           data-title="SUNDAE Chat">
 *   </script>
 *
 * Features:
 *   - Floating chat bubble (bottom-right)
 *   - SSE streaming responses (real-time typing)
 *   - Session persistence via localStorage
 *   - Responsive and mobile-friendly
 *   - Isolated styles (Shadow DOM not needed — all classes prefixed)
 */

(function () {
  "use strict";

  // ── Config from script tag ────────────────────────────────────
  const scriptTag = document.currentScript;
  const BOT_ID = scriptTag?.getAttribute("data-bot-id") || "";
  const SERVER = (scriptTag?.getAttribute("data-server") || "").replace(/\/$/, "");
  const THEME_COLOR = scriptTag?.getAttribute("data-theme") || "#6C63FF";
  const TITLE = scriptTag?.getAttribute("data-title") || "SUNDAE Chat";

  if (!BOT_ID || !SERVER) {
    console.error("[SUNDAE Widget] Missing data-bot-id or data-server attribute.");
    return;
  }

  const STORAGE_KEY = `sundae_widget_session_${BOT_ID}`;

  // ── State ─────────────────────────────────────────────────────
  let sessionId = localStorage.getItem(STORAGE_KEY) || null;
  let isOpen = false;
  let isLoading = false;

  // ── Inject styles ─────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    .sw-fab {
      position: fixed; bottom: 24px; right: 24px; z-index: 99999;
      width: 60px; height: 60px; border-radius: 50%;
      background: ${THEME_COLOR}; border: none; cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    .sw-fab:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(0,0,0,0.35); }
    .sw-fab svg { width: 28px; height: 28px; fill: #fff; }
    .sw-container {
      position: fixed; bottom: 96px; right: 24px; z-index: 99999;
      width: 380px; max-width: calc(100vw - 32px);
      height: 520px; max-height: calc(100vh - 120px);
      background: #fff; border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.15);
      display: flex; flex-direction: column;
      overflow: hidden; font-family: 'Inter', 'Noto Sans Thai', sans-serif;
      opacity: 0; transform: translateY(20px) scale(0.95);
      transition: opacity 0.25s ease, transform 0.25s ease;
      pointer-events: none;
    }
    .sw-container.sw-open {
      opacity: 1; transform: translateY(0) scale(1);
      pointer-events: auto;
    }
    .sw-header {
      background: ${THEME_COLOR}; color: #fff;
      padding: 16px 20px; font-size: 15px; font-weight: 600;
      display: flex; align-items: center; justify-content: space-between;
    }
    .sw-header-close {
      background: none; border: none; color: #fff;
      font-size: 20px; cursor: pointer; padding: 0 4px;
      opacity: 0.8; transition: opacity 0.2s;
    }
    .sw-header-close:hover { opacity: 1; }
    .sw-messages {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .sw-msg {
      max-width: 85%; padding: 10px 14px;
      border-radius: 14px; font-size: 14px; line-height: 1.5;
      word-wrap: break-word; animation: sw-fadein 0.2s ease;
    }
    @keyframes sw-fadein {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .sw-msg-user {
      align-self: flex-end;
      background: ${THEME_COLOR}; color: #fff;
      border-bottom-right-radius: 4px;
    }
    .sw-msg-bot {
      align-self: flex-start;
      background: #f0f0f5; color: #1a1a2e;
      border-bottom-left-radius: 4px;
    }
    .sw-msg-bot.sw-typing {
      background: #f0f0f5; color: #888;
      font-style: italic;
    }
    .sw-input-area {
      display: flex; gap: 8px; padding: 12px 16px;
      border-top: 1px solid #eee; background: #fafafa;
    }
    .sw-input {
      flex: 1; border: 1px solid #ddd; border-radius: 10px;
      padding: 10px 14px; font-size: 14px; outline: none;
      font-family: inherit; resize: none;
      transition: border-color 0.2s;
    }
    .sw-input:focus { border-color: ${THEME_COLOR}; }
    .sw-input:disabled { background: #f5f5f5; }
    .sw-send {
      background: ${THEME_COLOR}; border: none; border-radius: 10px;
      color: #fff; padding: 0 16px; cursor: pointer;
      font-size: 14px; font-weight: 600;
      transition: opacity 0.2s;
    }
    .sw-send:disabled { opacity: 0.5; cursor: not-allowed; }
    .sw-send:hover:not(:disabled) { opacity: 0.85; }
    .sw-welcome {
      text-align: center; color: #888; font-size: 13px;
      padding: 20px; line-height: 1.6;
    }
  `;
  document.head.appendChild(style);

  // ── Build DOM ─────────────────────────────────────────────────

  // FAB button
  const fab = document.createElement("button");
  fab.className = "sw-fab";
  fab.setAttribute("aria-label", "Open chat");
  fab.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg>`;
  document.body.appendChild(fab);

  // Chat container
  const container = document.createElement("div");
  container.className = "sw-container";
  container.innerHTML = `
    <div class="sw-header">
      <span>${escapeHtml(TITLE)}</span>
      <button class="sw-header-close" aria-label="Close chat">&times;</button>
    </div>
    <div class="sw-messages">
      <div class="sw-welcome">สวัสดีค่ะ! 👋<br>มีอะไรให้ช่วยเหลือไหมคะ?</div>
    </div>
    <div class="sw-input-area">
      <input class="sw-input" type="text" placeholder="พิมพ์ข้อความ..." autocomplete="off" />
      <button class="sw-send" disabled>ส่ง</button>
    </div>
  `;
  document.body.appendChild(container);

  const messagesDiv = container.querySelector(".sw-messages");
  const input = container.querySelector(".sw-input");
  const sendBtn = container.querySelector(".sw-send");
  const closeBtn = container.querySelector(".sw-header-close");

  // ── Event listeners ───────────────────────────────────────────

  fab.addEventListener("click", () => toggle(true));
  closeBtn.addEventListener("click", () => toggle(false));

  input.addEventListener("input", () => {
    sendBtn.disabled = !input.value.trim() || isLoading;
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener("click", sendMessage);

  // ── Functions ─────────────────────────────────────────────────

  function toggle(open) {
    isOpen = open;
    container.classList.toggle("sw-open", open);
    if (open) {
      input.focus();
      // Load history if we have a session
      if (sessionId && messagesDiv.querySelectorAll(".sw-msg").length === 0) {
        loadHistory();
      }
    }
  }

  function addMessage(text, role) {
    // Remove welcome message
    const welcome = messagesDiv.querySelector(".sw-welcome");
    if (welcome) welcome.remove();

    const div = document.createElement("div");
    div.className = `sw-msg ${role === "user" ? "sw-msg-user" : "sw-msg-bot"}`;
    div.textContent = text;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return div;
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text || isLoading) return;

    isLoading = true;
    input.value = "";
    input.disabled = true;
    sendBtn.disabled = true;

    addMessage(text, "user");

    // Create bot "typing" bubble
    const botBubble = addMessage("กำลังพิมพ์...", "bot");
    botBubble.classList.add("sw-typing");

    try {
      const resp = await fetch(`${SERVER}/api/widget/chat/${BOT_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }

      // Read SSE stream
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullAnswer = "";
      let firstToken = true;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);

            if (data.type === "token") {
              if (firstToken) {
                botBubble.textContent = "";
                botBubble.classList.remove("sw-typing");
                firstToken = false;
              }
              fullAnswer += data.content;
              botBubble.textContent = fullAnswer;
              messagesDiv.scrollTop = messagesDiv.scrollHeight;
            } else if (data.type === "done") {
              if (data.session_id) {
                sessionId = data.session_id;
                localStorage.setItem(STORAGE_KEY, sessionId);
              }
            }
            // "sources" type is ignored in widget UI for simplicity
          } catch (parseErr) {
            // ignore malformed SSE
          }
        }
      }

      if (firstToken) {
        // No tokens received
        botBubble.textContent = "ขออภัยค่ะ ไม่สามารถประมวลผลได้ในขณะนี้";
        botBubble.classList.remove("sw-typing");
      }
    } catch (err) {
      console.error("[SUNDAE Widget]", err);
      botBubble.textContent = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
      botBubble.classList.remove("sw-typing");
    } finally {
      isLoading = false;
      input.disabled = false;
      sendBtn.disabled = !input.value.trim();
      input.focus();
    }
  }

  async function loadHistory() {
    if (!sessionId) return;
    try {
      const resp = await fetch(`${SERVER}/api/widget/history/${sessionId}`);
      if (!resp.ok) return;
      const messages = await resp.json();
      if (messages.length === 0) return;

      // Remove welcome
      const welcome = messagesDiv.querySelector(".sw-welcome");
      if (welcome) welcome.remove();

      for (const msg of messages) {
        if (msg.role === "user" || msg.role === "assistant" || msg.role === "admin") {
          addMessage(msg.content, msg.role === "user" ? "user" : "bot");
        }
      }
    } catch (err) {
      console.warn("[SUNDAE Widget] Failed to load history:", err);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
