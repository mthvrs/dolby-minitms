const express = require('express');
const httpReq = require('http');
const httpsReq = require('https');
const { URL } = require('url');
const config = require('../config');
const { mediamtxHttpOrigin } = require('../services/webrtcGateway');
const { slugify } = require('../utils/stringUtils');

const router = express.Router();

router.use(express.text({ type: ['application/sdp', 'text/plain'], limit: '2mb' }));

function postText(urlStr, body, headers) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlStr);
        const libReq = u.protocol === 'https:' ? httpsReq.request : httpReq.request;
        const opts = {
            method: 'POST',
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + u.search,
            headers: Object.assign({ 'Content-Type': 'application/sdp', 'Content-Length': Buffer.byteLength(body) }, headers || {})
        };
        const req = libReq(opts, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Enumerate streams for UI
router.get('/api/streams', (req, res) => {
    const out = {};
    for (const name of Object.keys(config.THEATERS)) {
        const slug = slugify(name);
        out[name] = { mode: 'webrtc', whep: `/api/whep/${encodeURIComponent(slug)}` };
    }
    res.json(out);
});

// WHEP proxy
router.post('/api/whep/:slug', async (req, res) => {
    const { slug } = req.params;
    const upstream = `${mediamtxHttpOrigin}/${encodeURIComponent(slug)}/whep`;
    try {
        const r = await postText(upstream, req.body, { 'Content-Type': 'application/sdp' });
        res.status(r.status || 502);
        if (r.headers['content-type']) res.setHeader('Content-Type', r.headers['content-type']);
        res.send(r.data);
    } catch (e) {
        // [FIX] Removed optional chaining (?.) for Node 13 compatibility
        const msg = (e && e.message) ? e.message : e;
        console.error('WHEP proxy error:', msg);
        res.status(502).send('WHEP upstream error');
    }
});

module.exports = router;