// public/js/components/playbackTimeline.js

class PlaybackTimeline {
    constructor(container, theaterName, compact = false) {
        this.container = container;
        this.theaterName = theaterName;
        this.compact = compact;
        this.updateInterval = null;
        this.isDestroyed = false;
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
                    <div class="playback-state">
                        <span class="state-icon">⏸</span>
                        <span class="state-text">--</span>
                    </div>
                    <div class="playback-title">--</div>
                </div>
                <div class="timeline-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: 0%"></div>
                    </div>
                    <div class="timeline-info">
                        <span class="time-current">--:--</span>
                        <span class="time-separator">/</span>
                        <span class="time-total">--:--</span>
                    </div>
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

        const stateIcon = this.container.querySelector('.state-icon');
        const stateText = this.container.querySelector('.state-text');
        const title = this.container.querySelector('.playback-title');
        const progressFill = this.container.querySelector('.progress-fill');
        const timeCurrent = this.container.querySelector('.time-current');
        const timeTotal = this.container.querySelector('.time-total');
        const timeline = this.container.querySelector('.playback-timeline');

        // Update state
        const state = playback.stateInfo || 'Unknown';
        stateText.textContent = state;
        
        // Update state icon and styling
        timeline.className = timeline.className.split(' ').filter(c => c !== 'playing' && c !== 'paused' && c !== 'stopped').join(' ');
        
        if (state === 'Play') {
            stateIcon.textContent = '▶';
            timeline.classList.add('playing');
        } else if (state === 'Pause') {
            stateIcon.textContent = '⏸';
            timeline.classList.add('paused');
        } else {
            stateIcon.textContent = '⏹';
            timeline.classList.add('stopped');
        }

        // Update title (use CPL title if available, otherwise SPL title)
        const displayTitle = playback.cplTitle || playback.splTitle || 'Aucun titre';
        title.textContent = displayTitle;
        title.title = displayTitle; // Tooltip for long titles

        // Update progress
        const position = parseInt(playback.splPosition || 0);
        const duration = parseInt(playback.splDuration || 1);
        const percentage = Math.min(100, Math.max(0, (position / duration) * 100));
        
        progressFill.style.width = `${percentage}%`;

        // Update times
        timeCurrent.textContent = this.formatTime(position);
        timeTotal.textContent = this.formatTime(duration);
    }

    showError(message) {
        if (this.isDestroyed) return;

        const stateText = this.container.querySelector('.state-text');
        const title = this.container.querySelector('.playback-title');
        const progressFill = this.container.querySelector('.progress-fill');
        
        if (stateText) stateText.textContent = message;
        if (title) title.textContent = '--';
        if (progressFill) progressFill.style.width = '0%';
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

    destroy() {
        this.isDestroyed = true;
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }
}
