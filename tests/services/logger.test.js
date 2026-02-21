const Logger = require('../../services/logger');

describe('Logger.truncate', () => {
    // Helper to call truncate without an instance to avoid side effects
    const truncate = (str, length) => Logger.prototype.truncate.call(null, str, length);

    describe('Basic functionality', () => {
        test('should return empty string for null', () => {
            expect(truncate(null)).toBe('');
        });

        test('should return empty string for undefined', () => {
            expect(truncate(undefined)).toBe('');
        });

        test('should return empty string for empty string', () => {
            expect(truncate('')).toBe('');
        });

        test('should return empty string for 0 (falsy check)', () => {
            expect(truncate(0)).toBe('');
        });

        test('should return the string as is if shorter than length', () => {
            expect(truncate('hello', 10)).toBe('hello');
        });

        test('should return the string as is if equal to length', () => {
            expect(truncate('hello', 5)).toBe('hello');
        });

        test('should truncate string and append suffix if longer than length', () => {
            expect(truncate('hello world', 5)).toBe('hello...[truncated]');
        });
    });

    describe('Default parameters', () => {
        test('should use default length of 100', () => {
            const longStr = 'a'.repeat(101);
            const expected = 'a'.repeat(100) + '...[truncated]';
            expect(truncate(longStr)).toBe(expected);

            const boundaryStr = 'a'.repeat(100);
            expect(truncate(boundaryStr)).toBe(boundaryStr);
        });
    });

    describe('Edge cases', () => {
        test('should handle non-string inputs (numbers) by converting to string', () => {
            // Note: 0 is handled by falsy check, returning empty string
            expect(truncate(123456, 3)).toBe('123...[truncated]');
            expect(truncate(123, 3)).toBe('123');
        });

        test('should handle negative length by treating it as 0', () => {
            expect(truncate('hello', -1)).toBe('...[truncated]');
        });
    });
});
