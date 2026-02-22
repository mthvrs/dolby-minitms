// public/js/components/playbackTimeline.js

class PlaybackTimeline {
    constructor(container, theaterName, compact = false) {
        this.container    = container;
        this.theaterName  = theaterName;
        this.compact      = compact;
        this.updateInterval = null;
        this.isDestroyed  = false;
        this.preShowTimer = null;

        // Stored wall-clock start of the upcoming show (Date), used for live countdown
        this._nextShowStart = null;
    }

    async initialize() {
        this.render();
        await this.update();
        this.updateInterval = setInterval(() => {
            if (!this.isDestroyed) this.update();
        }, 2000);
    }

    render() {
        const timelineClass = this.compact ? 'playback-timeline compact' : 'playback-timeline';
        this.container.innerHTML = `
            <div class="${timelineClass}">
                <div class="timeline-header">
                    <div class="playback-title spl-title">--</div>
                </div>
                <div class="timeline-main">
                    <div class="playback-state">
                        <svg class="state-icon state-icon-play" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z"/>
                        </svg>
                        <svg class="state-icon state-icon-pause" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="display:none;">
                            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                        </svg>
                        <svg class="state-icon state-icon-stop" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="display:none;">
                            <rect x="6" y="6" width="12" height="12"/>
                        </svg>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: 0%"></div>
                    </div>
                    <div class="timeline-end-time">--:--</div>
                </div>
                <div class="timeline-info">
                    <div class="preshow-timer-slot hidden"></div>
                    <div class="time-item time-elapsed-item">
                        <span class="time-label">Écoulé</span>
                        <span class="time-value time-current">--:--</span>
                    </div>
                    <div class="time-item time-remaining-item">
                        <span class="time-label">Restant</span>
                        <span class="time-value time-remaining">--:--</span>
                    </div>
                </div>
                <div class="cpl-title-wrapper">
                    <div class="cpl-title">--</div>
                </div>
            </div>
        `;

        // Wire up the PreShowTimer component to its slot
        const slot = this.container.querySelector('.preshow-timer-slot');
        this.preShowTimer = new PreShowTimer(slot);
    }

    async update() {
        if (this.isDestroyed) return;
        try {
            // Fire both requests in parallel; timers endpoint is best-effort
            const [playbackResp, timerResp] = await Promise.allSettled([
                api.getPlayback(this.theaterName),
                api.getTimers(this.theaterName),
            ]);

            if (playbackResp.status === 'fulfilled' && playbackResp.value.success && playbackResp.value.playback) {
                this.updateUI(playbackResp.value.playback);
            } else {
                this.showError('Aucune donnée');
            }

            // Update preshow timer — silently swallow any error
            if (this.preShowTimer) {
                const timer = (timerResp.status === 'fulfilled' && timerResp.value && timerResp.value.success)
                    ? timerResp.value.timer
                    : null;
                this.preShowTimer.update(timer);
            }
        } catch (error) {
            this.showError('Erreur');
        }
    }

