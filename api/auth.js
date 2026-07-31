const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');

const app = express();

// ============================================================
//  ENVIRONMENT VARIABLES
// ============================================================
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'fallback-secret-change-me';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://my-photos-app-xi.vercel.app/oauth2callback';
const SCOPES = ['https://www.googleapis.com/auth/photoslibrary.readonly'];

// ============================================================
//  COOKIE PARSER
// ============================================================
app.use(cookieParser(COOKIE_SECRET));
app.use(express.json());

// ============================================================
//  HELPER: Set tokens in signed cookies
// ============================================================
const setTokenCookies = (res, access_token, refresh_token, expires_in) => {
    const maxAge = expires_in * 1000;
    res.cookie('access_token', access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        signed: true,
        maxAge: maxAge,
        sameSite: 'lax'
    });
    res.cookie('refresh_token', refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        signed: true,
        maxAge: 30 * 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    });
    res.cookie('expires_at', Date.now() + maxAge, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        signed: true,
        maxAge: maxAge,
        sameSite: 'lax'
    });
};

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
        setTokenCookies(res, access_token, refresh_token, expires_in);

        console.log('[OAuth] ✅ Token exchange successful. Cookies set.');
        res.redirect('/photos');
    } catch (error) {
        console.error('[OAuth] ❌ Token exchange error:', error.response?.data || error.message);
        res.status(500).send(`Token exchange failed: ${error.message}`);
    }
});

app.get('/photos', async (req, res) => {
    const access_token = req.signedCookies.access_token;
    const refresh_token = req.signedCookies.refresh_token;
    const expires_at = req.signedCookies.expires_at;

    if (!access_token) {
        console.log('[Photos] No access token, redirecting to /auth');
        return res.redirect('/auth');
    }

    if (Date.now() > parseInt(expires_at || 0)) {
        if (!refresh_token) {
            console.log('[Photos] No refresh token, redirecting to /auth');
            return res.redirect('/auth');
        }
        try {
            const refreshRes = await axios.post('https://oauth2.googleapis.com/token', {
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                refresh_token: refresh_token,
                grant_type: 'refresh_token'
            });
            const newAccess = refreshRes.data.access_token;
            const newExpires = refreshRes.data.expires_in;
            setTokenCookies(res, newAccess, refresh_token, newExpires);
            console.log('[OAuth] Token refreshed and cookies updated.');
            return res.redirect('/photos');
        } catch (e) {
            console.error('[OAuth] Token refresh error:', e.response?.data || e.message);
            res.clearCookie('access_token');
            res.clearCookie('refresh_token');
            res.clearCookie('expires_at');
            return res.redirect('/auth');
        }
    }

    try {
        const photosRes = await axios.get('https://photoslibrary.googleapis.com/v1/mediaItems', {
            headers: { Authorization: `Bearer ${access_token}` },
            params: { pageSize: 50 }
        });
        const items = photosRes.data.mediaItems || [];
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
        const errorMsg = error.response?.data?.error?.message || error.message;
        res.status(500).send(`
            <h1>❌ Error fetching photos</h1>
            <p><strong>${errorMsg}</strong></p>
            <p>Full error: <pre>${JSON.stringify(error.response?.data || error.message, null, 2)}</pre></p>
            <p><a href="/auth">Try re-authorizing</a></p>
        `);
    }
});

// ============================================================
//  DEBUG ROUTE – Check cookies
// ============================================================
app.get('/debug-cookies', (req, res) => {
    res.json({
        hasAccessToken: !!req.signedCookies.access_token,
        hasRefreshToken: !!req.signedCookies.refresh_token,
        expires_at: req.signedCookies.expires_at || null,
        cookies: req.cookies,
        signedCookies: req.signedCookies,
    });
});

app.get('/', (req, res) => res.redirect('/index.html'));

module.exports = app;
