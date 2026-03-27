// server.js — Production v14
// STRATEGY: Buffer chunks in memory, flush to Google Docs in batches every 3 seconds.
// This keeps writes near real-time while staying well under the 60 ops/minute quota.
// Live viewer = instant via WebSocket. Google Doc = updates every ~3s during streaming.

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

// How often to flush pending chunks to Google Docs (milliseconds)
// 3000ms = ~20 ops/min max, well under the 60 ops/min quota
const FLUSH_INTERVAL_MS = 3000;

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
    .dot.live   { background:#10a37f; box-shadow:0 0 6px #10a37f88; animation:pulse 1.5s infinite; }
    .dot.saving { background:#f59e0b; box-shadow:0 0 6px #f59e0b88; animation:pulse 1.5s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
    .content { max-width:760px; margin:0 auto; padding:80px 24px 60px; }
    .question { background:#161616; border:1px solid #222; border-radius:10px; padding:14px 18px; margin-bottom:20px; font-size:13px; color:#888; display:none; }
    .question span { color:#fff; font-weight:500; }
    .response { font-size:15px; line-height:1.8; color:#e8e8e8; white-space:pre-wrap; word-break:break-word; min-height:40px; }
    .cursor { display:inline-block; width:2px; height:18px; background:#10a37f; margin-left:2px; vertical-align:middle; animation:blink 1s infinite; }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
    .cursor.hidden { display:none; }
    .doc-pill { position:fixed; bottom:24px; right:24px; background:#161616; border:1px solid #333; font-size:11px; padding:8px 14px; border-radius:8px; display:none; transition: border-color 0.3s; }
    .doc-pill.syncing { border-color:#f59e0b44; color:#f59e0b; }
    .doc-pill.saved   { border-color:#10a37f44; color:#10a37f; }
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
  <div class="doc-pill" id="docPill"></div>
  <script>
    const dot          = document.getElementById("dot");
    const statusText   = document.getElementById("statusText");
    const questionEl   = document.getElementById("question");
    const questionText = document.getElementById("questionText");
    const responseEl   = document.getElementById("response");
    const cursor       = document.getElementById("cursor");
    const historyEl    = document.getElementById("history");
    const docPill      = document.getElementById("docPill");
    let currentText = "";
    let history = [];
    let pillTimer = null;

    function showPill(cls, text, autohide) {
      clearTimeout(pillTimer);
      docPill.className = "doc-pill " + cls;
      docPill.textContent = text;
      docPill.style.display = "block";
      if (autohide) pillTimer = setTimeout(() => { docPill.style.display = "none"; }, autohide);
    }

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
          docPill.style.display = "none";
        }
        if (msg.type === "chunk") {
          currentText += msg.text;
          responseEl.insertBefore(document.createTextNode(msg.text), cursor);
          window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        }
        if (msg.type === "batch_written") {
          showPill("syncing", "&#8635; Doc syncing... (" + msg.chars + " chars)");
        }
        if (msg.type === "done") {
          cursor.className = "cursor hidden";
          statusText.textContent = "Finalising doc...";
          dot.className = "dot saving";
        }
        if (msg.type === "saved") {
          dot.className = "dot";
          statusText.textContent = "Saved to Google Docs ✓";
          showPill("saved", "&#10003; Saved to Google Docs", 3000);
        }
        if (msg.type === "error") {
          dot.className = "dot";
          statusText.textContent = "Error: " + msg.message;
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
      // Full response text built up as chunks arrive
      groundTruth:   "",
      // Pending text not yet written to doc (cleared after each batch flush)
      pendingBuffer: "",
      // Current insert index in the Google Doc
      insertIndex:   null,
      // true once doc has been cleared and we know insertIndex
      docReady:      false,
      // Interval timer for batch flushing
      flushTimer:    null,
      // Serial write queue so batches never overlap
      writeQueue:    Promise.resolve(),
      _token:        null,
      _sessionId:    0,
      firstChunkAt:  null,
      lastChunkAt:   null,
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
async function retryWithBackoff(fn, maxAttempts = 5, baseDelayMs = 2000) {
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

// ─── Enqueue one batch write onto the serial queue ───────────────────────────
function enqueueBatchWrite(docId, text, sessionId) {
  if (!text) return;
  const state = getState(docId);

  state.writeQueue = state.writeQueue.then(async () => {
    if (state._sessionId !== sessionId) return;
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
      console.log(`[BATCH] Wrote ${text.length} chars — insertIndex now ${state.insertIndex}`);
      broadcast({ type: "batch_written", chars: state.groundTruth.length });
    } catch (err) {
      console.error("[BATCH] Write error:", err.message);
      // Put text back so it gets retried next flush
      state.pendingBuffer = text + state.pendingBuffer;
    }
  }).catch(err => console.error("[QUEUE] Error:", err.message));
}

// ─── Flush pending buffer as one batch write ──────────────────────────────────
function flushPending(docId, sessionId) {
  const state = getState(docId);
  if (!state.pendingBuffer || !state.docReady) return;

  const toWrite      = state.pendingBuffer;
  state.pendingBuffer = "";
  enqueueBatchWrite(docId, toWrite, sessionId);
}

// ─── Middleware ───────────────────────────────────────────────────────────────
function requireToken(req, res, next) {
  const token = req.headers["x-google-token"];
  if (!token) return res.status(401).json({ error: "No Google token. Sign in via extension popup." });
  req.accessToken = token;
  next();
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ ok: true, version: "14.0" }));

// New question — clear doc, set up batch flush timer
app.post("/new-conversation", requireToken, async (req, res) => {
  const { question, docId } = req.body;
  if (!docId) return res.status(400).json({ error: "No docId." });

  process.stdout.write(`\n\n❓ ${question}\n${"─".repeat(40)}\n`);
  broadcast({ type: "new", question });

  const state       = getState(docId);

  // Stop any existing flush timer
  if (state.flushTimer) { clearInterval(state.flushTimer); state.flushTimer = null; }

  state._sessionId  += 1;
  const sessionId    = state._sessionId;

  state.groundTruth  = "";
  state.pendingBuffer = "";
  state.docReady     = false;
  state.insertIndex  = null;
  state._token       = req.accessToken;
  state.firstChunkAt = null;
  state.lastChunkAt  = null;
  state.writeQueue   = Promise.resolve();

  res.json({ ok: true });

  // Clear the doc in background, then open the gate + start batch timer
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

      if (state._sessionId !== sessionId) return;

      state.insertIndex = 1;
      state.docReady    = true;
      console.log("  [ready] doc cleared — starting batch flush every", FLUSH_INTERVAL_MS / 1000, "s");

      // Flush any chunks that arrived during the clear
      flushPending(docId, sessionId);

      // Start the recurring batch flush timer
      state.flushTimer = setInterval(() => {
        if (state._sessionId === sessionId) flushPending(docId, sessionId);
      }, FLUSH_INTERVAL_MS);

    } catch (err) {
      console.error("  [clear] ❌ Error:", err.message);
      broadcast({ type: "error", message: "Failed to clear doc: " + err.message });
    }
  })();
});

// Chunk arrived — buffer it, stream to live viewer
app.post("/chunk", requireToken, async (req, res) => {
  const { text, docId } = req.body;
  if (!docId || !text) return res.json({ ok: true });

  const state = getState(docId);
  const now   = Date.now();
  if (!state.firstChunkAt) state.firstChunkAt = now;
  state.lastChunkAt  = now;
  state._token       = req.accessToken;

  state.groundTruth  += text;
  state.pendingBuffer += text;  // queued for next batch flush

  process.stdout.write(text);
  broadcast({ type: "chunk", text }); // live viewer instant

  res.json({ ok: true });
});

// Stream finished — final flush + verify
app.post("/stream-end", requireToken, async (req, res) => {
  const { docId } = req.body;
  if (!docId) return res.json({ ok: true });

  const state     = getState(docId);
  const sessionId = state._sessionId;
  state._token    = req.accessToken;

  // Stop the periodic timer
  if (state.flushTimer) { clearInterval(state.flushTimer); state.flushTimer = null; }

  broadcast({ type: "done" });
  process.stdout.write("\n");

  const totalTime = ((state.lastChunkAt - state.firstChunkAt) / 1000).toFixed(2);
  console.log(`\n[END] ${state.groundTruth.length} chars in ${totalTime}s`);

  res.json({ ok: true });

  (async () => {
    // Final flush — write any remaining pending text
    flushPending(docId, sessionId);

    // Wait for all queued writes to complete
    await state.writeQueue;

    if (state._sessionId !== sessionId) return;

    state.docReady = false;

    // ── Verify doc matches ground truth ──────────────────────────────────────
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

      // Mismatch — rewrite cleanly (only reaches here if something went wrong)
      console.log(`[VERIFY] ⚠️  Mismatch (doc=${written.length}, expected=${expected.length}) — rewriting...`);

      const currentEnd = Math.max(1,
        verifyRes.data.body.content[verifyRes.data.body.content.length - 1].endIndex - 1
      );
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
  })();
});

// ─── START ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n🚀  ChatGPT → Google Docs v14.0`);
  console.log(`🟢  Server: http://localhost:${PORT}`);
  console.log(`👁️   Live viewer: http://localhost:${PORT}`);
  console.log(`\n   Batch flush every ${FLUSH_INTERVAL_MS / 1000}s — max ~${Math.ceil(60000 / FLUSH_INTERVAL_MS)} ops/min (quota: 60).`);
  console.log(`   Live viewer still instant via WebSocket.\n`);
});