require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || `http://localhost:${PORT}/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET || 'truffle-secret-change-me';

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 }
}));

// ─── Fisher-Yates Shuffle ──────────────────────────────────────────────────
function fisherYates(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Smart shuffle: Fisher-Yates then nudge same-artist adjacencies apart
function smartShuffle(arr) {
  let shuffled = fisherYates(arr);
  for (let pass = 0; pass < 8; pass++) {
    let improved = false;
    for (let i = 0; i < shuffled.length - 1; i++) {
      const curArtist = shuffled[i].artists?.[0]?.id;
      const nextArtist = shuffled[i + 1].artists?.[0]?.id;
      if (curArtist && curArtist === nextArtist) {
        for (let j = i + 2; j < shuffled.length; j++) {
          const swapArtist = shuffled[j].artists?.[0]?.id;
          const prevArtist = i > 0 ? shuffled[i - 1].artists?.[0]?.id : null;
          if (swapArtist !== curArtist && swapArtist !== prevArtist) {
            [shuffled[i + 1], shuffled[j]] = [shuffled[j], shuffled[i + 1]];
            improved = true;
            break;
          }
        }
      }
    }
    if (!improved) break;
  }
  return shuffled;
}

// ─── Auth Routes ───────────────────────────────────────────────────────────

app.get('/login', (req, res) => {
  const scopes = [
    'playlist-read-private',
    'playlist-read-collaborative',
    'playlist-modify-public',
    'playlist-modify-private',
    'ugc-image-upload'
  ].join(' ');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: scopes,
    redirect_uri: REDIRECT_URI,
    show_dialog: 'true'
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

app.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=auth_denied');

  try {
    const tokenRes = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
        }
      }
    );

    req.session.tokens = {
      access_token: tokenRes.data.access_token,
      refresh_token: tokenRes.data.refresh_token,
      expires_at: Date.now() + tokenRes.data.expires_in * 1000
    };

    // Get user profile
    const me = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${req.session.tokens.access_token}` }
    });
    req.session.user = { id: me.data.id, name: me.data.display_name, image: me.data.images?.[0]?.url };

    res.redirect('/');
  } catch (err) {
    console.error('Token exchange error:', err.response?.data || err.message);
    res.redirect('/?error=token_exchange');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ─── Token Refresh Middleware ──────────────────────────────────────────────

async function ensureToken(req, res, next) {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });

  if (Date.now() > req.session.tokens.expires_at - 60000) {
    try {
      const refresh = await axios.post('https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: req.session.tokens.refresh_token
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
          }
        }
      );
      req.session.tokens.access_token = refresh.data.access_token;
      req.session.tokens.expires_at = Date.now() + refresh.data.expires_in * 1000;
    } catch (e) {
      req.session.destroy();
      return res.status(401).json({ error: 'Session expired' });
    }
  }
  next();
}

// ─── API: Session status ───────────────────────────────────────────────────

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.json({ authenticated: false });
  res.json({ authenticated: true, user: req.session.user });
});

// ─── API: Fetch playlist info ──────────────────────────────────────────────

app.get('/api/playlist', ensureToken, async (req, res) => {
  const { url } = req.query;
  const match = url?.match(/playlist\/([a-zA-Z0-9]+)/);
  if (!match) return res.status(400).json({ error: 'Invalid Spotify playlist URL' });

  const playlistId = match[1];
  const token = req.session.tokens.access_token;

  try {
    // Get playlist meta
    const meta = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { fields: 'id,name,description,images,tracks(total),owner(display_name)' }
    });

    // Paginate all tracks
    let tracks = [];
    let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,name,uri,duration_ms,artists(id,name),album(name,images)))`;

    while (nextUrl) {
      const page = await axios.get(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
      const valid = page.data.items
        .filter(i => i.track && i.track.id) // skip null/local tracks
        .map(i => i.track);
      tracks.push(...valid);
      nextUrl = page.data.next;
    }

    res.json({
      id: meta.data.id,
      name: meta.data.name,
      description: meta.data.description,
      image: meta.data.images?.[0]?.url,
      owner: meta.data.owner?.display_name,
      total: tracks.length,
      tracks
    });
  } catch (err) {
    console.error('Playlist fetch error:', err.response?.data || err.message);
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data?.error?.message || 'Failed to fetch playlist' });
  }
});

// ─── API: Create shuffled playlist ────────────────────────────────────────

app.post('/api/shuffle', ensureToken, async (req, res) => {
  const { playlistId, name, tracks, mode } = req.body;
  if (!tracks?.length) return res.status(400).json({ error: 'No tracks provided' });

  const token = req.session.tokens.access_token;
  const userId = req.session.user.id;

  try {
    // Shuffle
    const shuffled = mode === 'smart' ? smartShuffle(tracks) : fisherYates(tracks);
    const uris = shuffled.map(t => t.uri);

    // Create new playlist
    const created = await axios.post(
      `https://api.spotify.com/v1/users/${userId}/playlists`,
      {
        name: name || `🔀 ${req.body.originalName} (Truffled)`,
        description: `True random shuffle of "${req.body.originalName}" — created by Truffle`,
        public: false
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );

    const newPlaylistId = created.data.id;

    // Add tracks in batches of 100
    for (let i = 0; i < uris.length; i += 100) {
      await axios.post(
        `https://api.spotify.com/v1/playlists/${newPlaylistId}/tracks`,
        { uris: uris.slice(i, i + 100) },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
    }

    res.json({
      playlistId: newPlaylistId,
      playlistUrl: created.data.external_urls?.spotify,
      name: created.data.name,
      total: shuffled.length,
      shuffled: shuffled.slice(0, 5).map(t => t.name) // preview
    });
  } catch (err) {
    console.error('Shuffle error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || 'Failed to create playlist' });
  }
});

app.listen(PORT, () => console.log(`🍄 Truffle running on http://localhost:${PORT}`));
