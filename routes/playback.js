const express = require('express');
const router = express.Router();
const DolbySessionManager = require('../services/dolbySessionManager');
const { resolveName, clients } = require('./theaters');
const config = require('../config');

const logger = {
    info: (msg) => console.log(`[Playback API] ${msg}`),
    warn: (msg) => console.warn(`[Playback API] ${msg}`),
    error: (msg) => console.error(`[Playback API] ${msg}`),
    debug: (msg) => console.log(`[Playback API] ${msg}`),
    truncate: (str, len) => str.length > len ? str.substring(0, len) + '...' : str
};

// Constant regex pattern for UUID extraction
const uuidPattern = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;

// Cache for SOAP session IDs (keyed by theater name)
const soapSessionCache = {};

async function extractSoapSessionId(session, theaterConfig, theaterType) {
    // Determine playback URL based on theater type
    const playbackUrl = theaterType === 'IMS3000' 
        ? '/web/index.php?page=sys_control/cinelister/playback.php'
        : '/web/sys_control/cinelister/playback.php';
    
    const pageResp = await session.request('GET', playbackUrl, null, {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    });

    const html = typeof pageResp.data === 'string' ? pageResp.data : '';
    
    // Search for UUID pattern
    const match = html.match(uuidPattern);
    
    if (match) {
        return match[1];
    }
    
    return null;
}

async function getPlaybackStatus(theaterName) {
    const theaterConfig = config.THEATERS[theaterName];
    
    if (!theaterConfig) {
        throw new Error(`Theater "${theaterName}" not found in config`);
    }

    const client = clients[theaterName];
    const session = client.session;

    try {
        // Ensure authenticated
        await client.ensureLoggedIn();

        // Try to use cached SOAP session ID first
        let soapSessionId = soapSessionCache[theaterName];
        
        // If no cache or expired, extract new one
        if (!soapSessionId) {
            soapSessionId = await extractSoapSessionId(session, theaterConfig, theaterConfig.type);
            if (soapSessionId) {
                soapSessionCache[theaterName] = soapSessionId;
            }
        }

        if (!soapSessionId) {
            throw new Error('Could not extract SOAP session ID');
        }

        // Build SOAP request
        const soapBody = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="http://www.doremilabs.com/dc/dcp/json/v1_0"><soapenv:Header/><soapenv:Body><v1:GetShowStatus><sessionId>${soapSessionId}</sessionId></v1:GetShowStatus></soapenv:Body></soapenv:Envelope>`;

        // Determine referer based on type
        const referer = theaterConfig.type === 'IMS3000'
            ? `${theaterConfig.url}/web/index.php?page=sys_control/cinelister/playback.php`
            : `${theaterConfig.url}/web/sys_control/cinelister/playback.php`;

        // Request playback status
        const response = await session.request('POST', '/dc/dcp/json/v1/ShowControl', soapBody, {
            'Content-Type': 'text/xml',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
            'Connection': 'keep-alive',
            'X-Requested-With': 'XMLHttpRequest',
            'Origin': theaterConfig.url,
            'Referer': referer
        });

        // Parse response
        if (response.status === 200 && response.data?.GetShowStatusResponse?.showStatus) {
            return response.data.GetShowStatusResponse.showStatus;
        } else if (response.data?.Fault) {
            // If we get "not authenticated", clear the cache and retry once
            if (response.data.Fault.faultstring === 'not authenticated' && soapSessionCache[theaterName]) {
                delete soapSessionCache[theaterName];
                // Recursive retry
                return await getPlaybackStatus(theaterName);
            }
            throw new Error(`SOAP Fault: ${response.data.Fault.faultstring}`);
        } else {
            throw new Error(`Unexpected response`);
        }

    } catch (error) {
        throw error;
    }
}

// API endpoint
router.get('/api/playback/:id', async (req, res) => {
    const name = resolveName(req.params.id);
    if (!name) return res.status(404).json({ error: 'Theater not found' });

    try {
        const playbackStatus = await getPlaybackStatus(name);
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
