// ============================================================
//  Google Photos OAuth 2.0 – Serverless Handler for Vercel
//  Uses Express with session (in‑memory) and Axios.
// ============================================================

const express = require('express');
const axios = require('axios');
const session = require('express-session');

const app = express();

// ============================================================
//  CONFIG – Set these environment variables in Vercel Dashboard
// ============================================================
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'your-super-secret-key-change-this';

// For Vercel, we need the absolute URL of the app.
// Use environment variable or fallback to the request host.
const getBaseUrl = (req) => {
    return `${req.protocol}://${req.get('host')}`;
};

const SCOPES = ['https://www.googleapis.com/auth/photoslibrary.readonly'];

// ============================================================
//  SESSION CONFIG
// ============================================================
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

app.use(express.json());

// ============================================================
//  ROUTE: /auth – Redirect to Google's OAuth consent screen
// ============================================================
app.get('/auth', (req, res) => {
    const baseUrl = getBaseUrl(req);
    const redirectUri = `${baseUrl}/oauth2callback`;
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' +
        `client_id=${CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(SCOPES.join(' '))}` +
        `&access_type=offline` +
        `&prompt=consent`;

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

    const baseUrl = getBaseUrl(req);
    const redirectUri = `${baseUrl}/oauth2callback`;

    try {
        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
            code: code,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
        });

        const { access_token, refresh_token, expires_in } = tokenResponse.data;
        // Store tokens in session (in‑memory)
        req.session.access_token = access_token;
        req.session.refresh_token = refresh_token;
        req.session.expires_at = Date.now() + expires_in * 1000;

        res.redirect('/photos');
    } catch (error) {
        console.error('Token exchange error:', error.response?.data || error.message);
        res.status(500).send('❌ Failed to exchange authorization code. Check server logs.');
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

        if (items.length === 0) {
            return res.send(`
                <h1>📸 No photos found</h1>
                <p><a href="/">Go back home</a></p>
            `);
        }

        // Build a simple gallery HTML
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
        console.error('Photos fetch error:', error.response?.data || error.message);
        res.status(500).send('❌ Error fetching photos. Please try again.');
    }
});

// ============================================================
//  ROOT – Redirect to static index.html or show a simple message
// ============================================================
app.get('/', (req, res) => {
    res.redirect('/index.html'); // Vercel serves static files from root
});

// ============================================================
//  EXPORT the Express app for Vercel
// ============================================================
module.exports = app;
