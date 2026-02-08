const axios = require('axios');
const config = require('../config');

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
      const match = cookieStr.match(/([^=]+)=([^;]*)/);
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
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0,
        v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Uses the SystemOverview endpoint to check if the session is truly alive
  async checkSystemStatus() {
    if (!this.sessionId) return false;

    // Use the session ID in the XML if possible, though random UUID usually works for the request ID
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
      // Use the raw session to avoid recursive ensureLoggedIn calls
      const res = await this.session.post('/dc/dcp/json/v1/SystemOverview', soapBody, {
        headers: {
          'Content-Type': 'text/xml',
          'Accept': '*/*',
          'X-Requested-With': 'XMLHttpRequest',
          'Cookie': this.getCookieHeader(),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
        }
      });

      // Update cookies if they rotated
      this.parseCookies(res.headers['set-cookie']);

      // Check if response is 200 and looks like valid JSON status
      if (res.status === 200 && res.data && res.data.GetSystemStatusResponse) {
        return true;
      }
      
      this.logger.debug(`System status check returned ${res.status} (likely session invalid). Response: ${typeof res.data === 'string' ? this.logger.truncate(res.data, 50) : 'JSON'}`);
      return false;
    } catch (err) {
      this.logger.warn(`System status check error: ${err.message}`);
      return false;
    }
  }

  startPolling() {
    this.stopPolling();
    this.logger.info('Starting keep-alive polling');
    // Poll every 30 seconds
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
      this.logger.warn('Health check failed (Session lost). Attempting auto-reconnect...');
      this.isLoggedIn = false;
      await this.login();
    } else {
        // this.logger.debug('Health check passed');
    }
  }

  async logout() {
    if (!this.sessionId) return;

    const type = (this.detectedType || this.config.type || '').toUpperCase();
    let logoutUrl = '/web/logout/'; // Default IMS3000
    let referer = `${this.config.url}/web/index.php`;

    if (type === 'DCP2000') {
      logoutUrl = '/web/logout/index.php';
      referer = `${this.config.url}/web/overview/`;
    } else if (type === 'IMS3000') {
      logoutUrl = '/web/logout/';
      referer = `${this.config.url}/web/index.php`;
    }

    this.logger.info(`Logging out previous session (Type: ${type || 'Unknown'})...`);

    try {
      await this.session.get(logoutUrl, {
        headers: {
          'Cookie': this.getCookieHeader(),
          'Referer': referer,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Upgrade-Insecure-Requests': '1',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
        }
      });
      this.logger.debug('Logout request completed');
    } catch (err) {
      this.logger.warn(`Logout request failed (network or already expired): ${err.message}`);
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

    if ((res.status === 302 || res.status === 301) && (res.headers.location || '').includes('index.php')) {
      this.logger.info('IMS3000 login credentials accepted (Redirect)');
      
      // CRITICAL: Follow the redirect to finalize session (Session Fixation/Rotation)
      try {
          const redirectUrl = res.headers.location;
          // Handle relative redirect if necessary (though axios baseURL usually handles it if it's just a path)
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
          this.logger.warn(`Failed to follow redirect, continuing anyway: ${e.message}`);
      }

      this.detectedType = 'IMS3000';
      return true;
    }

    if (res.status === 200 && this.isLoginPage(body)) {
      this.logger.warn('IMS3000 login rejected (Login page returned)');
      return false;
    }

    if (res.status === 200) {
      // Fallback: Try hitting index.php anyway
      const probe = await this.session.get('/web/index.php', {
        headers: {
          Cookie: this.getCookieHeader()
        },
      });
      this.parseCookies(probe.headers['set-cookie']);
      const pBody = typeof probe.data === 'string' ? probe.data : '';
      if (probe.status === 200 && !this.isLoginPage(pBody)) {
        this.logger.info('IMS3000 login confirmed (Index probe)');
        this.detectedType = 'IMS3000';
        return true;
      }
      this.logger.error('IMS3000 login probe failed');
      return false;
    }

    this.logger.warn(`IMS3000 login unexpected status: ${res.status}`);
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
      
      // CRITICAL: Follow the redirect to finalize session
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

    if (res.status === 200 && this.isLoginPage(body)) {
      this.logger.warn('DCP2000 login rejected');
      return false;
    }

    this.logger.warn(`DCP2000 login unexpected status: ${res.status}`);
    return false;
  }

  async login() {
    // If we think we are logged in, check system status to be sure before skipping
    if (this.isLoggedIn && this.sessionId) {
        const alive = await this.checkSystemStatus();
        if (alive) {
            this.logger.debug('Session verified active, skipping login');
            if (!this.checkInterval) this.startPolling();
            return true;
        }
        this.logger.info('Session marked active but SystemStatus check failed. Re-logging in...');
    }

    // Explicitly logout if we have a session ID, to clear it on the server
    if (this.sessionId) {
      await this.logout();
    }

    try {
      const type = (this.config.type || '').toUpperCase();
      let ok = false;

      this.stopPolling(); // Stop polling while logging in

      if (type === 'IMS3000') {
        ok = await this.attemptIMS3000Login();
        if (!ok) ok = await this.attemptDCP2000Login();
      } else if (type === 'DCP2000') {
        ok = await this.attemptDCP2000Login();
        if (!ok) ok = await this.attemptIMS3000Login();
      } else {
        ok = await this.attemptIMS3000Login();
        if (!ok) ok = await this.attemptDCP2000Login();
      }

      this.isLoggedIn = !!ok;
      if (ok) {
        this.logger.info('Authentication established');
        this.startPolling(); // Start polling on success
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
    this.logger.info('Session expired or missing, re-authenticating...');
    return this.login();
  }

  async checkConnection() {
    try {
      this.logger.debug('Checking connectivity (HTTP probe)...');
      // We can also use checkSystemStatus here for a deeper check
      const alive = await this.checkSystemStatus();
      if (alive) return true;

      // Fallback to simple index probe if system status fails (e.g. auth issue but connected)
      const response = await this.session.get('/web/index.php', {
        timeout: config.TIMEOUTS.http
      });
      const connected = [200, 301, 302].includes(response.status);
      this.logger.debug(`Connectivity check: ${connected ? 'OK' : 'FAIL'} (${response.status})`);
      return connected;
    } catch (error) {
      this.logger.error(`Connectivity check failed: ${error.message}`);
      return false;
    }
  }

  async request(method, url, data = null, headers = {}) {
    await this.ensureLoggedIn();

    const defaultHeaders = {
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      ...headers, // passed headers override defaults
    };

    const cookieHeader = this.getCookieHeader();
    if (cookieHeader) defaultHeaders['Cookie'] = cookieHeader;
    if (data && !defaultHeaders['Content-Type']) {
      defaultHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    try {
      this.logger.debug(`HTTP ${method} ${url}`);

      const requestConfig = {
        method,
        url,
        headers: defaultHeaders,
        timeout: config.TIMEOUTS.http
      };
      if (data) requestConfig.data = data;

      const response = await this.session(requestConfig);

      this.parseCookies(response.headers['set-cookie']);

      const body = typeof response.data === 'string' ? response.data : '';
      if (response.status === 200 && this.isLoginPage(body)) {
        this.isLoggedIn = false;
        this.logger.warn('Session invalidated: Login page detected in response');
        // Optionally trigger immediate re-login attempt or let polling handle it
      }

      return response;
    } catch (error) {
      this.logger.error(`Request failed [${method} ${url}]: ${error.message}`);
      throw error;
    }
  }

  async destroy() {
    this.stopPolling();
    if (this.sessionId) {
      await this.logout();
    }
    this.logger.info('Session destroyed');
    this.isLoggedIn = false;
    this.sessionId = null;
    this.cookies = {};
    this.detectedType = null;
  }
}

module.exports = DolbySessionManager;