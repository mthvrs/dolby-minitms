/**
 * debug_dolby.js
 * Run this to capture raw server responses and debug playback status issues.
 */

const DolbySessionManager = require('./services/dolbySessionManager');
const Logger = require('./services/logger');
const config = require('./config');

// --- CONFIGURATION ---
// automatically pick the first theater from your config
const theaterNames = Object.keys(config.THEATERS);
if (theaterNames.length === 0) {
    console.error("No theaters found in config.js");
    process.exit(1);
}
const THEATER_NAME = theaterNames[0]; // Or replace with specific name like 'Salle 1'
const THEATER_CONFIG = config.THEATERS[THEATER_NAME];

console.log(`\n=== STARTING DEBUG FOR: ${THEATER_NAME} (${THEATER_CONFIG.url}) ===\n`);

// Mock logger to print to console
const logger = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    warn: (msg) => console.log(`[WARN] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
    debug: (msg) => console.log(`[DEBUG] ${msg}`),
    truncate: (str, len) => str.length > len ? str.substring(0, len) + '...' : str
};

async function runDebug() {
    const session = new DolbySessionManager(THEATER_NAME, THEATER_CONFIG, logger);

    try {
        console.log('1. Attempting Login...');
        const loggedIn = await session.ensureLoggedIn();
        if (!loggedIn) {
            console.error("!!! Login Failed. Cannot proceed.");
            return;
        }
        console.log('   Login Successful.\n');

        const uuid = session.generateUUID();
        
        // --- TEST 1: GetSystemOverview (The one that worked in your first curl) ---
        await testEndpoint(session, 'GetSystemOverview', '/dc/dcp/json/v1/SystemOverview', 
            `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="http://www.doremilabs.com/dc/dcp/json/v1_0"><soapenv:Header/><soapenv:Body><v1:GetSystemOverview><sessionId>${uuid}</sessionId></v1:GetSystemOverview></soapenv:Body></soapenv:Envelope>`,
            `${THEATER_CONFIG.url}/web/index.php`
        );

        // --- TEST 2: GetShowStatus (The one from your second curl) ---
        await testEndpoint(session, 'GetShowStatus', '/dc/dcp/json/v1/ShowControl', 
            `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="http://www.doremilabs.com/dc/dcp/json/v1_0"><soapenv:Header/><soapenv:Body><v1:GetShowStatus><sessionId>${uuid}</sessionId></v1:GetShowStatus></soapenv:Body></soapenv:Envelope>`,
            `${THEATER_CONFIG.url}/web/sys_control/cinelister/playback.php`
        );

    } catch (err) {
        console.error("!!! Global Debug Error:", err.message);
        if (err.response) {
            console.error("    Status:", err.response.status);
            console.error("    Data:", err.response.data);
        }
    }
}

async function testEndpoint(session, label, endpoint, soapBody, referer) {
    console.log(`--- TESTING ENDPOINT: ${label} ---`);
    console.log(`Target URL: ${THEATER_CONFIG.url}${endpoint}`);
    
    const headers = {
        'Content-Type': 'text/xml',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': THEATER_CONFIG.url,
        'Referer': referer
    };

    try {
        const res = await session.request('POST', endpoint, soapBody, headers);
        
        console.log(`HTTP Status: ${res.status}`);
        console.log(`Response Type (typeof): ${typeof res.data}`);
        
        let rawData = res.data;
        if (typeof rawData === 'object') {
            console.log(`[NOTE] Axios automatically parsed JSON.`);
            rawData = JSON.stringify(rawData, null, 2);
        }
        
        console.log(`\nRAW RESPONSE START:\n${rawData}\nRAW RESPONSE END\n`);

        // Attempt manual parsing logic if it was a string
        if (typeof res.data === 'string') {
            try {
                // Check for BOM
                if (res.data.charCodeAt(0) === 0xFEFF) {
                    console.log("[ALERT] BOM (Byte Order Mark) detected at start of string.");
                } else {
                    console.log("[OK] No BOM detected.");
                }

                const parsed = JSON.parse(res.data.trim());
                console.log("JSON Parse Check: SUCCESS");
                inspectData(label, parsed);
            } catch (e) {
                console.error("JSON Parse Check: FAILED", e.message);
            }
        } else {
            inspectData(label, res.data);
        }

    } catch (error) {
        console.error(`Request Failed for ${label}:`, error.message);
        if (error.response) {
            console.log("Error Response Data:", error.response.data);
        }
    }
    console.log('-----------------------------------\n');
}

function inspectData(label, json) {
    if (label === 'GetSystemOverview') {
        const path = json?.GetSystemOverviewResponse?.playback;
        if (path) {
            console.log(">>> FOUND DATA at: json.GetSystemOverviewResponse.playback");
            console.log("    State:", path.stateInfo);
            console.log("    Title:", path.splTitle);
        } else {
            console.log(">>> DATA MISSING at expected path.");
            console.log("    Available Keys:", Object.keys(json || {}));
        }
    } else if (label === 'GetShowStatus') {
        const path = json?.GetShowStatusResponse?.showStatus;
        if (path) {
            console.log(">>> FOUND DATA at: json.GetShowStatusResponse.showStatus");
            console.log("    State:", path.stateInfo);
            console.log("    Title:", path.splTitle);
        } else {
            console.log(">>> DATA MISSING at expected path.");
            console.log("    Available Keys:", Object.keys(json || {}));
        }
    }
}

runDebug();