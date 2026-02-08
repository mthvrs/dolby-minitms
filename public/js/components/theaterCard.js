// public/js/components/theaterCard.js

class TheaterCard {
  constructor(container, theaterName, theaterData) {
    this.container = container;
    this.theaterName = theaterName;
    this.theaterData = theaterData;
    this.videoPlayer = null;
    this.isDestroyed = false;
  }

  render() {
    const card = document.createElement('div');
    card.className = 'theater-card';

    // Removed playback-info-container and associated polling UI
    card.innerHTML = `
      <div class="theater-info">
        <h2>${this.theaterName}</h2>
      </div>

      <div class="video-player-container"></div>
    `;

    this.container.appendChild(card);
    
    // Initialize video player
    const videoContainer = card.querySelector('.video-player-container');
    this.videoPlayer = new VideoPlayer(videoContainer, this.theaterName);
    this.videoPlayer.initialize();

    // Click to navigate to detail tab
    card.addEventListener('click', (e) => {
        app.switchToTheater(this.theaterName);
    });
  }

  destroy() {
    this.isDestroyed = true;
    if (this.videoPlayer) {
      this.videoPlayer.destroy();
    }
  }
}