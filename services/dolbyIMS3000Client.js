// services/dolbyIMS3000Client.js
const cheerio = require('cheerio');

const AJAX_EXECUTE_ACTION_REGEX = /ajaxExecuteAction\('([^']+)'/;
const AJAX_EXECUTE_CONTROL_REGEX = /ajaxExecuteControl\('([^']+)'/;

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
                const match = onclick.match(AJAX_EXECUTE_ACTION_REGEX);
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
                const m = onclick.match(AJAX_EXECUTE_CONTROL_REGEX);
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
}

module.exports = DolbyIMS3000Client;