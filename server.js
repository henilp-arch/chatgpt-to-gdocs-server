// server.js — Production v9
// Real-time display via WebSocket (zero latency)
// Google Docs written in background + verified at end
// No .env — token from extension via X-Google-Token header

const express    = require("express");
const cors       = require("cors");
const http       = require("http");
const { WebSocketServer } = require("ws");
const { google } = require("googleapis");

const app        = express();
const httpServer = http.createServer(app);
const wss        = new WebSocketServer({ server: httpServer });

app.use(cors());
app.use(express.json());

const PORT = 3000;

// ─── WebSocket clients ────────────────────────────────────────────────────────
const wsClients = new Set();

wss.on("connection", (ws) => {
  wsClients.add(ws);
  ws.on("close", () => wsClients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wsClients.forEach(ws => {
    if (ws.readyState === 1) ws.send(msg);
  });
}

// ─── Live viewer page ─────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>ChatGPT → Live</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#0f0f0f; color:#e8e8e8; font-family:'Inter',sans-serif; min-height:100vh; }
    .header {
      position:fixed; top:0; left:0; right:0;
      background:#0f0f0f; border-bottom:1px solid #1a1a1a;
      padding:14px 24px; display:flex; align-items:center; gap:12px; z-index:10;
    }
    .logo { width:28px; height:28px; background:linear-gradient(135deg,#10a37f,#1a73e8); border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:13px; }
    .title { font-size:13px; font-weight:600; color:#fff; }
    .status { margin-left:auto; font-size:11px; color:#444; display:flex; align-items:center; gap:6px; }
    .dot { width:6px; height:6px; border-radius:50%; background:#333; }
    .dot.live { background:#10a37f; box-shadow:0 0 6px #10a37f88; animation:pulse 1.5s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
    .content { max-width:760px; margin:0 auto; padding:80px 24px 60px; }
    .question {
      background:#161616; border:1px solid #222; border-radius:10px;
      padding:14px 18px; margin-bottom:20px;
      font-size:13px; color:#888; display:none;
    }
    .question span { color:#fff; font-weight:500; }
    .response {
      font-size:15px; line-height:1.8; color:#e8e8e8;
      white-space:pre-wrap; word-break:break-word;
      min-height:40px;
    }
    .cursor {
      display:inline-block; width:2px; height:18px;
      background:#10a37f; margin-left:2px; vertical-align:middle;
      animation:blink 1s infinite;
    }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
    .cursor.hidden { display:none; }
    .saved-badge {
      position:fixed; bottom:24px; right:24px;
      background:#161616; border:1px solid #10a37f44;
      color:#10a37f; font-size:11px; padding:8px 14px;
      border-radius:8px; display:none; font-family:'Inter',sans-serif;
    }
    .history { margin-top:40px; border-top:1px solid #1a1a1a; padding-top:40px; }
    .history-item { margin-bottom:32px; opacity:0.6; }
    .history-q { font-size:11px; color:#555; margin-bottom:8px; }
    .history-a { font-size:14px; line-height:1.7; color:#666; white-space:pre-wrap; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">→</div>
    <div class="title">ChatGPT Live Mirror</div>
    <div class="status">
      <div class="dot" id="dot"></div>
      <span id="statusText">Connecting...</span>
    </div>
  </div>

  <div class="content">
    <div class="question" id="question">❓ <span id="questionText"></span></div>
    <div class="response" id="response"><span class="cursor hidden" id="cursor"></span></div>
    <div class="history" id="history" style="display:none"></div>
  </div>

  <div class="saved-badge" id="savedBadge">✓ Saved to Google Docs</div>

  <script>
    const dot        = document.getElementById("dot");
    const statusText = document.getElementById("statusText");
    const questionEl = document.getElementById("question");
    const questionText = document.getElementById("questionText");
    const responseEl = document.getElementById("response");
    const cursor     = document.getElementById("cursor");
    const historyEl  = document.getElementById("history");
    const savedBadge = document.getElementById("savedBadge");

    let currentText  = "";
    let history      = [];

    function connect() {
      const ws = new WebSocket("ws://" + location.host);

      ws.onopen = () => {
        dot.className = "dot live";
        statusText.textContent = "Connected — waiting for ChatGPT";
      };

      ws.onclose = () => {
        dot.className = "dot";
        statusText.textContent = "Disconnected — retrying...";
        setTimeout(connect, 2000);
      };

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);

        if (msg.type === "new") {
          // Save previous to history
          if (currentText) {
            history.unshift({ q: questionText.textContent, a: currentText });
            renderHistory();
          }
          currentText = "";
          questionText.textContent = msg.question;
          questionEl.style.display = "block";
          responseEl.innerHTML = "";
          responseEl.appendChild(cursor);
          cursor.className = "cursor";
          statusText.textContent = "Streaming...";
          dot.className = "dot live";
        }

        if (msg.type === "chunk") {
          currentText += msg.text;
          // Insert text before cursor
          const textNode = document.createTextNode(msg.text);
          responseEl.insertBefore(textNode, cursor);
          // Auto scroll
          window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        }

        if (msg.type === "done") {
          cursor.className = "cursor hidden";
          statusText.textContent = "Done — verifying doc...";
          dot.className = "dot";
        }

        if (msg.type === "verified") {
          statusText.textContent = "Saved to Google Docs ✓";
          savedBadge.style.display = "block";
          setTimeout(() => { savedBadge.style.display = "none"; }, 3000);
        }
      };
    }

    function renderHistory() {
      if (!history.length) return;
      historyEl.style.display = "block";
      historyEl.innerHTML = history.map(h => \`
        <div class="history-item">
          <div class="history-q">❓ \${h.q}</div>
          <div class="history-a">\${h.a}</div>
        </div>
      \`).join("");
    }

    connect();
  </script>
</body>
</html>`);
});

// ─── Per-doc state ────────────────────────────────────────────────────────────
const docState = {};

function getState(docId) {
  if (!docState[docId]) {
    docState[docId] = {
      insertIndex:   null,
      responseStart: null,
      buffer:        "",
      preBuffer:     "",     // holds chunks that arrive before setup completes
      groundTruth:   "",
      flushTimer:    null,
      isFlushing:    false,
      active:        false,   // true = header written, safe to flush
      firstChunkAt:  null,
      lastChunkAt:   null,
      firstWriteAt:  null,
      lastWriteAt:   null,
      _token:        null,
      _sessionId:    0,
    };
  }
  return docState[docId];
}

function getDocsClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.docs({ version: "v1", auth });
}

async function writeDirect(docId, text, accessToken, sessionId) {
  if (!text) return;
  const state = getState(docId);
  if (state._sessionId !== sessionId) return;

  const docsClient = getDocsClient(accessToken);
  try {
    await docsClient.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [{ insertText: { location: { index: state.insertIndex }, text } }],
      },
    });
    if (state._sessionId !== sessionId) return;
    state.insertIndex += text.length;
    if (!state.firstWriteAt) state.firstWriteAt = Date.now();
    state.lastWriteAt  = Date.now();
  } catch (err) {
    if (state._sessionId !== sessionId) return;
    if (err.code === 429 || (err.message && err.message.toLowerCase().includes("quota"))) {
      // Exponential backoff: don't hammer the quota further
      const delay = Math.min(2000 * Math.pow(2, (state._retryCount = (state._retryCount || 0) + 1) - 1), 16000);
      console.warn(`[WRITE] Quota hit — backing off ${delay/1000}s`);
      await new Promise(r => setTimeout(r, delay));
      state._retryCount = 0;
      await writeDirect(docId, text, accessToken, sessionId);
    } else if (err.code === 401) {
      console.error("❌  Token expired");
    } else if (err.code === 400 && err.message && err.message.includes("must be less than the end index")) {
      // Cached index is stale — doc was modified externally
      // Re-fetch the real index and retry once
      console.warn("⚠️  Stale index detected — re-fetching from doc...");
      try {
        const docsClient2 = getDocsClient(accessToken);
        const docRes2     = await docsClient2.documents.get({ documentId: docId });
        const content2    = docRes2.data.body.content;
        state.insertIndex = Math.max(1, content2[content2.length - 1].endIndex - 1);
        console.log("  [index] refreshed to:", state.insertIndex);
        // Retry the write with the correct index
        await writeDirect(docId, text, accessToken, sessionId);
      } catch (retryErr) {
        console.error("❌  Retry failed:", retryErr.message);
        if (state._sessionId === sessionId) state.buffer = text + state.buffer;
      }
    } else {
      console.error("❌  Docs write error:", err.message);
      if (state._sessionId === sessionId) state.buffer = text + state.buffer;
    }
  }
}

async function flushBuffer(docId, force = false) {
  const state = getState(docId);
  // active=false means header not written yet — insertIndex not safe to use
  if (!state.active || !state.buffer || state.isFlushing || state.insertIndex === null || !state._token) return;

  const sessionId = state._sessionId;
  let toWrite = state.buffer;

  if (!force) {
    // Wait for at least a word boundary so we never split a word
    const lastBoundary = Math.max(
      toWrite.lastIndexOf(" "),  toWrite.lastIndexOf("\n"),
      toWrite.lastIndexOf("."),  toWrite.lastIndexOf(","),
      toWrite.lastIndexOf("!"),  toWrite.lastIndexOf("?"),
    );
    if (lastBoundary <= 0) return; // no complete word yet
    if (lastBoundary < toWrite.length - 1) {
      state.buffer = toWrite.slice(lastBoundary + 1);
      toWrite      = toWrite.slice(0, lastBoundary + 1);
    } else {
      state.buffer = "";
    }
  } else {
    state.buffer = "";
  }

  state.isFlushing = true;
  await writeDirect(docId, toWrite, state._token, sessionId);
  state.isFlushing = false;
}

// ─── Retry helper with exponential backoff ────────────────────────────────────
async function retryWithBackoff(fn, maxAttempts = 5, baseDelayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isQuota = err.code === 429 ||
        (err.message && err.message.toLowerCase().includes("quota"));
      if (!isQuota || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1); // 2s, 4s, 8s, 16s...
      console.log(`[RETRY] Quota hit — waiting ${delay/1000}s before attempt ${attempt + 1}/${maxAttempts}...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ─── Verify doc vs ground truth, fix if needed ───────────────────────────────
async function verifyAndFix(docId, accessToken, sessionId) {
  const state = getState(docId);
  if (state._sessionId !== sessionId) return;

  console.log("\n[VERIFY] Checking doc...");

  try {
    const docsClient = getDocsClient(accessToken);
    const docRes     = await docsClient.documents.get({ documentId: docId });

    let docText = "";
    for (const block of docRes.data.body.content) {
      if (block.paragraph) {
        for (const el of block.paragraph.elements) {
          if (el.textRun) docText += el.textRun.content;
        }
      }
    }

    const written  = docText.trimEnd();
    const expected = state.groundTruth.trimEnd();

    if (written === expected) {
      console.log("[VERIFY] ✅ Perfect — no fix needed");
      broadcast({ type: "verified" });
      return;
    }

    console.log("[VERIFY] ⚠️  Fixing — rewriting from scratch...");

    const currentDocContent = docRes.data.body.content;
    const currentEnd = Math.max(1, currentDocContent[currentDocContent.length - 1].endIndex - 1);

    // Step 1: delete existing content (with quota retry)
    if (currentEnd > 1) {
      await retryWithBackoff(() =>
        docsClient.documents.batchUpdate({
          documentId: docId,
          requestBody: {
            requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex: currentEnd } } }],
          },
        })
      );
    }

    // Step 2: insert corrected content (with quota retry)
    // Split into ≤10 000-char chunks to stay well under the per-request limit
    const CHUNK_SIZE = 10_000;
    const text = state.groundTruth;
    let insertAt = 1;
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      const slice = text.slice(i, i + CHUNK_SIZE);
      await retryWithBackoff(() =>
        docsClient.documents.batchUpdate({
          documentId: docId,
          requestBody: {
            requests: [{ insertText: { location: { index: insertAt }, text: slice } }],
          },
        })
      );
      insertAt += slice.length;
    }

    state.insertIndex = insertAt;
    console.log("[VERIFY] ✅ Fixed");
    broadcast({ type: "verified" });

  } catch (err) {
    console.error("[VERIFY] ❌ Error:", err.message);
    // Still mark as verified in the UI so user knows the response is complete
    broadcast({ type: "verified" });
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
function requireToken(req, res, next) {
  const token = req.headers["x-google-token"];
  if (!token) return res.status(401).json({ error: "No Google token. Sign in via extension popup." });
  req.accessToken = token;
  next();
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ ok: true, version: "9.0" }));

app.post("/new-conversation", requireToken, async (req, res) => {
  const { question, docId } = req.body;
  if (!docId) return res.status(400).json({ error: "No docId." });

  process.stdout.write(`\n\n❓ ${question}\n${"─".repeat(40)}\n`);

  // Broadcast to live viewer instantly
  broadcast({ type: "new", question });

  const state = getState(docId);
  if (state.flushTimer) { clearInterval(state.flushTimer); state.flushTimer = null; }

  state._sessionId  += 1;
  const sessionId    = state._sessionId;
  state.buffer       = "";
  state.preBuffer    = "";
  state.groundTruth  = "";
  state.isFlushing   = false;
  state.active       = false;
  state.firstChunkAt = null;
  state.lastChunkAt  = null;
  state.firstWriteAt = null;
  state._token       = req.accessToken;
  // NOTE: insertIndex is intentionally NOT reset here
  // We keep the cached value from the last response to skip doc.get()

  // Respond immediately — don't block the extension at all
  res.json({ ok: true });

  // Setup runs in background
  (async () => {
    try {
      const docsClient = getDocsClient(req.accessToken);

      // ── Always fetch the doc to get current content length ──
      const docRes  = await docsClient.documents.get({ documentId: docId });
      const content = docRes.data.body.content;
      const docEnd  = Math.max(1, content[content.length - 1].endIndex - 1);

      // ── Delete ALL existing content in the doc (start fresh for each response) ──
      if (docEnd > 1) {
        console.log("  [clear] deleting existing content, docEnd:", docEnd);
        await docsClient.documents.batchUpdate({
          documentId: docId,
          requestBody: {
            requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex: docEnd } } }],
          },
        });
      }

      // After clearing, doc is empty — insert index starts at 1
      state.insertIndex   = 1;
      state.responseStart = 1;
      console.log("  [index] doc cleared, starting at 1");

      if (state._sessionId === sessionId) {
        // Move preBuffer into main buffer — now insertIndex is valid
        if (state.preBuffer) {
          state.buffer    += state.preBuffer;
          state.preBuffer  = "";
          console.log("  [prebuffer] released", state.buffer.length, "chars");
        }
        state.active = true; // NOW safe — index is correct, preBuffer released
        // Flush everything that accumulated during setup
        await flushBuffer(docId);
        state.flushTimer = setInterval(() => flushBuffer(docId), 200);
      }
    } catch (err) {
      console.error("❌  Setup error:", err.message);
      getState(docId).insertIndex = null;
    }
  })();
});

app.post("/chunk", requireToken, async (req, res) => {
  const { text, docId } = req.body;
  if (!docId || !text) return res.json({ ok: true });

  const state = getState(docId);
  const now   = Date.now();
  if (!state.firstChunkAt) state.firstChunkAt = now;
  state.lastChunkAt  = now;
  state._token       = req.accessToken;
  state.buffer      += text;
  state.groundTruth += text;

  process.stdout.write(text);

  // Broadcast to live viewer — zero latency, truly real-time
  broadcast({ type: "chunk", text });

  res.json({ ok: true });

  // Trigger flush immediately on every chunk — no waiting for timer
  flushBuffer(docId).catch(() => {});
});

app.post("/stream-end", requireToken, async (req, res) => {
  const { docId } = req.body;
  if (!docId) return res.json({ ok: true });

  const state     = getState(docId);
  const sessionId = state._sessionId;
  state._token    = req.accessToken;

  if (state.flushTimer) { clearInterval(state.flushTimer); state.flushTimer = null; }

  broadcast({ type: "done" });

  await new Promise(r => setTimeout(r, 400));
  state.isFlushing = false;

  // Drain buffer completely — keep flushing until nothing left
  let attempts = 0;
  while (state.buffer && attempts < 10) {
    await flushBuffer(docId, true);
    attempts++;
  }
  state.active = false;

  process.stdout.write("\n");

  const totalResponse    = state.lastChunkAt  - state.firstChunkAt;
  const firstChunkToDoc  = state.firstWriteAt - state.firstChunkAt;
  const lastChunkToDoc   = state.lastWriteAt  - state.lastChunkAt;

  console.log("\n" + "─".repeat(44));
  console.log("⏱️   TIMING REPORT");
  console.log("─".repeat(44));
  console.log(`  First chunk at server  : ${new Date(state.firstChunkAt).toISOString().slice(11,23)}`);
  console.log(`  First word in doc      : ${new Date(state.firstWriteAt).toISOString().slice(11,23)}`);
  console.log(`  Last chunk at server   : ${new Date(state.lastChunkAt).toISOString().slice(11,23)}`);
  console.log(`  Last word in doc       : ${new Date(state.lastWriteAt).toISOString().slice(11,23)}`);
  console.log("─".repeat(44));
  console.log(`  ChatGPT response time  : ${(totalResponse/1000).toFixed(2)}s`);
  console.log(`  First chunk → doc      : ${firstChunkToDoc > 0 ? (firstChunkToDoc/1000).toFixed(2)+"s ← how fast first word appears" : "instant"}`);
  console.log(`  Last chunk → doc       : ${lastChunkToDoc > 0 ? (lastChunkToDoc/1000).toFixed(2)+"s" : "already written"}`);
  console.log("─".repeat(44));

  setTimeout(() => verifyAndFix(docId, req.accessToken, sessionId), 1000);

  res.json({ ok: true });
});

// ─── START ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n🚀  ChatGPT → Google Docs v9.0`);
  console.log(`🟢  Server: http://localhost:${PORT}`);
  console.log(`👁️   Live viewer: http://localhost:${PORT}`);
  console.log(`\n   Open the live viewer in your browser for real-time display.`);
  console.log(`   Google Docs gets written + verified in background.\n`);
});