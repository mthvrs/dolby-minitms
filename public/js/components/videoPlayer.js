// public/js/components/videoPlayer.js
class VideoPlayer {
  constructor(container, theaterName) {
    this.container = container;
    this.theaterName = theaterName;
    this.pc = null;
    this.video = null;
  }

  async initialize() {
    this.container.innerHTML = `
      <div class="video-container">
        <video class="video-el" autoplay playsinline muted></video>
        <div class="video-loading">Connexion flux...</div>
      </div>
    `;

    this.video = this.container.querySelector('.video-el');

    try {
      const resp = await fetch('/api/streams');
      const streams = await resp.json();
      const streamInfo = streams[this.theaterName];
      if (!streamInfo || streamInfo.mode !== 'webrtc') {
        console.error(`No WebRTC stream info for ${this.theaterName}`);
        return;
      }

      const whepPath = streamInfo.whep;
      await this.startWebRTC(whepPath);

      const loading = this.container.querySelector('.video-loading');
      if (loading) loading.style.display = 'none';
    } catch (err) {
      console.error('Error initializing WebRTC video player:', err);
    }
  }

  async startWebRTC(whepPath) {
    // LAN playback: no STUN/TURN needed
    this.pc = new RTCPeerConnection({ iceServers: [] });

    // Attach remote media
    const remoteStream = new MediaStream();
    this.video.srcObject = remoteStream;
    this.pc.addTransceiver('video', { direction: 'recvonly' });
    this.pc.ontrack = (ev) => {
      for (const track of ev.streams[0].getTracks()) remoteStream.addTrack(track);
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.waitIceComplete(this.pc);

    const answerResp = await fetch(whepPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: this.pc.localDescription.sdp,
    });

    if (!answerResp.ok) {
      throw new Error(`WHEP failed: ${answerResp.status}`);
    }
    const answerSdp = await answerResp.text();
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }

  waitIceComplete(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(resolve, 1000); // safety timeout
    });
  }

  destroy() {
    if (this.pc) {
      this.pc.getSenders().forEach((s) => s.track && s.track.stop());
      this.pc.close();
      this.pc = null;
    }
  }
}
