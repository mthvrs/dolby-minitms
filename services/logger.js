const fs = require('fs');
const path = require('path');

// Global stream variable for the module
let logStream = null;

class Logger {
    constructor(context) {
        this.context = context || 'System';
        
        // Logs are stored in /logs relative to project root
        this.logDir = path.join(__dirname, '..', 'logs');
        this.logFile = path.join(this.logDir, 'app.log');

        this._ensureLogDir();
        this._ensureStream();
    }

    _ensureLogDir() {
        if (!fs.existsSync(this.logDir)) {
            try {
                fs.mkdirSync(this.logDir, { recursive: true });
            } catch (e) {
                console.error('Could not create log directory:', e);
            }
        }
    }

    _ensureStream() {
        if (!logStream) {
            try {
                // Create a write stream in append mode
                logStream = fs.createWriteStream(this.logFile, { flags: 'a', encoding: 'utf8' });

                logStream.on('error', (err) => {
                    console.error('Logger stream error:', err);
                    // Attempt to recover or just disable logging to file?
                    // For simplicity, we might just null it out so next write tries to recreate or fails gracefully.
                    logStream = null;
                });
            } catch (e) {
                console.error('Could not create log stream:', e);
            }
        }
    }

    _format(level, message) {
        const ts = new Date().toISOString().replace('T', ' ').split('.')[0];
        return `[${ts}] [${this.context}] [${level}] ${message}`;
    }

    _write(level, message) {
        const line = this._format(level, message);
        
        // Console output
        if (level === 'ERROR') {
            console.error(line);
        } else {
            console.log(line);
        }

        // File output (stream)
        if (logStream) {
            logStream.write(line + '\n');
        } else {
             // Fallback or retry creating stream?
             // Maybe try to re-create if it's null?
             this._ensureStream();
             if (logStream) logStream.write(line + '\n');
        }
    }

    info(msg) { this._write('INFO', msg); }
    warn(msg) { this._write('WARN', msg); }
    error(msg) { this._write('ERROR', msg); }
    debug(msg) { 
        // Uncomment to enable verbose debugging
        // this._write('DEBUG', msg); 
    }

    truncate(str, length = 100) {
        if (!str) return '';
        const s = String(str);
        if (s.length <= length) return s;
        return s.substring(0, length) + '...[truncated]';
    }
}

module.exports = Logger;