    updateUI(playback) {
        if (this.isDestroyed) return;

        const splTitle      = this.container.querySelector('.spl-title');
        const cplTitle      = this.container.querySelector('.cpl-title');
        const progressFill  = this.container.querySelector('.progress-fill');
        const timeCurrent   = this.container.querySelector('.time-current');
        const timeRemaining = this.container.querySelector('.time-remaining');
        const timeEnd       = this.container.querySelector('.timeline-end-time');
        const timeline      = this.container.querySelector('.playback-timeline');
        const iconPlay      = this.container.querySelector('.state-icon-play');
        const iconPause     = this.container.querySelector('.state-icon-pause');
        const iconStop      = this.container.querySelector('.state-icon-stop');

        const state = playback.stateInfo || 'Unknown';

        // ── State icons ─────────────────────────────────────────────────
        iconPlay.style.display  = 'none';
        iconPause.style.display = 'none';
        iconStop.style.display  = 'none';

        timeline.className = timeline.className.split(' ')
            .filter(c => c !== 'playing' && c !== 'paused' && c !== 'stopped' && c !== 'feature')
            .join(' ');

        if (state === 'Play') {
            iconPlay.style.display = 'block';
            timeline.classList.add('playing');
        } else if (state === 'Pause') {
            iconPause.style.display = 'block';
            timeline.classList.add('paused');
        } else {
            iconStop.style.display = 'block';
            timeline.classList.add('stopped');
        }

        const cplTitleText = playback.cplTitle || '';
        if ((cplTitleText.includes('_FTR') || cplTitleText.includes('_SHR')) && state === 'Play') {
            timeline.classList.add('feature');
        }

        // ── SPL title — "À SUIVRE" override when stopped with upcoming show ───────
        const isStopped = (state !== 'Play' && state !== 'Pause');
        const nextShow  = playback.nextShow; // { title, start (ISO), secondsUntil }

        if (isStopped && nextShow && nextShow.title && nextShow.start) {
            // Anchor the show start as an absolute Date the first time we see it,
            // then use wall-clock delta for a perfectly smooth live countdown.
            const incomingStart = new Date(nextShow.start);
            if (!this._nextShowStart || Math.abs(this._nextShowStart - incomingStart) > 5000) {
                this._nextShowStart = incomingStart;
            }

            const secsUntil = Math.max(0, Math.round((this._nextShowStart - Date.now()) / 1000));
            const formattedTitle = API.formatSplTitle(nextShow.title);
            const countdown      = this._fmtCountdown(secsUntil);

            splTitle.innerHTML =
                `<span class="a-suivre-label">À SUIVRE :</span> ` +
                `<em class="a-suivre-title">${formattedTitle}</em>` +
                `<span class="a-suivre-sep"> ——— Dans ${countdown}s</span>`;
            splTitle.title = `À SUIVRE : ${formattedTitle} — Dans ${countdown}s`;
        } else {
            // Normal display
            this._nextShowStart = null;
            const displaySplTitle = API.formatSplTitle(playback.splTitle || 'Aucun titre');
            splTitle.textContent = displaySplTitle;
            splTitle.title       = displaySplTitle;
        }

        // ── CPL title ──────────────────────────────────────────────────
        const displayCplTitle = playback.cplTitle || '--';
        cplTitle.textContent = displayCplTitle;
        cplTitle.title       = displayCplTitle;

        // ── Progress / times ─────────────────────────────────────────
        const position  = parseInt(playback.splPosition || 0);
        const duration  = parseInt(playback.splDuration  || 1);
        const remaining = Math.max(0, duration - position);
        const pct       = Math.min(100, Math.max(0, (position / duration) * 100));
        const now       = new Date();
        const endTime   = new Date(now.getTime() + remaining * 1000);

        progressFill.style.width    = `${pct}%`;
        timeCurrent.textContent     = this.formatTime(position);
        timeRemaining.textContent   = this.formatTime(remaining);
        timeEnd.textContent         = this.formatClock(endTime);
    }

    // ── Helpers ────────────────────────────────────────────────────

    /** Format seconds as H:MM:SS (with hours) or M:SS */
    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    /** Format a countdown as HH:MM:SS */
    _fmtCountdown(totalSec) {
        const s = Math.max(0, Math.round(totalSec));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ss = s % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }

    formatClock(date) {
        return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }

    showError(message) {
        if (this.isDestroyed) return;
        const splTitle      = this.container.querySelector('.spl-title');
        const cplTitle      = this.container.querySelector('.cpl-title');
        const progressFill  = this.container.querySelector('.progress-fill');
        const timeCurrent   = this.container.querySelector('.time-current');
        const timeRemaining = this.container.querySelector('.time-remaining');
        const timeEnd       = this.container.querySelector('.timeline-end-time');
        if (splTitle)      splTitle.textContent      = message;
        if (cplTitle)      cplTitle.textContent      = '--';
        if (progressFill)  progressFill.style.width  = '0%';
        if (timeCurrent)   timeCurrent.textContent   = '--:--';
        if (timeRemaining) timeRemaining.textContent = '--:--';
        if (timeEnd)       timeEnd.textContent       = '--:--';
    }

    destroy() {
        this.isDestroyed = true;
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }
}
