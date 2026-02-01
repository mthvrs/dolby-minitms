// public/js/components/theaterCard.js

class TheaterCard {
  constructor(container, theaterName, theaterData) {
    this.container = container;
    this.theaterName = theaterName;
    this.theaterData = theaterData;
    this.videoPlayer = null;
    this.pollInterval = null;
    this.isDestroyed = false;
  }

  render() {
    const card = document.createElement('div');
    card.className = 'theater-card';

    // Added playback-info-container between title and video
    card.innerHTML = `
      <div class="theater-info">
        <h2>${this.theaterName}</h2>
      </div>
      
      <div class="playback-info-container" style="display: none;">
         <div class="spl-title">--</div>
         <div class="playback-progress-track">
             <div class="playback-progress-fill" style="width: 0%;"></div>
         </div>
         <div class="playback-times">
             <span class="time-current">00:00:00</span> / <span class="time-total">00:00:00</span>
         </div>
      </div>

      <div class="video-player-container"></div>
    `;

    this.container.appendChild(card);
    
    this.ui = {
        container: card.querySelector('.playback-info-container'),
        title: card.querySelector('.spl-title'),
        fill: card.querySelector('.playback-progress-fill'),
        current: card.querySelector('.time-current'),
        total: card.querySelector('.time-total')
    };

    // Initialize video player
    const videoContainer = card.querySelector('.video-player-container');
    this.videoPlayer = new VideoPlayer(videoContainer, this.theaterName);
    this.videoPlayer.initialize();

    // Click to navigate to detail tab
    card.addEventListener('click', (e) => {
        app.switchToTheater(this.theaterName);
    });

    // Start polling playback status
    this.startPolling();
  }

  formatTime(seconds) {
      if (!seconds && seconds !== 0) return '--:--:--';
      const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
      const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
      const s = Math.floor(seconds % 60).toString().padStart(2, '0');
      return `${h}:${m}:${s}`;
  }

  async updatePlayback() {
      if (this.isDestroyed) return;
      try {
          // Uses the new method in your API class
          const status = await api.getTheaterPlayback(this.theaterData.slug);
          
          if (!status || !status.playing) {
              this.ui.container.style.display = 'none';
              return;
          }

          // Update UI
          this.ui.container.style.display = 'block';
          this.ui.title.textContent = status.splTitle;
          this.ui.fill.style.width = `${status.percent}%`;
          this.ui.current.textContent = this.formatTime(status.position);
          this.ui.total.textContent = this.formatTime(status.duration);
          
      } catch (err) {
          // Silent catch for polling
      }
  }

  startPolling() {
      // Poll every 2 seconds
      this.updatePlayback();
      this.pollInterval = setInterval(() => this.updatePlayback(), 2000);
  }

  destroy() {
    this.isDestroyed = true;
    if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
    }
    if (this.videoPlayer) {
      this.videoPlayer.destroy();
    }
  }
}