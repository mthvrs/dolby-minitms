// public/js/components/theaterCard.js

class TheaterCard {
  constructor(container, theaterName, theaterData) {
    this.container = container;
    this.theaterName = theaterName;
    this.theaterData = theaterData;
    this.videoPlayer = null;
    this.playbackTimeline = null;
    this.isDestroyed = false;
  }

  render() {
    const card = document.createElement('div');
    card.className = 'theater-card';

    card.innerHTML = `
      <div class="theater-info">
        <h2>${this.theaterName}</h2>
      </div>

      <div class="video-player-container"></div>
      
      <div class="playback-timeline-container"></div>
    `;

    this.container.appendChild(card);
    
    // Initialize video player
    const videoContainer = card.querySelector('.video-player-container');
    this.videoPlayer = new VideoPlayer(videoContainer, this.theaterName);
    this.videoPlayer.initialize();

    // Initialize playback timeline (compact mode for cards)
    const timelineContainer = card.querySelector('.playback-timeline-container');
    this.playbackTimeline = new PlaybackTimeline(timelineContainer, this.theaterName, true);
    this.playbackTimeline.initialize();

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
    if (this.playbackTimeline) {
      this.playbackTimeline.destroy();
    }
  }
}
