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

  // NEW: Playback
  async getTheaterPlayback(nameOrSlug) {
    const id = API.slugifyName(nameOrSlug);
    return this.request(`/api/theaters/${encodeURIComponent(id)}/playback`);
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
}

// Expose as global for classic scripts
window.api = new API();