// ============================================================
//  Google Photos OAuth 2.0 – Serverless Handler for Vercel
//  Includes a beautiful photo gallery at /photos
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
//  FIXED REDIRECT URI – MUST BE EXACTLY THE SAME IN GOOGLE CONSOLE
// ============================================================
// 🔥 CHANGE THIS TO YOUR ACTUAL DEPLOYED URL
const REDIRECT_URI = 'https://my-photos-app-xi.vercel.app/oauth2callback';

// For local development, uncomment the line below and comment the above:
// const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

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
//  ROUTE: /auth – Redirect to Google's consent screen
// ============================================================
app.get('/auth', (req, res) => {
    if (!CLIENT_ID) {
        return res.status(500).send('❌ Missing GOOGLE_CLIENT_ID.');
    }

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
            redirect_uri: REDIRECT_URI,
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
//  ROUTE: /photos – Beautiful, modern photo gallery
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

        // Render a full, polished gallery
        let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Google Photos</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            background: #0a0a12;
            color: #e0e0e0;
            font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
            padding: 24px;
            min-height: 100vh;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 16px;
            padding: 16px 24px;
            background: rgba(20, 20, 31, 0.6);
            backdrop-filter: blur(20px);
            border-radius: 20px;
            border: 1px solid rgba(42, 42, 68, 0.3);
            margin-bottom: 28px;
        }
        .header h1 {
            font-size: 26px;
            font-weight: 700;
            background: linear-gradient(135deg, #f7971e, #ffd200);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .header h1 span {
            font-size: 28px;
            -webkit-text-fill-color: initial;
            color: #ff3b3b;
        }
        .header .actions {
            display: flex;
            gap: 12px;
            align-items: center;
        }
        .header .actions a {
            color: #88ccff;
            text-decoration: none;
            font-weight: 500;
            padding: 8px 18px;
            border-radius: 40px;
            border: 1px solid rgba(42, 42, 68, 0.4);
            transition: all 0.2s;
            background: rgba(42, 42, 68, 0.2);
        }
        .header .actions a:hover {
            background: rgba(58, 58, 90, 0.6);
            border-color: #f7971e;
        }
        .header .count {
            color: #4a6a7a;
            font-size: 14px;
        }
        .gallery {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
            gap: 18px;
        }
        .card {
            background: rgba(20, 20, 31, 0.5);
            backdrop-filter: blur(20px);
            border-radius: 16px;
            overflow: hidden;
            border: 1px solid rgba(42, 42, 68, 0.3);
            transition: all 0.3s ease;
        }
        .card:hover {
            border-color: rgba(247, 151, 30, 0.4);
            transform: translateY(-6px);
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
        }
        .card img {
            width: 100%;
            height: 200px;
            object-fit: cover;
            display: block;
            background: #1a1a2e;
        }
        .card .info {
            padding: 12px 16px;
            font-size: 12px;
            color: #8a8aaa;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-top: 1px solid rgba(42, 42, 68, 0.2);
        }
        .card .info .filename {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 130px;
        }
        .card .info .date {
            color: #4a6a7a;
        }
        .no-photos {
            grid-column: 1 / -1;
            text-align: center;
            padding: 80px 20px;
            color: #4a6a7a;
            font-size: 20px;
        }
        .no-photos .big {
            font-size: 48px;
            display: block;
            margin-bottom: 12px;
        }
        .footer-credit {
            text-align: center;
            color: #4a6a7a;
            font-size: 12px;
            margin-top: 36px;
            border-top: 1px solid rgba(42, 42, 68, 0.2);
            padding-top: 20px;
        }
        .footer-credit span {
            color: #f7971e;
            font-weight: 600;
        }
        @media (max-width: 640px) {
            .gallery {
                grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
                gap: 12px;
            }
            .card img {
                height: 150px;
            }
            .header {
                flex-direction: column;
                align-items: stretch;
                text-align: center;
            }
            .header .actions {
                justify-content: center;
                flex-wrap: wrap;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1><span>☠️</span> My Photos</h1>
            <div class="actions">
                <span class="count">${items.length} images</span>
                <a href="/">← Home</a>
                <a href="/auth">⟳ Re‑authorize</a>
            </div>
        </div>
        <div class="gallery">`;

        if (items.length === 0) {
            html += `
                <div class="no-photos">
                    <span class="big">📸</span>
                    No photos found in your Google Photos library.
                </div>`;
        } else {
            for (const item of items) {
                const url = item.baseUrl || '';
                const filename = item.filename || 'photo';
                const time = item.mediaMetadata?.creationTime || '';
                const date = time ? new Date(time).toLocaleDateString() : '';
                html += `
            <div class="card">
                <img src="${url}" alt="${filename}" loading="lazy" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22220%22 height=%22200%22%3E%3Crect fill=%22%231a1a2e%22 width=%22220%22 height=%22200%22/%3E%3Ctext x=%2250%%22 y=%2250%%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%234a6a7a%22 font-family=%22sans-serif%22 font-size=%2216%22%3E⚠️%3C/text%3E%3C/svg%3E'" />
                <div class="info">
                    <span class="filename" title="${filename}">${filename}</span>
                    <span class="date">${date}</span>
                </div>
            </div>`;
            }
        }

        html += `
        </div>
        <div class="footer-credit">
            Made with ❤️ by <span>AJ</span>
        </div>
    </div>
</body>
</html>`;
        res.send(html);
    } catch (error) {
        console.error('[Photos] Fetch error:', error.response?.data || error.message);
        res.status(500).send(`
            <h1>❌ Error fetching photos</h1>
            <p>${error.message}</p>
            <p><a href="/auth">Try re‑authorizing</a></p>
        `);
    }
});

// ============================================================
//  ROOT – Redirect to static index.html
// ============================================================
app.get('/', (req, res) => {
    res.redirect('/index.html');
});

// ============================================================
//  EXPORT for Vercel
// ============================================================
module.exports = app;
