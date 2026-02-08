// services/dolbyIMS3000Client.js
const cheerio = require('cheerio');

class DolbyIMS3000Client {
    constructor(theaterName, sessionManager, logger) {
        this.name = theaterName;
        this.session = sessionManager;
        this.logger = logger;
    }

    parseQuickControlHTML(html) {
        const $ = cheerio.load(html);
        const groups = [];
        const rows = $('div.row.mb-3');
        if (rows.length === 0) return null;

        rows.each((rowIdx, rowEl) => {
            const row = $(rowEl);
            const groupName = row.find('div.col-12.h6.mb-1').first().text().trim();
            if (!groupName) return;

            const controls = [];
            row.find('div.col-4[onclick^="ajaxExecuteAction"]').each((btnIdx, colEl) => {
                const col = $(colEl);
                const onclick = col.attr('onclick') || '';
                const match = onclick.match(/ajaxExecuteAction\('([^']+)'/);
                const macroName = match ? match[1] : null;
                const label = col.find('button').first().text().trim();

                if (macroName && label) {
                    controls.push({
                        id: `${rowIdx}-${btnIdx}`,
                        name: macroName,
                        display: label,
                    });
                }
            });

            if (controls.length) {
                groups.push({ group: groupName, controls });
            }
        });

        return groups.length ? groups : null;
    }

    parseControlViewHTML(html) {
        const $ = cheerio.load(html);
        const groups = [];
        const groupSelector = 'div.controlViewButtonList.qc, div.controlViewButtonList';
        const titleSelector = 'div.controlViewTitle.qc, div.controlViewTitle';
        const buttonSelector = 'div.controlViewButton.qc, div.controlViewButton';

        const containers = $(groupSelector);
        if (containers.length === 0) return null;

        containers.each((gIdx, groupEl) => {
            const group = $(groupEl);
            const groupName = group.find(titleSelector).first().find('span').first().text().trim() || `Groupe ${gIdx + 1}`;
            const controls = [];
            group.find(buttonSelector).each((bIdx, btnEl) => {
                const btn = $(btnEl);
                const onclick = btn.attr('onclick') || '';
                const m = onclick.match(/ajaxExecuteControl\('([^']+)'/);
                const name = m ? m[1] : null;
                const label = btn.find('span').first().text().trim();

                if (name && label) {
                    controls.push({
                        id: `${gIdx}-${bIdx}`,
                        name,
                        display: label,
                    });
                }
            });

            if (controls.length) {
                groups.push({ group: groupName, controls });
            }
        });

        return groups.length ? groups : null;
    }

    async loadMacros() {
        try {
            await this.session.ensureLoggedIn();

            // Primary IMS3000 path
            const quickControlUrl = '/web/tooltip/quickControl.php';
            const qc = await this.session.request('GET', quickControlUrl, null, {
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${this.session.config.url}/web/index.php`,
            });

            if (qc.status === 200 && typeof qc.data === 'string') {
                const groups = this.parseQuickControlHTML(qc.data);
                if (groups && groups.length) return groups;
            }

            // Fallback path
            const ajaxUrl = '/web/js/ajax_common.php';
            const data = 'request=GET_CONTROL_VIEW'; 
            const res = await this.session.request('POST', ajaxUrl, data, {
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${this.session.config.url}/web/index.php`,
                'Content-Type': 'application/x-www-form-urlencoded',
            });

            if (res.status === 200 && typeof res.data === 'string') {
                const groups = this.parseControlViewHTML(res.data);
                if (groups && groups.length) return groups;
            }

            return null;
        } catch (error) {
            this.logger.error(`loadMacros error: ${error.message}`);
            return null;
        }
    }

    async executeMacro(macroName) {
        try {
            await this.session.ensureLoggedIn();
            
            const ajaxUrl = '/web/js/ajax_common.php';
            const data = `request=EXECUTE_MACRO&macro_name=${encodeURIComponent(macroName)}`;

            this.logger.info(`Executing macro: ${macroName}`);

            const res = await this.session.request('POST', ajaxUrl, data, {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${this.session.config.url}/web/index.php`,
                'Origin': this.session.config.url
            });

            const text = typeof res.data === 'string' ? res.data : '';
            const ok = res.status === 200; 

            if (ok) {
                this.logger.info(`Macro executed: ${macroName}`);
            } else {
                this.logger.error(`Macro failed - status: ${res.status}, response: ${this.logger.truncate(text, 50)}`);
            }

            return ok;
        } catch (err) {
            this.logger.error(`Error executing macro: ${err.message}`);
            return false;
        }
    }

    safeJSONParse(str) {
        if (typeof str !== 'string') return str;
        try {
            return JSON.parse(str);
        } catch (e) {
            if (str.charCodeAt(0) === 0xFEFF) str = str.slice(1);
            str = str.trim();
            try { return JSON.parse(str); } catch (e2) { return null; }
        }
    }

    async getPlaybackStatus() {
        const logPrefix = `[IMS3000][${this.name}]`;
        try {
            await this.session.ensureLoggedIn();
            
            const uuid = this.session.generateUUID();
            // Switched to ShowControl per your curl findings
            const endpoint = '/dc/dcp/json/v1/ShowControl';
            
            const soapBody = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="http://www.doremilabs.com/dc/dcp/json/v1_0"><soapenv:Header/><soapenv:Body><v1:GetShowStatus><sessionId>${uuid}</sessionId></v1:GetShowStatus></soapenv:Body></soapenv:Envelope>`;

            const headers = {
                'Content-Type': 'text/xml',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
                'X-Requested-With': 'XMLHttpRequest',
                'Origin': this.session.config.url,
                'Referer': `${this.session.config.url}/web/sys_control/cinelister/playback.php`
            };

            const res = await this.session.request('POST', endpoint, soapBody, headers);
            let json = res.data;

            if (typeof json === 'string') {
                json = this.safeJSONParse(json);
            }

            if (res.status === 200 && json && json.GetShowStatusResponse && json.GetShowStatusResponse.showStatus) {
                const s = json.GetShowStatusResponse.showStatus;
                
                const duration = parseInt(s.splDuration || 0, 10);
                const position = parseInt(s.splPosition || 0, 10);
                const percent = duration > 0 ? (position / duration) * 100 : 0;
                const isPlaying = s.stateInfo === 'Play';

                return {
                    playing: isPlaying,
                    state: s.stateInfo || 'Stopped', 
                    splTitle: s.splTitle || 'No Show',
                    cplTitle: s.cplTitle || '',
                    duration: duration,
                    position: position,
                    percent: Math.min(100, Math.max(0, percent))
                };
            }

            return { playing: false, state: 'Stopped', splTitle: '', percent: 0, position: 0, duration: 0 };
        } catch (err) {
            this.logger.error(`${logPrefix} EXCEPTION: ${err.message}`);
            return null; 
        }
    }
}

module.exports = DolbyIMS3000Client;