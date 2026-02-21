#!/bin/bash
set -e

PR_BRANCH="stream-manager-shared-processes-16636191889178202055"
PR_SHA="28542111ccfa82697dbb15dc67752f740902f0a9"

echo "=== Resetting PR branch to origin/main ==="
git fetch origin
git checkout "$PR_BRANCH"
git rebase --abort 2>/dev/null || true
rm -fr ".git/rebase-merge" 2>/dev/null || true
git reset --hard origin/main

echo "=== Copying new/non-conflicting files from PR ==="
git checkout "$PR_SHA" -- \
  public/css/cams.css \
  public/js/cams.js \
  public/js/components/multiviewFeed.js \
  public/js/components/multiviewOverlay.js \
  services/dolbyClientUnified.js \
  services/dolbyDCP2000Client.js \
  services/dolbyIMS3000Client.js \
  services/logger.js \
  package.json \
  package-lock.json \
  server.log

echo "=== Removing server.log (should not be tracked) ==="
git rm --cached server.log 2>/dev/null || true
echo "server.log" >> .gitignore

echo "=== Applying resolved server.js (adds graceful shutdown) ==="
cat > server.js << 'SERVEREOF'
// - server.js
const path = require('path');
const express = require('express');
const expressWs = require('express-ws');
const config = require('./config');
const webrtcGateway = require('./services/webrtcGateway');
const Logger = require('./services/logger');
const playbackRouter = require('./routes/playback');

const logger = new Logger('Server');
const app = express();
expressWs(app);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

webrtcGateway.ensureRunning();

app.use(require('./routes/streams'));
const theaters = require('./routes/theaters');
app.use(theaters.router);
app.use('/api/macros', require('./routes/macros'));
app.use(playbackRouter);

app.get('/cams', (req, res) => {
    logger.info(`Client requesting Multiview Page (/cams) from ${req.ip}`);
    res.sendFile(path.join(__dirname, 'public', 'cams.html'));
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/api/system/restart', (req, res) => {
    logger.info(`Remote restart requested by ${req.ip}`);
    res.json({ success: true, message: 'Rebooting system...' });
    setTimeout(() => {
        logger.info('Stopping services and exiting process...');
        shutdown();
    }, 1000);
});

async function shutdown() {
    logger.info('Shutting down...');
    webrtcGateway.stop();
    logger.info('Closing theater sessions...');
    const { clients } = require('./routes/theaters');
    for (const client of Object.values(clients)) {
        try {
            await client.destroy();
            logger.info(`Session destroyed for ${client.name}`);
        } catch (e) {
            logger.error(`Error destroying session for ${client.name}: ${e.message}`);
        }
    }
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const HOST = '0.0.0.0';
app.listen(config.PORT, HOST, () => {
    logger.info(`Dolby Control Server listening on http://${HOST}:${config.PORT}`);
    logger.info(`Access this UI from other computers using your en02 IP address.`);
});
SERVEREOF

echo "=== Applying resolved routes/playback.js ==="
cat > routes/playback.js << 'PLAYBACKEOF'
const express = require('express');
const router = express.Router();
const { resolveName, clients } = require('./theaters');
const config = require('../config');
const Logger = require('../services/logger');

const logger = new Logger('Playback API');

// API endpoint
router.get('/api/playback/:id', async (req, res) => {
    const name = resolveName(req.params.id);
    if (!name) return res.status(404).json({ error: 'Theater not found' });

    try {
        const playbackStatus = await clients[name].getPlaybackStatus();
        res.json({ 
            success: true, 
            theater: name,
            playback: playbackStatus
        });
    } catch (error) {
        logger.error(`Error getting playback status for ${name}: ${error.message}`);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

module.exports = router;
PLAYBACKEOF

echo "=== Updating public/js/api.js to add formatSplTitle ==="
git checkout "$PR_SHA" -- public/js/api.js

echo "=== Updating public/js/components/playbackTimeline.js ==="
git checkout "$PR_SHA" -- public/js/components/playbackTimeline.js

echo "=== Updating public/cams.html ==="
git checkout "$PR_SHA" -- public/cams.html

echo "=== Updating public/index.html (remove jsmpeg) ==="
git checkout "$PR_SHA" -- public/index.html

echo "=== Staging all changes ==="
git add -A

echo "=== Committing ==="
git commit -m "fix: resolve conflicts and integrate PR#35 changes onto current main

- Graceful shutdown with SIGTERM/SIGINT in server.js
- Playback status delegated to client classes (dolbyClientUnified, DCP2000, IMS3000)
- Frontend refactored: cams.html extracts CSS/JS to separate files
- API.formatSplTitle() deduplicated into api.js
- Logger uses stream-based writes
- server.log excluded from tracking"

echo "=== Force pushing ==="
git push origin "$PR_BRANCH" --force-with-lease

echo "=== Done! Check https://github.com/mthvrs/dolby-minitms/pull/35 ==="