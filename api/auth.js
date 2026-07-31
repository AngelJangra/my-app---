const express = require('express');
const axios = require('axios');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const { Redis } = require('@upstash/redis');

const app = express();

// ============================================================
//  ENVIRONMENT VARIABLES
// ============================================================
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'fallback-secret';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://my-photos-app-xi.vercel.app/oauth2callback';

// ============================================================
//  REDIS CLIENT (Upstash)
// ============================================================
const redisClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ============================================================
//  SESSION CONFIG with Redis Store
// ============================================================
app.use(session({
    store: new RedisStore({ client: redisClient }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // true on Vercel (HTTPS)
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 1 day
        sameSite: 'lax',
    }
}));

app.use(express.json());

// ============================================================
//  ROUTES (unchanged logic)
// ============================================================
const SCOPES = ['https://www.googleapis.com/auth/photoslibrary.readonly'];

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
        console.error(error.response?.data || error.message);
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
            return res.redirect('/auth');
        }
    }

    try {
        const photosRes = await axios.get('https://photoslibrary.googleapis.com/v1/mediaItems', {
            headers: { Authorization: `Bearer ${req.session.access_token}` },
            params: { pageSize: 50 }
        });
        // ... (your gallery HTML rendering code)
        res.send(`<h1>${photosRes.data.mediaItems?.length || 0} photos loaded</h1>`);
    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).send('Error fetching photos.');
    }
});

app.get('/', (req, res) => res.redirect('/index.html'));

module.exports = app;
