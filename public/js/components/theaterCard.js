// public/js/components/theaterCard.js

class TheaterCard {
  constructor(container, theaterName, theaterData) {
    this.container = container;
    this.theaterName = theaterName;
    this.theaterData = theaterData;
    this.videoPlayer = null;
    this.playbackTimeline = null;
    this.isDestroyed = false;
    this.statusObserver = null;
  }

  render() {
    // New Structure: Flex row handled by CSS
    const card = document.createElement('div');
    card.className = 'theater-card';

    // 1. The Left "Status Strip" (Color + Icon)
    // Icons (Play, Pause, Stop square)
    const svgPlay = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
    const svgPause = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
    const svgStop = `<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>`;

    card.innerHTML = `
      <div class="theater-status-strip">
        <h2 class="theater-name-vertical">${this.theaterName}</h2>
        <div class="status-icon-large">
             <div class="icon-play" style="display:none">${svgPlay}</div>
             <div class="icon-pause" style="display:none">${svgPause}</div>
             <div class="icon-stop">${svgStop}</div>
        </div>
      </div>

      <div class="theater-card-content">
          <div class="video-player-container"></div>
          <div class="playback-timeline-container"></div>
      </div>
    `;

    this.container.appendChild(card);
    
    // Initialize components in the right section
    const videoContainer = card.querySelector('.video-player-container');
    this.videoPlayer = new VideoPlayer(videoContainer, this.theaterName);
    this.videoPlayer.initialize();

    const timelineContainer = card.querySelector('.playback-timeline-container');
    this.playbackTimeline = new PlaybackTimeline(timelineContainer, this.theaterName, true);
    this.playbackTimeline.initialize();

    // 2. Setup Observer to sync Timeline State -> Status Strip Color
    // The PlaybackTimeline adds classes .playing, .paused, .stopped to its container (usually).
    // We observe the timeline container for class changes.
    const timelineEl = timelineContainer.querySelector('.playback-timeline') || timelineContainer;
    const statusStrip = card.querySelector('.theater-status-strip');
    const iconPlay = card.querySelector('.icon-play');
    const iconPause = card.querySelector('.icon-pause');
    const iconStop = card.querySelector('.icon-stop');

    // Wait a moment for timeline to render its internal div if needed
    setTimeout(() => {
        const target = timelineContainer.querySelector('.playback-timeline');
        if (target) {
            this.statusObserver = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.attributeName === 'class') {
                        const classes = mutation.target.classList;
                        
                        // Reset
                        statusStrip.classList.remove('playing', 'paused', 'stopped');
                        iconPlay.style.display = 'none';
                        iconPause.style.display = 'none';
                        iconStop.style.display = 'none';

                        // Apply new state
                        if (classes.contains('playing')) {
                            statusStrip.classList.add('playing');
                            iconPlay.style.display = 'block';
                        } else if (classes.contains('paused')) {
                            statusStrip.classList.add('paused');
                            iconPause.style.display = 'block';
                        } else {
                            statusStrip.classList.add('stopped');
                            iconStop.style.display = 'block';
                        }
                    }
                });
            });
            this.statusObserver.observe(target, { attributes: true });
        }
    }, 500);

    // Navigation click
    card.addEventListener('click', (e) => {
        // Don't navigate if clicking video controls (if any exist)
        if (!e.target.closest('button')) {
            app.switchToTheater(this.theaterName);
        }
    });
  }

  destroy() {
    this.isDestroyed = true;
    if (this.statusObserver) this.statusObserver.disconnect();
    if (this.videoPlayer) this.videoPlayer.destroy();
    if (this.playbackTimeline) this.playbackTimeline.destroy();
  }
}