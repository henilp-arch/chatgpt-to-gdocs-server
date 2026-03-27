# ChatGPT → Google Docs Live Mirror

Streams every ChatGPT response into a Google Doc in real time, as the words appear.

---

## How it works

```
ChatGPT (browser) → Chrome Extension → Your Server → Google Docs API
                                      └→ Live Viewer (browser tab)
```

1. **Chrome extension** watches ChatGPT for new responses and POSTs each chunk to your server.
2. **Server** writes chunks to a Google Doc (streaming) and broadcasts them to a live viewer page via WebSocket.
3. **Google OAuth** is handled entirely by the Chrome extension — no credentials file needed.

---

## Quick Start (local, for yourself)

### 1. Run the server

```bash
npm install
node server.js
```

Server starts at `http://localhost:3000`.  
Open `http://localhost:3000` in a browser tab to see the live viewer.

### 2. Load the Chrome extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this folder
4. The extension icon appears in your toolbar

### 3. Configure & use

1. Click the extension icon → **Sign in with Google**
2. Paste your Google Doc URL (or just the doc ID)
3. Toggle **Active** on
4. Go to `chatgpt.com` and ask anything — it streams live into your doc

---

## Deploying for others (shared / team use)

Each user needs their **own copy of the extension** pointing to a server. The server handles their Google OAuth token (sent per-request by the extension) so there's no shared credential.

### Option A — Railway (recommended, free tier available)

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. Select your repo — Railway auto-detects Node and deploys
4. Copy your Railway URL (e.g. `https://your-app.up.railway.app`)

### Option B — Render (free tier, sleeps after inactivity)

1. Push to GitHub
2. [render.com](https://render.com) → **New Web Service** → connect repo
3. Build command: `npm install`  
   Start command: `node server.js`
4. Copy your Render URL

### Option C — Fly.io

```bash
npm install -g flyctl
fly launch
fly deploy
```

---

## Distributing the extension to others

After deploying your server, each user needs the extension with **your server URL baked in as the default**.

**Step 1 — Update the default server URL** in `popup.js`:

```js
// Around line 3 in popup.js, find:
serverUrl: "http://localhost:3000",
// Change to your deployed URL:
serverUrl: "https://your-app.up.railway.app",
```

Also update the same default in `content.js` line 2:
```js
let serverUrl = "https://your-app.up.railway.app";
```

**Step 2 — Package the extension as a `.zip`**:

```bash
zip -r chatgpt-to-docs.zip . \
  --exclude "*.git*" --exclude "node_modules/*" \
  --exclude "server.js" --exclude "package*.json" \
  --exclude "Procfile" --exclude "railway.json" \
  --exclude "README.md"
```

The zip should contain only: `manifest.json`, `background.js`, `content.js`, `popup.js`, `popup.html`

**Step 3 — Share the zip**.  
Users install it via Chrome → `chrome://extensions` → Enable Developer mode → **Load unpacked** (unzip first) or drag the `.zip` onto the extensions page.

> **Note:** For wide public distribution, submit to the Chrome Web Store. You'll need a developer account ($5 one-time fee) and must update the `oauth2.client_id` in `manifest.json` with your own Google Cloud project credentials.

---

## Google Cloud setup (required for publishing / new OAuth client)

If you want your own OAuth client (instead of using the bundled one):

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project → **Enable** the Google Docs API
3. **APIs & Services** → **Credentials** → **Create OAuth 2.0 Client ID**
   - Application type: **Chrome Extension**
   - Extension ID: (found in `chrome://extensions` after loading unpacked)
4. Copy the Client ID into `manifest.json` under `oauth2.client_id`

---

## Quota / rate limit notes

Google Docs API has a limit of **~60 write operations per minute per user**.  
The server handles this automatically with exponential backoff — if a quota error hits during streaming or the final verify step, it retries at 2s, 4s, 8s, 16s intervals before giving up.

Long responses (like detailed math solutions) can trigger this if the verify/rewrite step fires right after heavy streaming. This is normal and the server recovers automatically.

---

## File overview

| File | Purpose |
|---|---|
| `server.js` | Express + WebSocket server, Google Docs writer |
| `manifest.json` | Chrome extension manifest |
| `background.js` | OAuth token management via Chrome identity API |
| `content.js` | Injected into ChatGPT — detects and streams responses |
| `popup.js` / `popup.html` | Extension popup UI |
