// public/js/app.js
// Classic script variant: relies on global `api`, `TheaterCard`, `MacroPanel`, `VideoPlayer`

class App {
  constructor() {
    this.theaters = {};
    this.currentTab = 'overview';
    this.theaterCards = [];
    this.theaterPanels = {};
    this.confirmCallback = null;

    // Lock States: 'confirm' (Green/Safe) | 'instant' (Orange/Unsafe)
    this.lockModes = ['confirm', 'instant'];
    this.lockMode = 'confirm'; // Default behavior: unlocked with ask
    this.lockTimeout = null;
  }

  async initialize() {
    this.setupTheme(); // Initialize theme first
    this.setupReloadBtn(); // Setup reload button
    this.setupLockBtn(); // Setup lock button
    this.startClock();
    this.setupModal();
    await this.loadTheaters();
  }

  setupTheme() {
    const toggleBtn = document.getElementById('theme-toggle');
    const html = document.documentElement;
    
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

  setupReloadBtn() {
    const reloadBtn = document.getElementById('reload-btn');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        window.location.reload();
      });
    }
  }

  setupLockBtn() {
    const lockBtn = document.getElementById('lock-btn');
    if (lockBtn) {
        lockBtn.addEventListener('click', () => {
            this.cycleLockMode();
        });
        this.updateLockInterface();
    }
  }

  cycleLockMode() {
    const currentIndex = this.lockModes.indexOf(this.lockMode);
    const nextIndex = (currentIndex + 1) % this.lockModes.length;
    this.setLockMode(this.lockModes[nextIndex]);
  }

  setLockMode(mode) {
    this.lockMode = mode;
    
    // Clear any existing reversion timer
    if (this.lockTimeout) {
        clearTimeout(this.lockTimeout);
        this.lockTimeout = null;
    }

    // If entering 'instant' (Orange) mode, set timer to revert in 3 minutes
    if (this.lockMode === 'instant') {
        this.lockTimeout = setTimeout(() => {
            this.setLockMode('confirm');
        }, 3 * 60 * 1000); // 3 minutes
    }
    
    this.updateLockInterface();
  }

  updateLockInterface() {
    const lockBtn = document.getElementById('lock-btn');
    const html = document.documentElement;
    
    // Set global attribute for CSS styling
    html.setAttribute('data-lock-mode', this.lockMode);

    // Update button visual state
    lockBtn.className = 'theme-btn lock-btn'; 
    lockBtn.classList.add(this.lockMode);

    // Icons
    // Closed Lock (used for Green/Confirm mode)
    const iconClosed = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
    
    // Open Lock (used for Orange/Instant mode)
    const iconOpen = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;

    if (this.lockMode === 'confirm') {
        lockBtn.innerHTML = iconClosed;
        lockBtn.title = "Sécurisé : Confirmation requise";
    } else if (this.lockMode === 'instant') {
        lockBtn.innerHTML = iconOpen;
        lockBtn.title = "Attention : Exécution immédiate (Auto-reverrouillage dans 3m)";
    }
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
    // Safety check: Revert to safe mode if currently in instant mode
    if (this.lockMode === 'instant') {
        this.setLockMode('confirm');
    }

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