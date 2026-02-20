// services/dolbyDCP2000Client.js
const cheerio = require('cheerio');

const MACRO_REGEX = /ajaxExecuteMacroQC\('([^']+)'(?:,\s*(\d+))?\)/;

class DolbyDCP2000Client {
    constructor(theaterName, sessionManager, logger) {
        this.name = theaterName;
        this.session = sessionManager;
        this.logger = logger;
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