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
