// public/js/components/playbackTimeline.js

class PlaybackTimeline {
    constructor(container, theaterName, compact = false) {
        this.container = container;
        this.theaterName = theaterName;
        this.compact = compact;
        this.updateInterval = null;
        this.isDestroyed = false;
    }

    // Nettoie le titre SPL en retirant les dates au format YYMMDD
    cleanSplTitle(title) {
        if (!title) return title;
        
        const currentYear = new Date().getFullYear();
        const yearSuffix = String(currentYear).slice(-2); // "26" pour 2026
        
        // Regex: commence par 2 chiffres (année) + 4 chiffres (mois/jour) + espace
        const datePattern = new RegExp(`^${yearSuffix}\\d{4}\\s+`);
        
        return title.replace(datePattern, '');
    }

    async initialize() {
        this.render();
        await this.update();
        // Update every 2 seconds
        this.updateInterval = setInterval(() => {
            if (!this.isDestroyed) {
                this.update();
            }
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
                </div>
                <div class="timeline-info">
                    <div class="time-item">
                        <span class="time-label">Écoulé</span>
                        <span class="time-value time-current">--:--</span>
                    </div>
                    <div class="time-item">
                        <span class="time-label">Restant</span>
                        <span class="time-value time-remaining">--:--</span>
                    </div>
                    <div class="time-item">
                        <span class="time-label">Heure de fin</span>
                        <span class="time-value time-end">--:--</span>
                    </div>
                </div>
                <div class="cpl-title-wrapper">
                    <div class="cpl-title">--</div>
                </div>
            </div>
        `;
    }

    async update() {
        if (this.isDestroyed) return;

        try {
            const response = await api.getPlayback(this.theaterName);
            
            if (response.success && response.playback) {
                this.updateUI(response.playback);
            } else {
                this.showError('Aucune donnée');
            }
        } catch (error) {
            this.showError('Erreur');
        }
    }

    updateUI(playback) {
        if (this.isDestroyed) return;

        const splTitle = this.container.querySelector('.spl-title');
        const cplTitle = this.container.querySelector('.cpl-title');
        const progressFill = this.container.querySelector('.progress-fill');
        const timeCurrent = this.container.querySelector('.time-current');
        const timeRemaining = this.container.querySelector('.time-remaining');
        const timeEnd = this.container.querySelector('.time-end');
        const timeline = this.container.querySelector('.playback-timeline');
        
        const iconPlay = this.container.querySelector('.state-icon-play');
        const iconPause = this.container.querySelector('.state-icon-pause');
        const iconStop = this.container.querySelector('.state-icon-stop');

        // Update state
        const state = playback.stateInfo || 'Unknown';
        
        // Calculate times for glow effects
        const position = parseInt(playback.splPosition || 0);
        const duration = parseInt(playback.splDuration || 1);
        const remaining = Math.max(0, duration - position);
        const percentage = Math.min(100, Math.max(0, (position / duration) * 100));
        
        // Remove all glow classes
        timeline.classList.remove('glow-paused', 'glow-stopped', 'glow-ending-blue', 'glow-ending-green');
        
        // Update state icons visibility
        iconPlay.style.display = 'none';
        iconPause.style.display = 'none';
        iconStop.style.display = 'none';
        
        // Remove previous state classes
        timeline.className = timeline.className.split(' ').filter(c => 
            c !== 'playing' && c !== 'paused' && c !== 'stopped' && c !== 'feature'
        ).join(' ');
        
        if (state === 'Play') {
            iconPlay.style.display = 'block';
            timeline.classList.add('playing');
            
            // Check if less than 10 minutes remaining
            if (remaining < 600) { // 600 seconds = 10 minutes
                // Use blue for feature content, green for other content
                const cplTitleText = playback.cplTitle || '';
                if (cplTitleText.includes('_FTR') || cplTitleText.includes('_SHR')) {
                    timeline.classList.add('glow-ending-blue');
                } else {
                    timeline.classList.add('glow-ending-green');
                }
            }
        } else if (state === 'Pause') {
            iconPause.style.display = 'block';
            timeline.classList.add('paused');
            timeline.classList.add('glow-paused'); // Orange glow
        } else {
            iconStop.style.display = 'block';
            timeline.classList.add('stopped');
            timeline.classList.add('glow-stopped'); // Red glow
        }

        // Check if CPL contains _FTR or _SHR for feature/short detection
        const cplTitleText = playback.cplTitle || '';
        if ((cplTitleText.includes('_FTR') || cplTitleText.includes('_SHR')) && state === 'Play') {
            timeline.classList.add('feature');
        }

        // Update SPL title (Show Playlist - prominent) - Clean date prefix
        const displaySplTitle = this.cleanSplTitle(playback.splTitle) || 'Aucun titre';
        splTitle.textContent = displaySplTitle;
        splTitle.title = displaySplTitle;

        // Update CPL title - can be truncated if needed
        const displayCplTitle = playback.cplTitle || '--';
        cplTitle.textContent = displayCplTitle;
        cplTitle.title = displayCplTitle;
        
        // Calculate end time
        const now = new Date();
        const endTime = new Date(now.getTime() + (remaining * 1000));
        
        // Update progress
        progressFill.style.width = `${percentage}%`;

        // Update times
        timeCurrent.textContent = this.formatTime(position);
        timeRemaining.textContent = this.formatTime(remaining);
        timeEnd.textContent = this.formatClock(endTime);
    }

    showError(message) {
        if (this.isDestroyed) return;

        const splTitle = this.container.querySelector('.spl-title');
        const cplTitle = this.container.querySelector('.cpl-title');
        const progressFill = this.container.querySelector('.progress-fill');
        const timeCurrent = this.container.querySelector('.time-current');
        const timeRemaining = this.container.querySelector('.time-remaining');
        const timeEnd = this.container.querySelector('.time-end');
        const timeline = this.container.querySelector('.playback-timeline');
        
        // Remove glow effects on error
        if (timeline) {
            timeline.classList.remove('glow-paused', 'glow-stopped', 'glow-ending-blue', 'glow-ending-green');
        }
        
        if (splTitle) splTitle.textContent = message;
        if (cplTitle) cplTitle.textContent = '--';
        if (progressFill) progressFill.style.width = '0%';
        if (timeCurrent) timeCurrent.textContent = '--:--';
        if (timeRemaining) timeRemaining.textContent = '--:--';
        if (timeEnd) timeEnd.textContent = '--:--';
    }

    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        
        if (h > 0) {
            return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        } else {
            return `${m}:${String(s).padStart(2, '0')}`;
        }
    }

    formatClock(date) {
        return date.toLocaleTimeString('fr-FR', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }

    destroy() {
        this.isDestroyed = true;
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }
}
