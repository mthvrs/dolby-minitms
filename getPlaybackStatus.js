/**
 * getPlaybackStatus.js
 * Retrieves current playback status from Dolby DCP2000 server
 * No hardcoded IDs - fully dynamic authentication and session management
 */

const DolbySessionManager = require('./services/dolbySessionManager');
const config = require('./config');

const logger = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
    debug: (msg) => console.log(`[DEBUG] ${msg}`),
    truncate: (str, len) => str.length > len ? str.substring(0, len) + '...' : str
};

/**
 * Extracts the SOAP session ID from the playback page HTML
 * The session ID is embedded in the page by the server and persists across requests
 */
async function extractSoapSessionId(session, theaterConfig) {
    const pageResp = await session.request('GET', '/web/sys_control/cinelister/playback.php', null, {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    });

    const html = typeof pageResp.data === 'string' ? pageResp.data : '';
    
    // Search for UUID pattern (SOAP session IDs are standard UUIDs)
    const uuidPattern = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;
    const match = html.match(uuidPattern);
    
    if (match) {
        return match[1];
    }
    
    throw new Error('Could not extract SOAP session ID from playback page');
}

/**
 * Gets current playback status from the Dolby DCP2000 server
 */
async function getPlaybackStatus(theaterName) {
    const theaterConfig = config.THEATERS[theaterName];
    
    if (!theaterConfig) {
        throw new Error(`Theater "${theaterName}" not found in config`);
    }

    const session = new DolbySessionManager(theaterName, theaterConfig, logger);

    try {
        // Step 1: Authenticate with web interface (gets PHPSESSID cookie)
        const loggedIn = await session.ensureLoggedIn();
        if (!loggedIn) {
            throw new Error('Authentication failed');
        }

        // Step 2: Extract SOAP session ID from playback page
        const soapSessionId = await extractSoapSessionId(session, theaterConfig);

        // Step 3: Build SOAP request
        const soapBody = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="http://www.doremilabs.com/dc/dcp/json/v1_0"><soapenv:Header/><soapenv:Body><v1:GetShowStatus><sessionId>${soapSessionId}</sessionId></v1:GetShowStatus></soapenv:Body></soapenv:Envelope>`;

        // Step 4: Request playback status
        const response = await session.request('POST', '/dc/dcp/json/v1/ShowControl', soapBody, {
            'Content-Type': 'text/xml',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
            'Connection': 'keep-alive',
            'X-Requested-With': 'XMLHttpRequest',
            'Origin': theaterConfig.url,
            'Referer': `${theaterConfig.url}/web/sys_control/cinelister/playback.php`
        });

        // Cleanup
        await session.destroy();
        
        // Parse response
        if (response.status === 200 && response.data?.GetShowStatusResponse?.showStatus) {
            return response.data.GetShowStatusResponse.showStatus;
        } else if (response.data?.Fault) {
            throw new Error(`SOAP Fault: ${response.data.Fault.faultstring}`);
        } else {
            throw new Error(`Unexpected response: ${JSON.stringify(response.data)}`);
        }

    } catch (error) {
        await session.destroy();
        throw error;
    }
}

// Main execution
if (require.main === module) {
    (async () => {
        try {
            const playbackInfo = await getPlaybackStatus('Salle 2');
            
            console.log('\n=== PLAYBACK STATUS ===');
            console.log(JSON.stringify(playbackInfo, null, 2));
            
            if (playbackInfo.stateInfo) {
                console.log('\n=== SUMMARY ===');
                console.log(`State: ${playbackInfo.stateInfo}`);
                console.log(`Show: ${playbackInfo.splTitle}`);
                console.log(`Position: ${playbackInfo.splPosition}s / ${playbackInfo.splDuration}s`);
                console.log(`Element: ${playbackInfo.elementPosition}s / ${playbackInfo.elementDuration}s`);
                console.log(`CPL: ${playbackInfo.cplTitle}`);
            }
            
        } catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    })();
}

// Export for use as module
module.exports = { getPlaybackStatus };
