const { expect } = require('chai');
const proxyquire = require('proxyquire');

describe('WebRTC Gateway Service', function() {
    let webrtcGateway;

    before(function() {
        // Mock Logger class
        class MockLogger {
            constructor(context) {}
            info(msg) {}
            warn(msg) {}
            error(msg) {}
            debug(msg) {}
        }

        // Mock dependencies
        webrtcGateway = proxyquire('../services/webrtcGateway', {
            './logger': MockLogger,
            'fs': {
                existsSync: () => true,
                chmodSync: () => {},
                mkdirSync: () => {}
            },
            'child_process': {
                spawn: () => ({
                    stdout: { on: () => {} },
                    stderr: { on: () => {} },
                    on: () => {},
                    kill: () => {}
                })
            }
        });
    });

    describe('slugify()', function() {
        it('should convert spaces to hyphens', function() {
            expect(webrtcGateway.slugify('Salle 1')).to.equal('salle-1');
        });

        it('should convert mixed case to lowercase', function() {
            expect(webrtcGateway.slugify('Mixed Case')).to.equal('mixed-case');
        });

        it('should handle multiple spaces', function() {
            // Documenting current behavior: replaces each sequence of spaces with a single hyphen
            expect(webrtcGateway.slugify('  Multiple   Spaces  ')).to.equal('-multiple-spaces-');
        });

        it('should return empty string for empty input', function() {
            expect(webrtcGateway.slugify('')).to.equal('');
        });

        it('should handle numbers by converting to string', function() {
            expect(webrtcGateway.slugify(123)).to.equal('123');
        });

        it('should handle special characters', function() {
            expect(webrtcGateway.slugify('hello@world!')).to.equal('hello@world!');
        });

        it('should handle null and undefined', function() {
             expect(webrtcGateway.slugify(null)).to.equal('null');
             expect(webrtcGateway.slugify(undefined)).to.equal('undefined');
        });
    });
});
