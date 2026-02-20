// - server.js
const path = require('path');
const express = require('express');
const expressWs = require('express-ws');
const config = require('./config');
const webrtcGateway = require('./services/webrtcGateway');
const Logger = require('./services/logger');
const playbackRouter = require('./routes/playback');

// Initialize Logger
const logger = new Logger('Server');

// Initialize Express
const app = express();
expressWs(app); // Enable WebSocket support

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// Serve Static Files (The Web UI)
app.use(express.static(path.join(__dirname, 'public')));

// Start Background Services
webrtcGateway.ensureRunning();

// Load Routes
app.use(require('./routes/streams'));
const theaters = require('./routes/theaters');
app.use(theaters.router);
app.use('/api/macros', require('./routes/macros'));
app.use(playbackRouter);

// Multiview Route
app.get('/cams', (req, res) => {
    logger.info(`Client requesting Multiview Page (/cams) from ${req.ip}`);
    res.sendFile(path.join(__dirname, 'public', 'cams.html'));
});

// Fallback to index.html for SPA-like navigation
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/api/system/restart', (req, res) => {
    logger.info(`Remote restart requested by ${req.ip}`);
    res.json({ success: true, message: 'Rebooting system...' });
    
    setTimeout(() => {
        logger.info('Stopping services and exiting process...');
        shutdown();
    }, 1000);
});

// Graceful Shutdown Logic
async function shutdown() {
    logger.info('Shutting down...');

    // Stop WebRTC
    webrtcGateway.stop();

    // Stop all theater sessions
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

// Start Server
const HOST = '0.0.0.0'; 

app.listen(config.PORT, HOST, () => {
    logger.info(`Dolby Control Server listening on http://${HOST}:${config.PORT}`);
    logger.info(`Access this UI from other computers using your en02 IP address.`);
});