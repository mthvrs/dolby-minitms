const fs = require('fs');
const path = require('path');
// Don't require Logger here because we need to require it fresh in each test/beforeEach
// const Logger = require('../../services/logger');

jest.mock('fs');

describe('Logger Service', () => {
    let logger;
    const mockContext = 'TestContext';
    let mockStream;
    let LoggerClass;

    beforeEach(() => {
        jest.resetModules();

        // Mock stream object
        mockStream = {
            write: jest.fn(),
            on: jest.fn(),
            end: jest.fn()
        };

        // Reset mocks default behavior
        const fs = require('fs');
        fs.existsSync.mockReturnValue(true);
        fs.mkdirSync.mockImplementation(() => {});
        fs.createWriteStream.mockReturnValue(mockStream);

        // Mock console methods
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});

        // Load fresh Logger class
        LoggerClass = require('../../services/logger');
        logger = new LoggerClass(mockContext);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Constructor', () => {
        it('should create a logger with default context if none provided', () => {
            logger = new LoggerClass();
            expect(logger.context).toBe('System');
        });

        it('should create a logger with provided context', () => {
            expect(logger.context).toBe(mockContext);
        });

        it('should create log directory if it does not exist', () => {
            // Need to reset modules to test constructor logic again cleanly
            jest.resetModules();
            const fs = require('fs');
            fs.existsSync.mockReturnValue(false);
            fs.mkdirSync.mockImplementation(() => {});
            fs.createWriteStream.mockReturnValue(mockStream);

            const FreshLogger = require('../../services/logger');
            new FreshLogger(mockContext);

            expect(fs.existsSync).toHaveBeenCalled();
            expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('logs'), { recursive: true });
        });

        it('should create write stream', () => {
            const fs = require('fs');
            expect(fs.createWriteStream).toHaveBeenCalledWith(
                expect.stringContaining('app.log'),
                expect.objectContaining({ flags: 'a', encoding: 'utf8' })
            );
        });
    });

    describe('Logging Methods', () => {
        it('should log info messages to console and stream', () => {
            const message = 'Info message';
            logger.info(message);

            expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`[INFO] ${message}`));
            expect(mockStream.write).toHaveBeenCalledWith(expect.stringContaining(`[INFO] ${message}\n`));
        });

        it('should log warn messages to console and stream', () => {
            const message = 'Warn message';
            logger.warn(message);

            expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`[WARN] ${message}`));
            expect(mockStream.write).toHaveBeenCalled();
        });

        it('should log error messages to console.error and stream', () => {
            const message = 'Error message';
            logger.error(message);

            expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`[ERROR] ${message}`));
            expect(mockStream.write).toHaveBeenCalled();
        });

        it('should not log debug messages', () => {
            const message = 'Debug message';
            logger.debug(message);

            expect(console.log).not.toHaveBeenCalled();
            expect(mockStream.write).not.toHaveBeenCalled();
        });
    });

    describe('Helper Methods', () => {
        it('should truncate long strings', () => {
            const longString = 'a'.repeat(150);
            const truncated = logger.truncate(longString, 10);
            expect(truncated).toBe('aaaaaaaaaa...[truncated]');
        });

        it('should not truncate short strings', () => {
            const shortString = 'short';
            const result = logger.truncate(shortString, 10);
            expect(result).toBe(shortString);
        });

        it('should handle empty or null strings in truncate', () => {
            expect(logger.truncate(null)).toBe('');
            expect(logger.truncate(undefined)).toBe('');
            expect(logger.truncate('')).toBe('');
        });
    });

    describe('Error Handling', () => {
        it('should handle stream creation errors gracefully', () => {
            jest.resetModules();

            const fs = require('fs');
            fs.createWriteStream.mockImplementation(() => {
                throw new Error('Stream error');
            });
            fs.existsSync.mockReturnValue(true);

            const FreshLogger = require('../../services/logger');
            new FreshLogger(mockContext);

            expect(console.error).toHaveBeenCalledWith('Could not create log stream:', expect.any(Error));
        });
    });
});
