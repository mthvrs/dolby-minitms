const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const Logger = require('./logger');

const logger = new Logger('WebRTC-Gateway');

// Determine binary name based on platform (Windows vs Linux)
const isWin = process.platform === 'win32';
const binName = isWin ? 'mediamtx.exe' : 'mediamtx';

// Paths relative to project root
const BIN = path.join(__dirname, '..', binName);
const CFG = path.join(__dirname, '..', 'mediamtx.yml');

let child = null;

function ensureRunning() {
    if (!fs.existsSync(CFG)) {
        logger.error(`Missing mediamtx.yml at ${CFG}`);
        return;
    }
    if (!fs.existsSync(BIN)) {
        logger.error(`Missing MediaMTX binary at ${BIN}`);
        return;
    }
    if (child) return;

    logger.info(`Starting MediaMTX from ${BIN}`);
    
    // cwd is important so mediamtx finds its config file
    const cwd = path.dirname(BIN);
    
    // Allow execution permission on Linux
    if (!isWin) {
        try {
            fs.chmodSync(BIN, '755');
        } catch (e) {
            logger.warn(`Could not set executable permissions on ${BIN}: ${e.message}`);
        }
    }
    
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