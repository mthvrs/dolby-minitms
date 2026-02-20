class MultiviewFeed {
    constructor(container, theaterSlug, theaterName, theaterNumber, isFirst, logger = null) {
        this.container = container;
        this.slug = theaterSlug;
        this.pc = null;
        this.logger = logger;

        this.spinner = document.createElement('div');
        this.spinner.className = 'spinner';
        this.container.appendChild(this.spinner);

        this.video = document.createElement('video');
        this.video.muted = true;
        this.video.autoplay = true;
        this.video.playsInline = true;
        this.video.style.opacity = '0';
        this.video.style.transition = 'opacity 0.5s ease';
        this.container.appendChild(this.video);

        this.timeline = new MultiviewOverlay(container, theaterName, theaterNumber, isFirst, logger);

        this.video.onplaying = () => {
            this.spinner.style.display = 'none';
            this.video.style.opacity = '1';
        };
        this.video.onwaiting = () => this.spinner.style.display = 'block';

        this.reloadInterval = setInterval(() => this.restart(), 10 * 60 * 1000);
    }

    async start() {
        try {
            this.spinner.style.display = 'block';
            const whepUrl = `/api/whep/${this.slug}`;

            this.pc = new RTCPeerConnection({ iceServers: [] });
            this.pc.onconnectionstatechange = () => {
                if (['failed', 'disconnected'].includes(this.pc.connectionState)) this.restart();
            };
            this.pc.addTransceiver('video', { direction: 'recvonly' });

            const remoteStream = new MediaStream();
            this.video.srcObject = remoteStream;
            this.pc.ontrack = (ev) => ev.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));

            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            await this.waitIceComplete();

            const res = await fetch(whepUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/sdp' },
                body: this.pc.localDescription.sdp
            });

            if (!res.ok) throw new Error(`WHEP Error ${res.status}`);
            await this.pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });

        } catch (e) {
            if (this.logger) this.logger.log(`Connection error for ${this.slug}: ${e.message}`);
            setTimeout(() => this.restart(), 5000);
        }
    }

    waitIceComplete() {
        return new Promise(resolve => {
            if (this.pc.iceGatheringState === 'complete') return resolve();
            const check = () => {
                if (this.pc.iceGatheringState === 'complete') {
                    this.pc.removeEventListener('icegatheringstatechange', check);
                    resolve();
                }
            };
            this.pc.addEventListener('icegatheringstatechange', check);
            setTimeout(resolve, 1000);
        });
    }

    restart() {
        this.video.style.opacity = '0';
        if (this.pc) { this.pc.close(); this.pc = null; }
        setTimeout(() => this.start(), 500);
    }
}
