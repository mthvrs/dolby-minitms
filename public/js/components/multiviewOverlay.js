class MultiviewOverlay {
    constructor(container, theaterName, theaterNumber, showClock = false, logger = null) {
        this.container = container;
        this.theaterName = theaterName;
        this.theaterNumber = theaterNumber;
        this.showClock = showClock;
        this.logger = logger;
        this.updateInterval = null;

        this.render();
        this.update();
        this.updateInterval = setInterval(() => this.update(), 2000);

        if (this.showClock) {
            this.updateClock();
            setInterval(() => this.updateClock(), 1000);
        }
    }

    render() {
        // Theater Badge
        const badge = document.createElement('div');
        badge.className = 'theater-badge';
        badge.innerHTML = `<div class="badge-id">S${this.theaterNumber}</div>`;
        this.container.appendChild(badge);

        // Clock
        if (this.showClock) {
            const clock = document.createElement('div');
            clock.className = 'world-clock';
            clock.innerHTML = `<div class="clock-time">--:--:--</div>`;
            this.container.appendChild(clock);
            this.clockElement = clock.querySelector('.clock-time');
        }

        // Timeline
        const overlay = document.createElement('div');
        overlay.className = 'timeline-overlay';
        overlay.innerHTML = `
            <div class="timeline-header">
                <svg class="playback-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path class="icon-play" d="M8 5v14l11-7z"/>
                    <path class="icon-pause" style="display:none;" d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                    <rect class="icon-stop" style="display:none;" x="6" y="6" width="12" height="12"/>
                </svg>
                <div class="title-container">
                    <span class="show-title">--</span>
                    <span class="cpl-title-mini">--</span>
                </div>
            </div>
            <div class="progress-bar-mini">
                <div class="progress-fill-mini"></div>
            </div>
            <div class="timeline-times">
                <div class="time-group">
                    <div class="time-label">Écoulé</div>
                    <div class="time-value time-elapsed">--:--</div>
                </div>
                <div class="time-group">
                    <div class="time-label">Restant</div>
                    <div class="time-value time-remaining">--:--</div>
                </div>
                <div class="time-group">
                    <div class="time-label">Fin</div>
                    <div class="time-value time-end">--:--</div>
                </div>
            </div>
        `;
        this.container.appendChild(overlay);
    }

    async update() {
        try {
            const response = await api.getPlayback(this.theaterName);
            if (response.success && response.playback) {
                this.updateUI(response.playback);
            } else {
                this.showError();
            }
        } catch (error) {
            if (this.logger) this.logger.log(`Playback update error for ${this.theaterName}: ${error.message}`);
            this.showError();
        }
    }

    updateUI(playback) {
        const overlay = this.container.querySelector('.timeline-overlay');
        if (!overlay) return;

        const title = overlay.querySelector('.show-title');
        const cplTitleMini = overlay.querySelector('.cpl-title-mini');
        const progress = overlay.querySelector('.progress-fill-mini');
        const elapsed = overlay.querySelector('.time-elapsed');
        const remaining = overlay.querySelector('.time-remaining');
        const end = overlay.querySelector('.time-end');
        const icon = overlay.querySelector('.playback-icon');
        const iconPlay = overlay.querySelector('.icon-play');
        const iconPause = overlay.querySelector('.icon-pause');
        const iconStop = overlay.querySelector('.icon-stop');

        const state = playback.stateInfo || 'Unknown';

        iconPlay.style.display = 'none';
        iconPause.style.display = 'none';
        iconStop.style.display = 'none';
        icon.classList.remove('playing', 'paused', 'stopped');
        progress.classList.remove('feature', 'paused', 'stopped');

        if (state === 'Play') {
            iconPlay.style.display = 'block';
            icon.classList.add('playing');
            const cpl = playback.cplTitle || '';
            if (cpl.includes('_FTR') || cpl.includes('_SHR')) {
                progress.classList.add('feature');
            }
        } else if (state === 'Pause') {
            iconPause.style.display = 'block';
            icon.classList.add('paused');
            progress.classList.add('paused');
        } else {
            iconStop.style.display = 'block';
            icon.classList.add('stopped');
            progress.classList.add('stopped');
        }

        title.textContent = playback.splTitle || 'Sans titre';

        const displayCplTitle = playback.cplTitle || '';
        cplTitleMini.textContent = displayCplTitle;
        cplTitleMini.style.display = displayCplTitle ? 'block' : 'none';

        const position = parseInt(playback.splPosition || 0);
        const duration = parseInt(playback.splDuration || 1);
        const remainingTime = Math.max(0, duration - position);
        const percentage = Math.min(100, Math.max(0, (position / duration) * 100));

        progress.style.width = `${percentage}%`;
        elapsed.textContent = this.formatTime(position);
        remaining.textContent = this.formatTime(remainingTime);

        const now = new Date();
        const endTime = new Date(now.getTime() + (remainingTime * 1000));
        end.textContent = this.formatClock(endTime);
    }

    showError() {
        // Keep simplified for space
        const overlay = this.container.querySelector('.timeline-overlay');
        if (overlay) overlay.querySelector('.show-title').textContent = 'OFFLINE';
    }

    updateClock() {
        if (this.clockElement) {
            this.clockElement.textContent = new Date().toLocaleTimeString('fr-FR');
        }
    }

    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    formatClock(date) {
        return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }

    destroy() {
        if (this.updateInterval) clearInterval(this.updateInterval);
    }
}
