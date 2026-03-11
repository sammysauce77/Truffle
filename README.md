# 🍄 Truffle — True Shuffle for Spotify

Paste a Spotify playlist link → get a new, genuinely shuffled playlist in your account using Fisher-Yates.

---

## Setup (takes ~10 minutes)

### 1. Register a Spotify App

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Log in and click **Create App**
3. Fill in:
   - **App name**: Truffle (or anything)
   - **App description**: True shuffle tool
   - **Redirect URI**: `http://localhost:3000/callback` (add this exactly)
   - Tick the **Web API** checkbox
4. Click **Save**, then open your app settings
5. Copy your **Client ID** and **Client Secret**

---

### 2. Install & Configure

```bash
# Clone or download this folder, then:
cd truffle
npm install

# Copy the example env file
cp .env.example .env
```

Edit `.env` and fill in your values:

```
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
SPOTIFY_REDIRECT_URI=http://localhost:3000/callback
SESSION_SECRET=any_long_random_string_like_this_abc123xyz
PORT=3000
```

---

### 3. Run Locally

```bash
npm start
# or for auto-reload during dev:
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Deploy to Render (free)

1. Push this folder to a GitHub repository
2. Go to [render.com](https://render.com) → **New Web Service**
3. Connect your GitHub repo
4. Set:
   - **Build command**: `npm install`
   - **Start command**: `npm start`
5. Add **Environment Variables** in the Render dashboard:
   ```
   SPOTIFY_CLIENT_ID=...
   SPOTIFY_CLIENT_SECRET=...
   SPOTIFY_REDIRECT_URI=https://YOUR-APP.onrender.com/callback
   SESSION_SECRET=...
   ```
6. After deploy, go back to your Spotify App dashboard and **add the Render URL** as a Redirect URI:
   `https://YOUR-APP.onrender.com/callback`

---

## Deploy to Railway (alternative)

1. Push to GitHub
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. Add the same environment variables
4. Update your Spotify redirect URI to the Railway URL

---

## How it works

- **OAuth 2.0** with session tokens (auto-refreshed)
- **Fisher-Yates** shuffle — every permutation equally probable
- **Smart mode** — runs Fisher-Yates then nudges same-artist tracks apart
- Tracks fetched in paginated batches (handles playlists of any size)
- New playlist created privately in your Spotify account
- Tracks added in batches of 100 (Spotify API limit per request)

---

## Permissions requested from Spotify

| Scope | Reason |
|---|---|
| `playlist-read-private` | Read your private playlists |
| `playlist-read-collaborative` | Read collaborative playlists |
| `playlist-modify-public` | Create public playlists |
| `playlist-modify-private` | Create private playlists |

The new playlist is created as **private** by default.
