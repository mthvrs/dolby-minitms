// public/js/api.js
class API {
  constructor() {
    this.baseURL = '';
  }

  async request(url, options = {}) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      // Some endpoints may return plain text; try JSON first, fall back to text
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        return await res.json();
      }
      const txt = await res.text();
      try {
        return JSON.parse(txt);
      } catch (_e) {
        return txt;
      }
    } catch (err) {
      // [FIX] Removed optional chaining
      const msg = (err && err.message) ? err.message : 'Unknown Error';
      console.error('API Error:', msg);
      throw err;
    }
  }

  static slugifyName(name) {
    return String(name).toLowerCase().replace(/\s+/g, '-');
  }

  static formatSplTitle(title) {
    if (!title) return '';
    let displaySplTitle = title;
    try {
        const currentYearShort = new Date().getFullYear().toString().slice(-2);
        // Matches "YYMMDD " at the start
        const datePrefixRegex = new RegExp(`^${currentYearShort}\\d{4}\\s+`);

        if (datePrefixRegex.test(displaySplTitle)) {
            displaySplTitle = displaySplTitle.replace(datePrefixRegex, '');
        }
    } catch (e) {
        console.warn('Error processing SPL title date filter', e);
    }
    return displaySplTitle;
  }

  // Theaters (Salles)
  async getTheaters() {
    return this.request('/api/theaters');
  }

  async getTheater(nameOrSlug) {
    const id = API.slugifyName(nameOrSlug);
    return this.request(`/api/theaters/${encodeURIComponent(id)}`);
  }

  async connectTheater(nameOrSlug) {
    const id = API.slugifyName(nameOrSlug);
    return this.request(`/api/theaters/${encodeURIComponent(id)}/connect`, {
      method: 'POST',
    });
  }

  // Macros
  async getMacros(theaterNameOrSlug) {
    const id = API.slugifyName(theaterNameOrSlug);
    return this.request(`/api/macros/${encodeURIComponent(id)}`);
  }

  async executeMacro(theaterNameOrSlug, macroName, displayName) {
    const id = API.slugifyName(theaterNameOrSlug);
    return this.request(`/api/macros/${encodeURIComponent(id)}/execute`, {
      method: 'POST',
      body: JSON.stringify({ macroName, displayName }),
    });
  }

  async restartService() {
    return this.request('/api/system/restart', {
      method: 'POST'
    });
  }

// Playback
getPlayback(theaterNameOrSlug) {
    const id = API.slugifyName(theaterNameOrSlug);
    return this.request(`/api/playback/${encodeURIComponent(id)}`);
}

}

// Expose as global for classic scripts
window.api = new API();