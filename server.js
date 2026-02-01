const path = require('path');
const express = require('express');
const expressWs = require('express-ws');
const config = require('./config');
const webrtcGateway = require('./services/webrtcGateway');
const Logger = require('./services/logger');

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

// Fallback to index.html for SPA-like navigation (optional)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Start Server
const HOST = '0.0.0.0'; 

app.listen(config.PORT, HOST, () => {
    logger.info(`Dolby Control Server listening on http://${HOST}:${config.PORT}`);
    logger.info(`Access this UI from other computers using your en02 IP address.`);
});