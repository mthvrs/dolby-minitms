/**
 * DolbyClientUnified - Unified interface for both IMS3000 and DCP2000
 * Abstracts away the differences between server types
 */

const DolbySessionManager = require('./dolbySessionManager');
const DolbyIMS3000Client = require('./dolbyIMS3000Client');
const DolbyDCP2000Client = require('./dolbyDCP2000Client');
const Logger = require('./logger');

// Constant regex pattern for UUID extraction (Moved here for optimization)
const uuidPattern = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;

// Cache for SOAP session IDs (keyed by theater name)
const soapSessionCache = {};

class DolbyClientUnified {
    constructor(theaterName, theaterConfig) {
        this.name = theaterName;
        this.config = theaterConfig;
        this.logger = new Logger(theaterName);
        this.sessionManager = new DolbySessionManager(theaterName, theaterConfig, this.logger);

        // Expose session for playback API
        this.session = this.sessionManager;

        if (theaterConfig.type === 'IMS3000') {
            this.client = new DolbyIMS3000Client(theaterName, this.sessionManager, this.logger);
        } else {
            this.client = new DolbyDCP2000Client(theaterName, this.sessionManager, this.logger);
        }
    }

    async login() {
        return await this.sessionManager.login();
    }

    async ensureLoggedIn() {
        return await this.sessionManager.ensureLoggedIn();
    }

    async checkConnection() {
        return await this.sessionManager.checkConnection();
    }

    async loadMacros() {
        return await this.client.loadMacros();
    }

    async executeMacro(macroName) {
        return await this.client.executeMacro(macroName);
    }

    async destroy() {
        await this.sessionManager.destroy();
    }

    async extractSoapSessionId() {
        // Determine playback URL based on theater type
        const playbackUrl = this.config.type === 'IMS3000'
            ? '/web/index.php?page=sys_control/cinelister/playback.php'
            : '/web/sys_control/cinelister/playback.php';

        const pageResp = await this.session.request('GET', playbackUrl, null, {
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

    async getPlaybackStatus() {
        try {
            // Ensure authenticated
            await this.ensureLoggedIn();

            // Try to use cached SOAP session ID first
            let soapSessionId = soapSessionCache[this.name];

            // If no cache or expired, extract new one
            if (!soapSessionId) {
                soapSessionId = await this.extractSoapSessionId();
                if (soapSessionId) {
                    soapSessionCache[this.name] = soapSessionId;
                }
            }

            if (!soapSessionId) {
                throw new Error('Could not extract SOAP session ID');
            }

            // Build SOAP request
            const soapBody = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="http://www.doremilabs.com/dc/dcp/json/v1_0"><soapenv:Header/><soapenv:Body><v1:GetShowStatus><sessionId>${soapSessionId}</sessionId></v1:GetShowStatus></soapenv:Body></soapenv:Envelope>`;

            // Determine referer based on type
            const referer = this.config.type === 'IMS3000'
                ? `${this.config.url}/web/index.php?page=sys_control/cinelister/playback.php`
                : `${this.config.url}/web/sys_control/cinelister/playback.php`;

            // Request playback status
            const response = await this.session.request('POST', '/dc/dcp/json/v1/ShowControl', soapBody, {
                'Content-Type': 'text/xml',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
                'Connection': 'keep-alive',
                'X-Requested-With': 'XMLHttpRequest',
                'Origin': this.config.url,
                'Referer': referer
            });

            // Parse response
            if (response.status === 200 && response.data?.GetShowStatusResponse?.showStatus) {
                return response.data.GetShowStatusResponse.showStatus;
            } else if (response.data?.Fault) {
                // If we get "not authenticated", clear the cache and retry once
                if (response.data.Fault.faultstring === 'not authenticated' && soapSessionCache[this.name]) {
                    delete soapSessionCache[this.name];
                    // Recursive retry
                    return await this.getPlaybackStatus();
                }
                throw new Error(`SOAP Fault: ${response.data.Fault.faultstring}`);
            } else {
                throw new Error(`Unexpected response`);
            }

        } catch (error) {
            throw error;
        }
    }
}

module.exports = DolbyClientUnified;
