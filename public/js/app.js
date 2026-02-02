// public/js/app.js
// Classic script variant: relies on global `api`, `TheaterCard`, `MacroPanel`, `VideoPlayer`

class App {
  constructor() {
    this.theaters = {};
    this.currentTab = 'overview';
    this.theaterCards = [];
    this.theaterPanels = {};
    this.confirmCallback = null;
  }

  async initialize() {
    this.setupTheme(); // Initialize theme first
    this.startClock();
    this.setupModal();
    await this.loadTheaters();
  }

  // New method to handle Light/Dark mode
  setupTheme() {
    const toggleBtn = document.getElementById('theme-toggle');
    const html = document.documentElement;
    
    // Check local storage or system preference
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    const initialTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
    html.setAttribute('data-theme', initialTheme);

    toggleBtn.addEventListener('click', () => {
      const currentTheme = html.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      
      html.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
    });
  }

  startClock() {
    const clockEl = document.getElementById('clock');
    const updateClock = () => {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString('fr-FR');
    };
    updateClock();
    setInterval(updateClock, 1000);
  }

  async loadTheaters() {
    try {
      const resp = await api.getTheaters();
      
      let list = [];
      if (Array.isArray(resp)) {
        list = resp;
      } else if (resp && Array.isArray(resp.theaters)) {
        list = resp.theaters;
      }

      this.theaters = {};
      for (const t of list) {
        if (t && t.name) this.theaters[t.name] = t;
      }

      this.createTheaterTabs();
      this.renderOverview();
      this.setupTabs();
    } catch (error) {
      console.error('Error loading theaters', error);
      this.renderOverview(true);
    }
  }

  renderOverview(error = false) {
    const grid = document.getElementById('overview-grid');
    grid.innerHTML = '';

    const names = Object.keys(this.theaters);
    if (names.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'loading';
      msg.textContent = error ? 'Erreur de chargement des salles' : 'Aucune salle disponible';
      grid.appendChild(msg);
      return;
    }

    for (const [name, data] of Object.entries(this.theaters)) {
      const card = new TheaterCard(grid, name, data);
      card.render();
      this.theaterCards.push(card);
    }
  }

  createTheaterTabs() {
    const tabsContainer = document.getElementById('tabs');
    const contentContainer = document.querySelector('.content');

    const existingTabs = Array.from(tabsContainer.querySelectorAll('.tab')).filter(t => t.dataset.tab !== 'overview');
    existingTabs.forEach(tab => tab.remove());

    const existingContents = Array.from(contentContainer.querySelectorAll('.tab-content')).filter(c => c.id !== 'overview-content');
    existingContents.forEach(content => content.remove());

    const theaterNames = Object.keys(this.theaters);
    if (theaterNames.length === 0) return;

    for (const name of theaterNames) {
      const data = this.theaters[name];
      const safeId = String(name).toLowerCase().replace(/\s+/g, '-');

      const tabBtn = document.createElement('button');
      tabBtn.className = 'tab';
      tabBtn.dataset.tab = safeId;
      tabBtn.textContent = name;
      tabsContainer.appendChild(tabBtn);

      const tabContent = document.createElement('div');
      tabContent.className = 'tab-content';
      tabContent.id = `${safeId}-content`;
      tabContent.innerHTML = `
        <div class="theater-detail">
          <div class="controls-section" id="controls-${safeId}">
            <div class="loading">Chargement...</div>
          </div>
          <div class="right-panel">
            <h3 class="panel-title">Vue en direct</h3>
            <div class="video-player-container" id="video-${safeId}"></div>
          </div>
        </div>
      `;
      contentContainer.appendChild(tabContent);

      const videoContainer = tabContent.querySelector(`#video-${safeId}`);
      const videoPlayer = new VideoPlayer(videoContainer, name);
      videoPlayer.initialize();

      const controlsContainer = tabContent.querySelector(`#controls-${safeId}`);
      const macroPanel = new MacroPanel(controlsContainer, name);
      macroPanel.load();

      this.theaterPanels[safeId] = { videoPlayer, macroPanel };
    }
  }

  setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        this.switchTab(tabName);
      });
    });
  }

  switchTab(tabName) {
    document.querySelectorAll('.tab').forEach((t) => {
      if (t.dataset.tab === tabName) t.classList.add('active');
      else t.classList.remove('active');
    });

    document.querySelectorAll('.tab-content').forEach((content) => {
      if (content.id === `${tabName}-content`) content.classList.add('active');
      else content.classList.remove('active');
    });

    this.currentTab = tabName;
  }

  switchToTheater(theaterName) {
    const safeId = String(theaterName).toLowerCase().replace(/\s+/g, '-');
    this.switchTab(safeId);
  }

  setupModal() {
    const modal = document.getElementById('confirmation-modal');
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');

    confirmBtn.addEventListener('click', () => {
      if (this.confirmCallback) this.confirmCallback(true);
      this.hideModal();
    });

    cancelBtn.addEventListener('click', () => {
      if (this.confirmCallback) this.confirmCallback(false);
      this.hideModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.confirmCallback) this.confirmCallback(false);
        this.hideModal();
      }
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        if (this.confirmCallback) this.confirmCallback(false);
        this.hideModal();
      }
    });
  }

  showConfirmation(macroName, callback) {
    const modal = document.getElementById('confirmation-modal');
    const macroNameEl = document.getElementById('modal-macro-name');
    macroNameEl.textContent = macroName;
    modal.classList.remove('hidden');
    this.confirmCallback = callback;
  }

  hideModal() {
    const modal = document.getElementById('confirmation-modal');
    modal.classList.add('hidden');
    this.confirmCallback = null;
  }
}

// Initialize app
const app = new App();
document.addEventListener('DOMContentLoaded', () => app.initialize());