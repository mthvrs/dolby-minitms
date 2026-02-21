const express = require('express');
const router = express.Router();
const { resolveName, clients } = require('./theaters');

const logger = {
    info: (msg) => console.log(`[Playback API] ${msg}`),
    warn: (msg) => console.warn(`[Playback API] ${msg}`),
    error: (msg) => console.error(`[Playback API] ${msg}`),
    debug: (msg) => console.log(`[Playback API] ${msg}`),
    truncate: (str, len) => str.length > len ? str.substring(0, len) + '...' : str
};

// API endpoint
router.get('/api/playback/:id', async (req, res) => {
    const name = resolveName(req.params.id);
    if (!name) return res.status(404).json({ error: 'Theater not found' });

    const client = clients[name];
    if (!client) {
        return res.status(500).json({ error: 'Client not initialized' });
    }

    try {
        const playbackStatus = await client.getPlaybackStatus();
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
