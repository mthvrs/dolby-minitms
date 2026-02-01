const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const Logger = require('./logger');

const logger = new Logger('WebRTC-Gateway');

// Paths relative to project root
const BIN = path.join(__dirname, '..', 'mediamtx.exe');
const CFG = path.join(__dirname, '..', 'mediamtx.yml');

let child = null;

function ensureRunning() {
    if (!fs.existsSync(CFG)) {
        logger.error(`Missing mediamtx.yml at ${CFG}`);
        return;
    }
    if (!fs.existsSync(BIN)) {
        logger.error(`Missing mediamtx.exe at ${BIN}`);
        return;
    }
    if (child) return;

    logger.info(`Starting MediaMTX from ${BIN}`);
    
    // cwd is important so mediamtx finds its config file
    const cwd = path.dirname(BIN);
    
    child = spawn(BIN, [CFG], { 
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: cwd 
    });

    child.stdout.on('data', (d) => {
        const msg = d.toString().trim();
        if(msg) logger.debug(`[MediaMTX] ${msg}`);
    });
    
    child.stderr.on('data', (d) => {
        const msg = d.toString().trim();
        if(msg) logger.warn(`[MediaMTX] ${msg}`);
    });

    child.on('exit', (code) => {
        logger.warn(`MediaMTX exited with code ${code}`);
        child = null;
    });
}

function slugify(name) {
    return String(name).toLowerCase().replace(/\s+/g, '-');
}

module.exports = {
    ensureRunning,
    slugify,
    mediamtxHttpOrigin: 'http://127.0.0.1:8889',
};