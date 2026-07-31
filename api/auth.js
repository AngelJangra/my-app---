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
//  SESSION STORE – TRY REDIS, FALLBACK TO MEMORY
// ============================================================
let sessionStore;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
        const redisClient = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
        // Correct import for connect-redis v7+
        const RedisStore = require('connect-redis');
        sessionStore = new RedisStore({ client: redisClient });
        console.log('[Session] ✅ Using Redis store (Upstash)');
    } catch (err) {
        console.error('[Session] ❌ Redis init failed:', err.message);
        sessionStore = new session.MemoryStore();
    }
} else {
    console.warn('[Session] ⚠️ Upstash env vars missing – using MemoryStore (will cause redirect loop!)');
    sessionStore = new session.MemoryStore();
}

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
    console.log('[Auth] Redirecting to Google');
    res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
        console.error('[OAuth] No code provided');
        return res.status(400).send('No code provided.');
    }

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

        console.log('[OAuth] ✅ Token exchange successful.');
        res.redirect('/photos');
    } catch (error) {
        console.error('[OAuth] ❌ Token exchange error:', error.response?.data || error.message);
        res.status(500).send('Token exchange failed.');
    }
});

app.get('/photos', async (req, res) => {
    if (!req.session.access_token) {
        console.log('[Photos] No token in session, redirecting to /auth');
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
            console.log('[OAuth] Token refreshed.');
        } catch (e) {
            console.error('[OAuth] Token refresh error:', e.response?.data || e.message);
            return res.redirect('/auth');
        }
    }

    try {
        const photosRes = await axios.get('https://photoslibrary.googleapis.com/v1/mediaItems', {
            headers: { Authorization: `Bearer ${req.session.access_token}` },
            params: { pageSize: 50 }
        });
        const items = photosRes.data.mediaItems || [];
        // Simple gallery (you can replace with your polished version)
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
        console.error('[Photos] Fetch error:', error.response?.data || error.message);
        res.status(500).send('Error fetching photos.');
    }
});

app.get('/', (req, res) => res.redirect('/index.html'));

// ============================================================
//  TEST ROUTE TO VERIFY SESSION & REDIS
// ============================================================
app.get('/debug-session', (req, res) => {
    res.json({
        hasToken: !!req.session.access_token,
        sessionID: req.sessionID,
        storeType: process.env.UPSTASH_REDIS_REST_URL ? 'Redis (Upstash)' : 'MemoryStore',
    });
});

module.exports = app;
