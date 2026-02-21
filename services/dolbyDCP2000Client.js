// services/dolbyDCP2000Client.js
const cheerio = require('cheerio');

const MACRO_REGEX = /ajaxExecuteMacroQC\('([^']+)'(?:,\s*(\d+))?\)/;

class DolbyDCP2000Client {
    constructor(theaterName, sessionManager, logger) {
        this.name = theaterName;
        this.session = sessionManager;
        this.logger = logger;
        this.soapSessionId = null;
    }

    async extractSoapSessionId() {
        const playbackUrl = '/web/sys_control/cinelister/playback.php';

        const pageResp = await this.session.request('GET', playbackUrl, null, {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        });

        const html = typeof pageResp.data === 'string' ? pageResp.data : '';

        // Search for UUID pattern
        const uuidPattern = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;
        const match = html.match(uuidPattern);

        if (match) {
            return match[1];
        }

        return null;
    }

    async getPlaybackStatus(retryCount = 0) {
        try {
            // Ensure authenticated
            await this.session.ensureLoggedIn();

            // Try to use cached SOAP session ID first
            if (!this.soapSessionId) {
                this.soapSessionId = await this.extractSoapSessionId();
                if (this.soapSessionId) this.session.setSoapSessionId(this.soapSessionId);
            }

            if (!this.soapSessionId) {
                throw new Error('Could not extract SOAP session ID');
            }

            // Build SOAP request
            const soapBody = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="http://www.doremilabs.com/dc/dcp/json/v1_0"><soapenv:Header/><soapenv:Body><v1:GetShowStatus><sessionId>${this.soapSessionId}</sessionId></v1:GetShowStatus></soapenv:Body></soapenv:Envelope>`;

            // Request playback status
            const response = await this.session.request('POST', '/dc/dcp/json/v1/ShowControl', soapBody, {
                'Content-Type': 'text/xml',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
                'Connection': 'keep-alive',
                'X-Requested-With': 'XMLHttpRequest',
                'Origin': this.session.config.url,
                'Referer': `${this.session.config.url}/web/sys_control/cinelister/playback.php`
            });

            // Parse response
            if (response.status === 200 && response.data?.GetShowStatusResponse?.showStatus) {
                return response.data.GetShowStatusResponse.showStatus;
            } else if (response.data?.Fault) {
                // If we get "not authenticated", clear the cache and retry once
                if (response.data.Fault.faultstring === 'not authenticated' && this.soapSessionId && retryCount < 1) {
                    this.soapSessionId = null;
                    this.session.setSoapSessionId(null);
                    // Recursive retry
                    return await this.getPlaybackStatus(retryCount + 1);
                }
                throw new Error(`SOAP Fault: ${response.data.Fault.faultstring}`);
            } else {
                throw new Error(`Unexpected response`);
            }
        } catch (error) {
            throw error;
        }
    }

    async getSchedule() {
        try {
            await this.session.ensureLoggedIn();
            const ajaxUrl = '/web/sys_control/cinelister/ajax.php';

            // Format date as D-Month-YYYY (e.g. 16-February-2026)
            const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            const now = new Date();
            const dateStr = `${now.getDate()}-${months[now.getMonth()]}-${now.getFullYear()}`;

            const data = `request=LOAD_SCHEDULES&start_date=${dateStr}&out_dated=false`;

            const res = await this.session.request('POST', ajaxUrl, data, {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${this.session.config.url}/web/sys_control/cinelister/schedule.php`
            });

