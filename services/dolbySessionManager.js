const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');

const COOKIE_REGEX = /([^=]+)=([^;]*)/;

class DolbySessionManager {
  constructor(theaterName, theaterConfig, logger) {
    this.name = theaterName;
    this.config = theaterConfig; // { url, username, password, type }
    this.logger = logger;
    this.isLoggedIn = false;
    this.sessionId = null; // Stores PHPSESSID
    this.cookies = {}; // Manual cookie storage
    this.checkInterval = null; // For keep-alive polling
    this.detectedType = null; // Stores 'IMS3000' or 'DCP2000' after successful login

    this.session = axios.create({
      baseURL: theaterConfig.url,
      timeout: config.TIMEOUTS.http,
      withCredentials: false,
      maxRedirects: 0, // We handle redirects manually to capture cookies at each step
      validateStatus: () => true,
    });

    this.logger.debug(`Session manager initialized for type=${this.config.type}`);
  }

  parseCookies(setCookieHeader) {
    if (!setCookieHeader) return;
    const cookieArray = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const cookieStr of cookieArray) {
      const match = cookieStr.match(COOKIE_REGEX);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        this.cookies[key] = value;
        if (key === 'PHPSESSID') this.sessionId = value;
        this.logger.debug(`Cookie updated: ${key}=${this.logger.truncate(value, 10)}...`);
      }
    }
  }

  getCookieHeader() {
    const cookieStrings = Object.entries(this.cookies).map(([key, value]) => `${key}=${value}`);
    return cookieStrings.join('; ');
  }

  isLoginPage(html) {
    if (!html || typeof html !== 'string') return false;
    if (html.includes('attr-page="login"')) return true;
    if (html.includes('name="loginForm"')) return true;
    if (html.toLowerCase().includes('authentication failure')) return true;
    if (html.includes("window.location.href = '/web/login.php'")) return true;
    return false;
  }

  generateUUID() {
    return crypto.randomUUID();
  }

  async checkSystemStatus() {
    if (!this.sessionId) return false;

    // A simple probe to check if session is valid. 
    // Using SystemOverview here as it is lightweight compared to ShowControl
    const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="http://www.doremilabs.com/dc/dcp/json/v1_0">
          <soapenv:Header/>
          <soapenv:Body>
              <v1:GetSystemStatus>
                  <sessionId>${this.generateUUID()}</sessionId>
              </v1:GetSystemStatus>
          </soapenv:Body>
      </soapenv:Envelope>`;

    try {
      // Use the raw session request to avoid recursive loop with ensureLoggedIn
      const res = await this.session.post('/dc/dcp/json/v1/SystemOverview', soapBody, {
        headers: {
          'Content-Type': 'text/xml',
          'Accept': '*/*',
          'X-Requested-With': 'XMLHttpRequest',
          'Cookie': this.getCookieHeader(),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
        }
      });

      this.parseCookies(res.headers['set-cookie']);

      if (res.status === 200 && res.data && res.data.GetSystemStatusResponse) {
        return true;
      }
      
      this.logger.debug(`System status check returned ${res.status} (Session likely invalid)`);
      return false;
    } catch (err) {
      this.logger.warn(`System status check error: ${err.message}`);
      return false;
    }
  }

  startPolling() {
    this.stopPolling();
    this.logger.info('Starting keep-alive polling');
    this.checkInterval = setInterval(() => this.performHealthCheck(), 30000);
  }

  stopPolling() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  async performHealthCheck() {
    if (!this.isLoggedIn) return;
    const alive = await this.checkSystemStatus();
    if (!alive) {
      this.logger.warn('Health check failed. Auto-reconnecting...');
      this.isLoggedIn = false;
      await this.login();
    }
  }

  async logout() {
    if (!this.sessionId) return;
    const type = (this.detectedType || this.config.type || '').toUpperCase();
    let logoutUrl = '/web/logout/';
    if (type === 'DCP2000') logoutUrl = '/web/logout/index.php';

    try {
      await this.session.get(logoutUrl, {
        headers: {
          'Cookie': this.getCookieHeader(),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
        }
      });
    } catch (err) {
      // ignore logout errors
    } finally {
      this.sessionId = null;
      this.cookies = {};
      this.isLoggedIn = false;
      this.detectedType = null;
    }
  }

  async attemptIMS3000Login() {
    const loginUrl = '/web/login.php';
    const formData =
      `username=${encodeURIComponent(this.config.username)}` +
      `&password=${encodeURIComponent(this.config.password)}` +
      `&from=&screen=false`;

    this.logger.debug('IMS3000 login attempt...');

    const res = await this.session.post(loginUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': this.config.url,
        'Referer': `${this.config.url}/web/login.php`,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      },
    });

    this.parseCookies(res.headers['set-cookie']);
    const body = typeof res.data === 'string' ? res.data : '';

    // Check for Redirect (Success case)
    if ((res.status === 302 || res.status === 301) && (res.headers.location || '').includes('index.php')) {
      this.logger.info('IMS3000 login credentials accepted (Redirect)');
      
      // CRITICAL: FOLLOW THE REDIRECT TO FIXATE SESSION
      try {
          const redirectUrl = res.headers.location;
          this.logger.debug(`Following login redirect to: ${redirectUrl}`);
          const followRes = await this.session.get(redirectUrl, {
              headers: {
                  'Cookie': this.getCookieHeader(),
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
              }
          });
          this.parseCookies(followRes.headers['set-cookie']);
      } catch (e) {
          this.logger.warn(`Failed to follow redirect: ${e.message}`);
      }

      this.detectedType = 'IMS3000';
      return true;
    }

    if (res.status === 200 && this.isLoginPage(body)) {
      this.logger.warn('IMS3000 login rejected (returned login page)');
      return false;
    }

    // Fallback: direct index probe
    if (res.status === 200) {
      const probe = await this.session.get('/web/index.php', {
        headers: { Cookie: this.getCookieHeader() },
      });
      this.parseCookies(probe.headers['set-cookie']);
      if (probe.status === 200 && !this.isLoginPage(typeof probe.data === 'string' ? probe.data : '')) {
        this.logger.info('IMS3000 login confirmed (Index probe)');
        this.detectedType = 'IMS3000';
        return true;
      }
    }

    return false;
  }

  async attemptDCP2000Login() {
    const loginUrl = '/web/index.php';
    const formData =
      `username=${encodeURIComponent(this.config.username)}` +
      `&password=${encodeURIComponent(this.config.password)}` +
      `&screen=auto`;

    this.logger.debug('DCP2000 login attempt...');

    const res = await this.session.post(loginUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': this.config.url,
        'Referer': `${this.config.url}/web/index.php`,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      },
    });

    this.parseCookies(res.headers['set-cookie']);
    const body = typeof res.data === 'string' ? res.data : '';

    if ((res.status === 302 || res.status === 301) && !String(res.headers.location || '').includes('login')) {
      this.logger.info('DCP2000 login credentials accepted (Redirect)');
      
      // CRITICAL: FOLLOW THE REDIRECT TO FIXATE SESSION
      try {
          const redirectUrl = res.headers.location;
          this.logger.debug(`Following login redirect to: ${redirectUrl}`);
          const followRes = await this.session.get(redirectUrl, {
              headers: {
                  'Cookie': this.getCookieHeader(),
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
              }
          });
          this.parseCookies(followRes.headers['set-cookie']);
      } catch (e) {
          this.logger.warn(`Failed to follow redirect: ${e.message}`);
      }
      
      this.detectedType = 'DCP2000';
      return true;
    }

    if (res.status === 200 && !this.isLoginPage(body)) {
      this.logger.info('DCP2000 login success (Index content)');
      this.detectedType = 'DCP2000';
      return true;
    }

    return false;
  }

  async login() {
    if (this.sessionId) await this.logout();
    this.stopPolling();

    try {
      const type = (this.config.type || '').toUpperCase();
      let ok = false;

      // Try explicit type first, then fallback
      if (type === 'IMS3000') {
        ok = await this.attemptIMS3000Login();
        if (!ok) ok = await this.attemptDCP2000Login();
      } else {
        ok = await this.attemptDCP2000Login();
        if (!ok) ok = await this.attemptIMS3000Login();
      }

      this.isLoggedIn = !!ok;
      if (ok) {
        this.logger.info('Authentication established');
        this.startPolling();
      } else {
        this.logger.error('Authentication failed');
      }
      return ok;
    } catch (err) {
      this.logger.error(`Login exception: ${err.message}`);
      return false;
    }
  }

  async ensureLoggedIn() {
    if (this.isLoggedIn && this.sessionId) return true;
    return this.login();
  }

  async checkConnection() {
      // Simple probe
      try {
          const response = await this.session.get('/web/index.php', { timeout: config.TIMEOUTS.http });
          return [200, 301, 302].includes(response.status);
      } catch(e) { return false; }
  }

  async request(method, url, data = null, headers = {}) {
    await this.ensureLoggedIn();

    const defaultHeaders = {
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      ...headers,
    };

    const cookieHeader = this.getCookieHeader();
    if (cookieHeader) defaultHeaders['Cookie'] = cookieHeader;
    if (data && !defaultHeaders['Content-Type']) {
      defaultHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    try {
      const requestConfig = { method, url, headers: defaultHeaders, timeout: config.TIMEOUTS.http };
      if (data) requestConfig.data = data;

      const response = await this.session(requestConfig);
      this.parseCookies(response.headers['set-cookie']);

      const body = typeof response.data === 'string' ? response.data : '';
      if (response.status === 200 && this.isLoginPage(body)) {
        this.isLoggedIn = false;
        this.logger.warn('Session invalidated (Login page detected). Next request will re-login.');
      }

      return response;
    } catch (error) {
      this.logger.error(`Request failed [${method} ${url}]: ${error.message}`);
      throw error;
    }
  }

  async destroy() {
    this.stopPolling();
    await this.logout();
  }
}

module.exports = DolbySessionManager;