const fs = require('fs');
const path = require('path');

class Logger {
    constructor(context) {
        this.context = context || 'System';
        
        // Logs are stored in /logs relative to project root
        this.logDir = path.join(__dirname, '..', 'logs');
        this.logFile = path.join(this.logDir, 'app.log');

        this._ensureLogDir();
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

        // File output (append)
        try {
            fs.appendFileSync(this.logFile, line + '\n', 'utf8');
        } catch (e) {
            // Fail silently on file write to avoid crash loops
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