            if (res.status === 200 && typeof res.data === 'string') {
                return this.parseScheduleHTML(res.data);
            }
            return [];
        } catch (err) {
            this.logger.error(`Error fetching schedule: ${err.message}`);
            return [];
        }
    }

    parseScheduleHTML(html) {
        const $ = cheerio.load(html);
        const schedules = [];
        let currentDate = null;

        $('#scheduleSelect option').each((i, el) => {
            const $el = $(el);
            const val = $el.attr('value');
            const text = $el.text().trim();

            if (val === 'DATE') {
                const match = text.match(/\((.*?)\)/);
                if (match) {
                    const parts = match[1].split(',');
                    if (parts.length > 1) {
                        currentDate = parts[1].trim();
                    } else {
                        currentDate = match[1].trim();
                    }
                }
            } else if ($el.hasClass('schedule_time')) {
                const parts = text.split(/\s{3,}/);
                if (parts.length >= 2 && currentDate) {
                    const timeRange = parts[0].trim();
                    const title = parts[1].trim();

                    const times = timeRange.split('-');
                    if (times.length === 2) {
                        const startTime = times[0].trim();
                        const endTime = times[1].trim();

                        const start = new Date(`${currentDate} ${startTime}`);
                        const end = new Date(`${currentDate} ${endTime}`);

                        if (end < start) {
                            end.setDate(end.getDate() + 1);
                        }

                        schedules.push({
                            title,
                            start,
                            end
                        });
                    }
                }
            }
        });
        return schedules;
    }

    parseControlViewHTML(html) {
        const $ = cheerio.load(html);
        const groups = [];

        const groupSelector = 'div.controlViewButtonList.qc, div.controlViewButtonList';
        const titleSelector = '> div.controlViewTitle.qc, > div.controlViewTitle';
        const buttonSelector = 'div.controlViewButton.qc, div.controlViewButton';

        const groupElements = $(groupSelector);
        if (groupElements.length === 0) {
            this.logger.warn('No macro groups found in HTML');
            return null;
        }

        groupElements.each((gIdx, groupEl) => {
            const $group = $(groupEl);
            const titleEl = $group.find(titleSelector).first();
            const groupName = titleEl.find('span').first().text().trim() || `Groupe ${gIdx + 1}`;
            
            const buttons = $group.find(buttonSelector);
            const controls = [];
            buttons.each((bIdx, btnEl) => {
                const $btn = $(btnEl);
                const onclick = $btn.attr('onclick') || '';
                const label = $btn.find('span').first().text().trim();
                const m = onclick.match(MACRO_REGEX);
                const macroName = m ? m[1] : null;

                if (macroName && label) {
                    controls.push({
                        id: `${gIdx}-${bIdx}`,
                        name: macroName,
                        display: label,
                    });
                }
            });

            if (controls.length > 0) {
                groups.push({ group: groupName, controls });
            }
        });

        const total = groups.reduce((s, g) => s + g.controls.length, 0);
        this.logger.debug(`Parsed ${total} macros in ${groups.length} groups`);
        return groups.length ? groups : null;
    }

    async loadMacros() {
        try {
            const ajaxUrl = '/web/ajax_common.php';
            const data = 'request=GET_CONTROL_VIEW';

            await this.session.ensureLoggedIn();

            const res = await this.session.request('POST', ajaxUrl, data, {
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${this.session.config.url}/web/index.php`,
            });

            const body = typeof res.data === 'string' ? res.data : '';

            if (res.status !== 200 || !body) {
                this.logger.error('Empty or non-200 response from server for macros');
                return null;
            }

            const groups = this.parseControlViewHTML(body);
            if (!groups) {
                this.logger.warn('No macros parsed from response');
                return null;
            }

            return groups;
        } catch (err) {
            this.logger.error(`Error loading macros: ${err.message}`);
            return null;
        }
    }

    async executeMacro(macroName) {
        try {
            await this.session.ensureLoggedIn();
            const ajaxUrl = '/web/ajax_common.php';
            const data = `request=EXECUTE_MACRO&macro_name=${encodeURIComponent(macroName)}`;

            this.logger.info(`Executing macro: ${macroName}`);

            const res = await this.session.request('POST', ajaxUrl, data, {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${this.session.config.url}/web/index.php`,
            });

            const text = typeof res.data === 'string' ? res.data : '';
            const ok = res.status === 200 && text.includes('Executed');

            if (ok) {
                this.logger.info(`Macro executed: ${macroName}`);
            } else {
                this.logger.error(`Macro failed - status: ${res.status} response: ${this.logger.truncate(text, 50)}`);
            }

            return ok;
        } catch (err) {
            this.logger.error(`Error executing macro: ${err.message}`);
            return false;
        }
    }
}

module.exports = DolbyDCP2000Client;