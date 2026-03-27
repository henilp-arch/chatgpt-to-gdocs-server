// server.js — Production v13
// STRATEGY: Clear doc first, wait for confirmation, THEN stream chunks in real-time.
// This eliminates the race condition from v11 while keeping near real-time doc writes.
// Live viewer = instant (WebSocket). Google Doc = ~1-2s delay then real-time.

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

const PORT = process.env.PORT || 3000;

// ─── WebSocket clients ────────────────────────────────────────────────────────
const wsClients = new Set();
wss.on("connection", (ws) => {
  wsClients.add(ws);
  ws.on("close", () => wsClients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wsClients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

// ─── Live viewer ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>ChatGPT Live</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#0f0f0f; color:#e8e8e8; font-family:'Inter',sans-serif; min-height:100vh; }
    .header { position:fixed; top:0; left:0; right:0; background:#0f0f0f; border-bottom:1px solid #1a1a1a; padding:14px 24px; display:flex; align-items:center; gap:12px; z-index:10; }
    .logo { width:28px; height:28px; background:linear-gradient(135deg,#10a37f,#1a73e8); border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:13px; }
    .title { font-size:13px; font-weight:600; color:#fff; }
    .status { margin-left:auto; font-size:11px; color:#444; display:flex; align-items:center; gap:6px; }
    .dot { width:6px; height:6px; border-radius:50%; background:#333; }
    .dot.live    { background:#10a37f; box-shadow:0 0 6px #10a37f88; animation:pulse 1.5s infinite; }
    .dot.saving  { background:#f59e0b; box-shadow:0 0 6px #f59e0b88; animation:pulse 1.5s infinite; }
    .dot.cleared { background:#6366f1; box-shadow:0 0 6px #6366f188; animation:pulse 1.5s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
    .content { max-width:760px; margin:0 auto; padding:80px 24px 60px; }
    .question { background:#161616; border:1px solid #222; border-radius:10px; padding:14px 18px; margin-bottom:20px; font-size:13px; color:#888; display:none; }
    .question span { color:#fff; font-weight:500; }
    .response { font-size:15px; line-height:1.8; color:#e8e8e8; white-space:pre-wrap; word-break:break-word; min-height:40px; }
    .cursor { display:inline-block; width:2px; height:18px; background:#10a37f; margin-left:2px; vertical-align:middle; animation:blink 1s infinite; }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
    .cursor.hidden { display:none; }
    .saved-badge { position:fixed; bottom:24px; right:24px; background:#161616; border:1px solid #10a37f44; color:#10a37f; font-size:11px; padding:8px 14px; border-radius:8px; display:none; }
    .error-badge { position:fixed; bottom:24px; right:24px; background:#1a0a0a; border:1px solid #ff575744; color:#ff5757; font-size:11px; padding:8px 14px; border-radius:8px; display:none; }
    .history { margin-top:40px; border-top:1px solid #1a1a1a; padding-top:40px; }
    .history-item { margin-bottom:32px; opacity:0.6; }
    .history-q { font-size:11px; color:#555; margin-bottom:8px; }
    .history-a { font-size:14px; line-height:1.7; color:#666; white-space:pre-wrap; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">&#8594;</div>
    <div class="title">ChatGPT Live Mirror</div>
    <div class="status">
      <div class="dot" id="dot"></div>
      <span id="statusText">Connecting...</span>
    </div>
  </div>
  <div class="content">
    <div class="question" id="question">&#10067; <span id="questionText"></span></div>
    <div class="response" id="response"><span class="cursor hidden" id="cursor"></span></div>
    <div class="history" id="history" style="display:none"></div>
  </div>
  <div class="saved-badge" id="savedBadge">&#10003; Saved to Google Docs</div>
  <div class="error-badge" id="errorBadge"></div>
  <script>
    const dot = document.getElementById("dot");
    const statusText = document.getElementById("statusText");
    const questionEl = document.getElementById("question");
    const questionText = document.getElementById("questionText");
    const responseEl = document.getElementById("response");
    const cursor = document.getElementById("cursor");
    const historyEl = document.getElementById("history");
    const savedBadge = document.getElementById("savedBadge");
    const errorBadge = document.getElementById("errorBadge");
    let currentText = "";
    let history = [];

    function connect() {
      const proto = location.protocol === "https:" ? "wss://" : "ws://";
      const ws = new WebSocket(proto + location.host);
      ws.onopen  = () => { dot.className = "dot live"; statusText.textContent = "Connected - waiting for ChatGPT"; };
      ws.onclose = () => { dot.className = "dot"; statusText.textContent = "Disconnected - retrying..."; setTimeout(connect, 2000); };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "new") {
          if (currentText) { history.unshift({ q: questionText.textContent, a: currentText }); renderHistory(); }
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
          responseEl.insertBefore(document.createTextNode(msg.text), cursor);
          window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        }
        if (msg.type === "doc_ready") {
          statusText.textContent = "Writing to doc in real-time...";
          dot.className = "dot cleared";
        }
        if (msg.type === "done") {
          cursor.className = "cursor hidden";
          statusText.textContent = "Verifying...";
          dot.className = "dot saving";
        }
        if (msg.type === "saved") {
          dot.className = "dot";
          statusText.textContent = "Saved to Google Docs ✓";
          savedBadge.style.display = "block";
          setTimeout(() => { savedBadge.style.display = "none"; }, 3000);
        }
        if (msg.type === "error") {
          dot.className = "dot";
          statusText.textContent = "Error saving to Docs";
          errorBadge.textContent = msg.message;
          errorBadge.style.display = "block";
          setTimeout(() => { errorBadge.style.display = "none"; }, 5000);
        }
      };
    }

    function renderHistory() {
      if (!history.length) return;
      historyEl.style.display = "block";
      historyEl.innerHTML = history.map(h =>
        '<div class="history-item"><div class="history-q">' + h.q + '</div><div class="history-a">' + h.a + '</div></div>'
      ).join("");
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
      // Write queue — all doc writes chain onto this promise so they're serial
      writeQueue:    Promise.resolve(),
      // true once doc has been cleared and insertIndex is valid
      docReady:      false,
      // chunks that arrived before docReady — flushed atomically when gate opens
      preBuffer:     "",
      // insertIndex in the Google Doc — only valid after docReady=true
      insertIndex:   null,
      // full text of this response (for verify step)
      groundTruth:   "",
      _token:        null,
      _sessionId:    0,
      firstChunkAt:  null,
      lastChunkAt:   null,
      firstWriteAt:  null,
      lastWriteAt:   null,
    };
  }
  return docState[docId];
}

function getDocsClient(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.docs({ version: "v1", auth });
}

// ─── Retry with exponential backoff ──────────────────────────────────────────
async function retryWithBackoff(fn, maxAttempts = 6, baseDelayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isQuota = err.code === 429 ||
        (err.message && err.message.toLowerCase().includes("quota"));
      if (!isQuota || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.log(`[RETRY] Quota — waiting ${delay / 1000}s (attempt ${attempt + 1}/${maxAttempts})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ─── Append text to doc at current insertIndex (serial, one at a time) ────────
function enqueueWrite(docId, text, sessionId) {
  if (!text) return;
  const state = getState(docId);

  state.writeQueue = state.writeQueue.then(async () => {
    if (state._sessionId !== sessionId) return; // stale session
    if (!state.docReady || state.insertIndex === null || !state._token) return;

    try {
      const docsClient = getDocsClient(state._token);
      await retryWithBackoff(() =>
        docsClient.documents.batchUpdate({
          documentId: docId,
          requestBody: {
            requests: [{ insertText: { location: { index: state.insertIndex }, text } }],
          },
        })
      );
      state.insertIndex += text.length;
      if (!state.firstWriteAt) state.firstWriteAt = Date.now();
      state.lastWriteAt = Date.now();
    } catch (err) {
      console.error("[WRITE] Error:", err.message);
    }
  }).catch(err => console.error("[QUEUE] Error:", err.message));
}

// ─── Middleware ───────────────────────────────────────────────────────────────
function requireToken(req, res, next) {
  const token = req.headers["x-google-token"];
  if (!token) return res.status(401).json({ error: "No Google token. Sign in via extension popup." });
  req.accessToken = token;
  next();
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ ok: true, version: "13.0" }));

// New question — reset state, then clear doc in background
app.post("/new-conversation", requireToken, async (req, res) => {
  const { question, docId } = req.body;
  if (!docId) return res.status(400).json({ error: "No docId." });

  process.stdout.write(`\n\n❓ ${question}\n${"─".repeat(40)}\n`);
  broadcast({ type: "new", question });

  const state        = getState(docId);
  state._sessionId  += 1;
  const sessionId    = state._sessionId;

  // Reset everything for this new response
  state.docReady     = false;
  state.preBuffer    = "";
  state.groundTruth  = "";
  state.insertIndex  = null;
  state._token       = req.accessToken;
  state.firstChunkAt = null;
  state.lastChunkAt  = null;
  state.firstWriteAt = null;
  state.lastWriteAt  = null;
  state.writeQueue   = Promise.resolve(); // fresh queue

  res.json({ ok: true }); // respond immediately — don't block extension

  // Clear the doc in background — once done, open the gate
  (async () => {
    try {
      const docsClient = getDocsClient(req.accessToken);

      console.log("  [clear] fetching doc...");
      const docRes  = await docsClient.documents.get({ documentId: docId });
      const content = docRes.data.body.content;
      const docEnd  = Math.max(1, content[content.length - 1].endIndex - 1);

      if (docEnd > 1) {
        console.log(`  [clear] deleting content (docEnd=${docEnd})...`);
        await retryWithBackoff(() =>
          docsClient.documents.batchUpdate({
            documentId: docId,
            requestBody: {
              requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex: docEnd } } }],
            },
          })
        );
      }

      if (state._sessionId !== sessionId) {
        console.log("  [clear] session changed — aborting");
        return;
      }

      state.insertIndex = 1;
      console.log("  [ready] doc cleared — gate open, insertIndex = 1");

      // Flush any chunks that arrived while we were clearing
      if (state.preBuffer) {
        const buffered  = state.preBuffer;
        state.preBuffer = "";
        console.log(`  [prebuffer] flushing ${buffered.length} chars`);
        enqueueWrite(docId, buffered, sessionId);
      }

      state.docReady = true; // gate open — future chunks write directly
      broadcast({ type: "doc_ready" }); // tell live viewer doc is streaming

    } catch (err) {
      console.error("  [clear] ❌ Error:", err.message);
      broadcast({ type: "error", message: "Failed to clear doc: " + err.message });
    }
  })();
});

// Chunk arrived — buffer to groundTruth + live viewer, write to doc if ready
app.post("/chunk", requireToken, async (req, res) => {
  const { text, docId } = req.body;
  if (!docId || !text) return res.json({ ok: true });

  const state = getState(docId);
  const now   = Date.now();
  if (!state.firstChunkAt) state.firstChunkAt = now;
  state.lastChunkAt = now;
  state._token      = req.accessToken;

  // Always track full response for verification
  state.groundTruth += text;

  // Always stream to live viewer (zero latency)
  process.stdout.write(text);
  broadcast({ type: "chunk", text });

  if (!state.docReady) {
    // Doc not cleared yet — hold in preBuffer
    state.preBuffer += text;
  } else {
    // Doc is ready — enqueue this chunk for real-time writing
    enqueueWrite(docId, text, state._sessionId);
  }

  res.json({ ok: true });
});

// Stream finished — wait for all writes, then verify
app.post("/stream-end", requireToken, async (req, res) => {
  const { docId } = req.body;
  if (!docId) return res.json({ ok: true });

  const state     = getState(docId);
  const sessionId = state._sessionId;
  state._token    = req.accessToken;

  broadcast({ type: "done" });
  process.stdout.write("\n");

  res.json({ ok: true });

  // Wait for all enqueued writes to finish
  await state.writeQueue;

  if (state._sessionId !== sessionId) return;

  const totalTime      = ((state.lastChunkAt  - state.firstChunkAt)  / 1000).toFixed(2);
  const firstToDoc     = state.firstWriteAt
    ? ((state.firstWriteAt - state.firstChunkAt) / 1000).toFixed(2) + "s"
    : "n/a (all prebuffered)";
  const lastToDoc      = state.lastWriteAt
    ? ((state.lastWriteAt  - state.lastChunkAt)  / 1000).toFixed(2) + "s"
    : "n/a";

  console.log(`\n${"─".repeat(44)}`);
  console.log(`⏱️   TIMING REPORT`);
  console.log(`${"─".repeat(44)}`);
  console.log(`  ChatGPT response time  : ${totalTime}s`);
  console.log(`  First chunk → doc      : ${firstToDoc}`);
  console.log(`  Last chunk → doc       : ${lastToDoc}`);
  console.log(`${"─".repeat(44)}`);

  // ── Verify doc matches ground truth ───────────────────────────────────────
  console.log("\n[VERIFY] Reading doc back...");
  try {
    const docsClient = getDocsClient(req.accessToken);
    const verifyRes  = await docsClient.documents.get({ documentId: docId });

    let docText = "";
    for (const block of verifyRes.data.body.content) {
      if (block.paragraph) {
        for (const el of block.paragraph.elements) {
          if (el.textRun) docText += el.textRun.content;
        }
      }
    }

    const written  = docText.trimEnd();
    const expected = state.groundTruth.trimEnd();

    if (written === expected) {
      console.log("[VERIFY] ✅ Perfect match");
      broadcast({ type: "saved" });
      return;
    }

    // Mismatch — rewrite the whole thing cleanly
    console.log(`[VERIFY] ⚠️  Mismatch (doc=${written.length} vs expected=${expected.length}) — rewriting...`);

    const currentEnd = Math.max(1, verifyRes.data.body.content[verifyRes.data.body.content.length - 1].endIndex - 1);
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

    const CHUNK_SIZE = 10_000;
    let insertAt = 1;
    for (let i = 0; i < expected.length; i += CHUNK_SIZE) {
      const slice = expected.slice(i, i + CHUNK_SIZE);
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

    console.log("[VERIFY] ✅ Rewrite complete");
    broadcast({ type: "saved" });

  } catch (err) {
    console.error("[VERIFY] ❌ Error:", err.message);
    broadcast({ type: "error", message: "Verify failed: " + err.message });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n🚀  ChatGPT → Google Docs v13.0`);
  console.log(`🟢  Server: http://localhost:${PORT}`);
  console.log(`👁️   Live viewer: http://localhost:${PORT}`);
  console.log(`\n   Strategy: clear doc first → stream chunks in real-time → verify at end.`);
  console.log(`   No race conditions. No scrambled words.\n`);
});