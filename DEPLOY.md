# Deploying

Two pieces, deployed separately:

| Piece | Where | Cost |
| --- | --- | --- |
| The game (pages, canvas, letter hunt) | Vercel | Free |
| The multiplayer game server (WebSocket) | Render | Free, with a caveat |

The letter hunt works **entirely without the game server**. If Julie is playing
solo to find the five pieces, you only need step 1.

---

## 0. Push the latest code

The repo is already set up and pointed at GitHub, so this is just:

```bash
git add .
git commit -m "Add Render deploy config"
git push
```

`.gitignore` excludes `node_modules/`, `.next/`, `dist-server/` and `.env.local`,
so no secrets or build output get committed. Run `git status` first if you want
to confirm what's going up.

---

## 1. The game on Vercel

1. Go to vercel.com, **Add New → Project**, import the repo.
2. Framework preset: **Next.js**. Leave build settings alone.
3. Deploy.

That's it — solo play works immediately. Multiplayer is hidden until you set
`NEXT_PUBLIC_GAME_SERVER` (step 3).

---

## 2. The game server on Render

The repo already contains `render.yaml`, so Render can configure itself.

### Option A — Blueprint (uses render.yaml)

1. Go to dashboard.render.com → **New → Blueprint**.
2. Pick your repo. Render reads `render.yaml` and proposes
   **my-julie-server** as a free web service.
3. **Apply**. First build takes a couple of minutes.

### Option B — Manual

1. **New → Web Service**, pick your repo.
2. Settings:
   - **Runtime**: Node
   - **Build command**: `npm install --include=dev && npm run build:server`
   - **Start command**: `npm run start:server`
   - **Instance type**: Free
   - **Health check path**: `/health`
3. **Create Web Service**.

### Check it worked

Render gives you a URL like `https://my-julie-server.onrender.com`. Visit
`/health` in a browser — you should see:

```json
{ "ok": true, "phase": "lobby", "players": 0, "seed": 123456789 }
```

The server binds `0.0.0.0` and reads Render's `PORT`, and the WebSocket shares
that one HTTP port, so nothing else needs configuring.

---

## 3. Point the game at the server

In Vercel → your project → **Settings → Environment Variables**, add:

```
NEXT_PUBLIC_GAME_SERVER = wss://my-julie-server.onrender.com
```

**`wss://`, not `ws://`** — an HTTPS page is not allowed to open an insecure
WebSocket, and swapping the scheme is the single most common mistake here. Use
the same hostname Render gave you, with no port and no trailing slash.

Then **redeploy** the Vercel project. `NEXT_PUBLIC_*` values are baked in at
build time, so an existing deployment will not pick this up on its own.

The lobby's **Play together** button appears only once this is set.

---

## The free-tier caveat

A Render free web service **spins down after 15 minutes with no traffic**, and
takes about a minute to wake. Idle WebSocket connections count as no traffic.

In practice: the first person to hit **Play together** after a quiet spell waits
roughly a minute while "Connecting…" sits there. To avoid the wait, open
`https://my-julie-server.onrender.com/health` first and let it load — that wakes
the server while you both pick characters.

Free services also get 750 instance-hours per month per workspace, which is
plenty for one occasional server.

---

## Running it locally instead

No hosting needed at all:

```bash
npm install
npm run dev:all
```

Serves the game on `http://localhost:3111` and the game server on port 3112.
On the same wifi, open `http://<your-lan-ip>:3111/game` on a phone — with
`NEXT_PUBLIC_GAME_SERVER` unset, the client automatically targets that same host
on port 3112.

If a phone shows a black page, add its IP to `allowedDevOrigins` in
`next.config.ts` and restart — Next blocks cross-origin dev assets by default.
