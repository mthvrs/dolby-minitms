/**
 * DolbyClientUnified - Unified interface for both IMS3000 and DCP2000
 * Abstracts away the differences between server types
 */

const DolbySessionManager = require('./dolbySessionManager');
const DolbyIMS3000Client = require('./dolbyIMS3000Client');
const DolbyDCP2000Client = require('./dolbyDCP2000Client');
const Logger = require('./logger');

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
        const success = await this.sessionManager.login();
        if (success) {
            // Attempt to pre-fetch SOAP session ID to ensure consistent session usage
            try {
                if (this.client.extractSoapSessionId) {
                    const id = await this.client.extractSoapSessionId();
                    if (id) {
                        this.client.soapSessionId = id;
                        this.sessionManager.setSoapSessionId(id);
                    }
                }
            } catch (e) {
                this.logger.warn(`Failed to pre-fetch SOAP session ID: ${e.message}`);
            }
        }
        return success;
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

    async getPlaybackStatus() {
        return await this.client.getPlaybackStatus();
    }

    async destroy() {
        await this.sessionManager.destroy();
    }
}

module.exports = DolbyClientUnified;
