const express = require('express');
const axios = require('axios');
const session = require('express-session');
const { Redis } = require('@upstash/redis');

const app = express();

// ============================================================
//  ENVIRONMENT VARIABLES
// ============================================================
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'fallback-secret';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://my-photos-app-xi.vercel.app/oauth2callback';
const SCOPES = ['https://www.googleapis.com/auth/photoslibrary.readonly'];

// ============================================================
//  SESSION STORE – try Redis, fallback to MemoryStore
// ============================================================
let sessionStore;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
        const redisClient = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
        const RedisStore = require('connect-redis')(session);
        sessionStore = new RedisStore({ client: redisClient });
        console.log('[Session] Using Redis store (Upstash)');
    } catch (err) {
        console.error('[Session] Redis init failed, using MemoryStore:', err.message);
        sessionStore = new session.MemoryStore();
    }
} else {
    console.warn('[Session] Upstash Redis env vars missing – using MemoryStore (sessions will not persist across restarts)');
    sessionStore = new session.MemoryStore();
}

// ============================================================
//  SESSION MIDDLEWARE
// ============================================================
app.use(session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax',
    }
}));

app.use(express.json());

// ============================================================
//  ROUTES
// ============================================================
app.get('/auth', (req, res) => {
    if (!CLIENT_ID) return res.status(500).send('Missing GOOGLE_CLIENT_ID');
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' +
        `client_id=${encodeURIComponent(CLIENT_ID)}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(SCOPES.join(' '))}` +
        `&access_type=offline` +
        `&prompt=consent`;
    res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('No code provided.');

    try {
        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
            code,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            redirect_uri: REDIRECT_URI,
            grant_type: 'authorization_code'
        });

        const { access_token, refresh_token, expires_in } = tokenResponse.data;
        req.session.access_token = access_token;
        req.session.refresh_token = refresh_token;
        req.session.expires_at = Date.now() + expires_in * 1000;

        res.redirect('/photos');
    } catch (error) {
        console.error('Token exchange error:', error.response?.data || error.message);
        res.status(500).send('Token exchange failed.');
    }
});

app.get('/photos', async (req, res) => {
    if (!req.session.access_token) {
        return res.redirect('/auth');
    }

    if (Date.now() > req.session.expires_at) {
        try {
            const refreshRes = await axios.post('https://oauth2.googleapis.com/token', {
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                refresh_token: req.session.refresh_token,
                grant_type: 'refresh_token'
            });
            req.session.access_token = refreshRes.data.access_token;
            req.session.expires_at = Date.now() + refreshRes.data.expires_in * 1000;
        } catch (e) {
            console.error('Token refresh error:', e.response?.data || e.message);
            return res.redirect('/auth');
        }
    }

    try {
        const photosRes = await axios.get('https://photoslibrary.googleapis.com/v1/mediaItems', {
            headers: { Authorization: `Bearer ${req.session.access_token}` },
            params: { pageSize: 50 }
        });

        const items = photosRes.data.mediaItems || [];
        // Render a simple HTML gallery (you can replace with the polished version)
        let html = `<h1>Your Photos</h1><p>${items.length} images loaded.</p>`;
        if (items.length > 0) {
            html += '<div style="display:flex;flex-wrap:wrap;gap:8px;">';
            for (const item of items) {
                html += `<img src="${item.baseUrl}" style="width:150px;height:150px;object-fit:cover;" />`;
            }
            html += '</div>';
        }
        res.send(html);
    } catch (error) {
        console.error('Photos fetch error:', error.response?.data || error.message);
        res.status(500).send('Error fetching photos.');
    }
});

app.get('/', (req, res) => res.redirect('/index.html'));

module.exports = app;
