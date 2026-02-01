const express = require('express');
const { proxy } = require('rtsp-relay')(express());
const config = require('../config');
const Logger = require('./logger');
// Force usage of the Win7 compatible binary installed via package.json
const ffmpegPath = require('ffmpeg-static');

const logger = new Logger('StreamManager');

class StreamManager {
    constructor() {
        this.streams = {};
        this.app = null;
    }

    setApp(app) {
        this.app = app;
    }

    initializeStreams() {
        if (!this.app) {
            logger.error('Express app not set. Call setApp() first.');
            return;
        }

        const basePort = 9999;
        let portOffset = 0;

        for (const [theaterName, theaterConfig] of Object.entries(config.THEATERS)) {
            const endpoint = `/stream/${encodeURIComponent(theaterName)}`;

            try {
                logger.info(`Initializing stream for ${theaterName}`);

                this.app.ws(endpoint, (ws, req) => {
                    proxy({
                        url: theaterConfig.stream,
                        verbose: false,
                        transport: 'tcp',
                        // Explicitly set the ffmpeg binary path
                        ffmpegPath: ffmpegPath,
                        additionalFlags: [
                            '-q:v', '3', // Lower latency quality setting
                            '-r', config.STREAM_OPTIONS.fps.toString(),
                            '-s', `${config.STREAM_OPTIONS.width}x${config.STREAM_OPTIONS.height}`
                        ]
                    })(ws, req);
                });

                this.streams[theaterName] = {
                    endpoint: endpoint,
                    url: theaterConfig.stream
                };

                logger.info(`${theaterName} stream ready on ws://localhost:${config.PORT}${endpoint}`);
            } catch (error) {
                logger.error(`Error initializing ${theaterName}: ${error.message}`);
            }

            portOffset++;
        }
    }

    getStreamInfo(theaterName) {
        return this.streams[theaterName] || null;
    }

    getAllStreamsInfo() {
        const info = {};
        for (const [name, data] of Object.entries(this.streams)) {
            info[name] = {
                endpoint: data.endpoint,
                url: data.url
            };
        }
        return info;
    }

    closeAllStreams() {
        logger.info('Streams will close with server shutdown');
    }
}

module.exports = new StreamManager();