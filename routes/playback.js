const express = require('express');
const router = express.Router();
const { resolveName, clients } = require('./theaters');
const config = require('../config');

const logger = {
    info: (msg) => console.log(`[Playback API] ${msg}`),
    warn: (msg) => console.warn(`[Playback API] ${msg}`),
    error: (msg) => console.error(`[Playback API] ${msg}`),
    debug: (msg) => console.log(`[Playback API] ${msg}`),
    truncate: (str, len) => str.length > len ? str.substring(0, len) + '...' : str
};

// Cache for SOAP session IDs (keyed by theater name)
const soapSessionCache = {};

async function extractSoapSessionId(session, theaterConfig, theaterType) {
    const playbackUrl = theaterType === 'IMS3000'
        ? '/web/index.php?page=sys_control/cinelister/playback.php'
        : '/web/sys_control/cinelister/playback.php';

    const pageResp = await session.request('GET', playbackUrl, null, {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    });

    const html = typeof pageResp.data === 'string' ? pageResp.data : '';
    const uuidPattern = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;
    const match = html.match(uuidPattern);
    return match ? match[1] : null;
}

async function getPlaybackStatus(theaterName, retry = false) {
    const theaterConfig = config.THEATERS[theaterName];
    if (!theaterConfig) throw new Error(`Theater "${theaterName}" not found in config`);

    const client = clients[theaterName];
    const session = client.session;

    await client.ensureLoggedIn();

    let soapSessionId = soapSessionCache[theaterName];
    if (!soapSessionId) {
        soapSessionId = await extractSoapSessionId(session, theaterConfig, theaterConfig.type);
        if (soapSessionId) soapSessionCache[theaterName] = soapSessionId;
    }

    if (!soapSessionId) throw new Error('Could not extract SOAP session ID');

    const soapBody = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="http://www.doremilabs.com/dc/dcp/json/v1_0"><soapenv:Header/><soapenv:Body><v1:GetShowStatus><sessionId>${soapSessionId}</sessionId></v1:GetShowStatus></soapenv:Body></soapenv:Envelope>`;

    const referer = theaterConfig.type === 'IMS3000'
        ? `${theaterConfig.url}/web/index.php?page=sys_control/cinelister/playback.php`
        : `${theaterConfig.url}/web/sys_control/cinelister/playback.php`;

    const response = await session.request('POST', '/dc/dcp/json/v1/ShowControl', soapBody, {
        'Content-Type': 'text/xml',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
        'Connection': 'keep-alive',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': theaterConfig.url,
        'Referer': referer
    });

    if (response.status === 200 && response.data?.GetShowStatusResponse?.showStatus) {
        const status = response.data.GetShowStatusResponse.showStatus;

        // ── Enrich with next scheduled show when stopped ────────────────────────
        const state = status.stateInfo;
        if (state !== 'Play' && state !== 'Pause') {
            try {
                const { schedule } = await client.getSchedule();
                if (Array.isArray(schedule) && schedule.length > 0) {
                    const now          = new Date();
                    const fiveHoursMs  = 5 * 60 * 60 * 1000;
                    const cutoff       = new Date(now.getTime() + fiveHoursMs);

                    const next = schedule
                        .filter(s => s.start instanceof Date && !isNaN(s.start) &&
                                     s.start > now && s.start <= cutoff)
                        .sort((a, b) => a.start - b.start)[0];

                    if (next) {
                        status.nextShow = {
                            title:        next.title,
                            start:        next.start.toISOString(),
                            secondsUntil: Math.round((next.start - now) / 1000)
                        };
                    }
                }
            } catch (err) {
                // Best-effort — never let schedule fetch crash playback polling
                logger.warn(`[${theaterName}] nextShow enrichment failed: ${err.message}`);
            }
        }

        return status;

    } else if (response.data?.Fault) {
        if (response.data.Fault.faultstring === 'not authenticated' && soapSessionCache[theaterName] && !retry) {
            delete soapSessionCache[theaterName];
            return await getPlaybackStatus(theaterName, true);
        }
        throw new Error(`SOAP Fault: ${response.data.Fault.faultstring}`);
    } else {
        throw new Error('Unexpected response');
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
