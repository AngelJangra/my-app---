// ============================================================
//  Google Photos OAuth 2.0 – Serverless Handler for Vercel
//  Uses Express, session (in‑memory), and Axios.
// ============================================================

const express = require('express');
const axios = require('axios');
const session = require('express-session');

const app = express();

// ============================================================
//  ENVIRONMENT VARIABLES (set in Vercel Dashboard)
// ============================================================
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'fallback-secret-change-me';

// ============================================================
//  FIXED REDIRECT URI – MUST MATCH EXACTLY IN GOOGLE CONSOLE
//  For production, use your live domain.
//  For local dev, you can use http://localhost:3000/oauth2callback
// ============================================================
// Hardcode production URI to avoid any dynamic mismatch.
// Uncomment the line below and comment the dynamic one if you prefer.
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://my-photos-app-xi.vercel.app/oauth2callback';
// For local testing, you can set REDIRECT_URI=http://localhost:3000/oauth2callback

// Alternatively, keep dynamic (but ensure the host matches exactly).
// We'll use a helper to get the base URL, but we will also allow hardcoding.
function getBaseUrl(req) {
    // If we have a hardcoded REDIRECT_URI, we can extract the base.
    // But we'll use the request host for flexibility.
    // For production, we trust the request host.
    return `${req.protocol}://${req.get('host')}`;
}

// We'll use a function to get the redirect URI – but for safety we use the constant.
// We'll use REDIRECT_URI constant directly.
const SCOPES = ['https://www.googleapis.com/auth/photoslibrary.readonly'];

// ============================================================
//  SESSION CONFIG
// ============================================================
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 1 day
    }
}));

app.use(express.json());

// ============================================================
//  LOGGING MIDDLEWARE (for debugging)
// ============================================================
app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.url}`);
    next();
});

// ============================================================
//  ROUTE: /auth – Redirect to Google's OAuth consent screen
// ============================================================
app.get('/auth', (req, res) => {
    // Ensure we have the required credentials
    if (!CLIENT_ID) {
        return res.status(500).send('❌ Missing GOOGLE_CLIENT_ID environment variable.');
    }

    // Construct the authorization URL
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' +
        `client_id=${encodeURIComponent(CLIENT_ID)}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(SCOPES.join(' '))}` +
        `&access_type=offline` +
        `&prompt=consent`;

    console.log(`[Auth] Redirecting to: ${authUrl}`);
    res.redirect(authUrl);
});

// ============================================================
//  ROUTE: /oauth2callback – Exchange code for tokens
// ============================================================
app.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
        return res.status(400).send('❌ No authorization code provided.');
    }

    try {
        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
            code: code,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            redirect_uri: REDIRECT_URI,   // MUST match exactly
            grant_type: 'authorization_code'
        });

        const { access_token, refresh_token, expires_in } = tokenResponse.data;
        req.session.access_token = access_token;
        req.session.refresh_token = refresh_token;
        req.session.expires_at = Date.now() + expires_in * 1000;

        console.log('[OAuth] Token exchange successful.');
        res.redirect('/photos');
    } catch (error) {
        console.error('[OAuth] Token exchange error:', error.response?.data || error.message);
        res.status(500).send(`❌ Failed to exchange authorization code. Error: ${error.message}`);
    }
});

// ============================================================
//  ROUTE: /photos – Fetch and display photos
// ============================================================
app.get('/photos', async (req, res) => {
    if (!req.session.access_token) {
        return res.redirect('/auth');
    }

    // Refresh token if expired
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
            console.log('[OAuth] Token refreshed successfully.');
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

        if (items.length === 0) {
            return res.send(`
                <h1>📸 No photos found</h1>
                <p><a href="/">Go back home</a></p>
            `);
        }

        // Build a simple gallery HTML (same as before, but we'll keep it clean)
        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>My Google Photos</title>
            <style>
                * { margin:0; padding:0; box-sizing:border-box; }
                body { background:#0a0a12; color:#e0e0e0; font-family:'Segoe UI',sans-serif; padding:20px; }
                .header { display:flex; justify-content:space-between; align-items:center; padding:16px 24px; background:#1a1a2e; border-radius:16px; margin-bottom:20px; }
                .header h1 { color:#f7971e; }
                .header a { color:#88ccff; text-decoration:none; }
                .gallery { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:16px; max-width:1200px; margin:0 auto; }
                .card { background:#1a1a2e; border-radius:12px; overflow:hidden; border:1px solid #2a2a44; transition:transform 0.2s; }
                .card:hover { transform:scale(1.02); }
                .card img { width:100%; height:180px; object-fit:cover; display:block; }
                .card .info { padding:8px 12px; font-size:11px; color:#8a8aaa; }
                .footer { text-align:center; color:#4a6a7a; margin-top:20px; }
                .credit { text-align:center; color:#4a6a7a; font-size:11px; margin-top:24px; border-top:1px solid #2a2a44; padding-top:16px; }
                .credit span { color:#f7971e; }
                @media (max-width:600px) { .gallery { grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); } }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>📸 My Photos</h1>
                <a href="/">← Home</a>
            </div>
            <div class="gallery">`;

        for (const item of items) {
            const url = item.baseUrl || '';
            const filename = item.filename || 'photo';
            const time = item.mediaMetadata?.creationTime || '';
            html += `
                <div class="card">
                    <img src="${url}" alt="${filename}" loading="lazy" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22180%22%3E%3Crect fill=%22%231a1a2e%22 width=%22200%22 height=%22180%22/%3E%3Ctext x=%2250%%22 y=%2250%%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%234a6a7a%22 font-size=%2214%22%3E⚠️%3C/text%3E%3C/svg%3E'">
                    <div class="info">${filename} · ${new Date(time).toLocaleDateString()}</div>
                </div>`;
        }

        html += `
            </div>
            <div class="footer">${items.length} photos loaded</div>
            <div class="credit">Made with ❤️ by <span>AJ</span></div>
        </body>
        </html>`;
        res.send(html);
    } catch (error) {
        console.error('[Photos] Fetch error:', error.response?.data || error.message);
        res.status(500).send('❌ Error fetching photos. Please try again.');
    }
});

// ============================================================
//  ROOT – Redirect to static index.html
// ============================================================
app.get('/', (req, res) => {
    res.redirect('/index.html');
});

// ============================================================
//  EXPORT the Express app for Vercel
// ============================================================
module.exports = app;
