const { expect } = require('chai');
const proxyquire = require('proxyquire');
const { slugify } = require('../utils');

describe('WebRTC Gateway Service', function() {
    let webrtcGateway;

    before(function() {
        class MockLogger {
            constructor(context) {}
            info(msg) {}
            warn(msg) {}
            error(msg) {}
            debug(msg) {}
        }

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

    describe('ensureRunning() / stop()', function() {
        it('should export ensureRunning as a function', function() {
            expect(webrtcGateway.ensureRunning).to.be.a('function');
        });

        it('should export stop as a function', function() {
            expect(webrtcGateway.stop).to.be.a('function');
        });

        it('should NOT export slugify (moved to utils.js)', function() {
            expect(webrtcGateway.slugify).to.be.undefined;
        });
    });
});

// slugify is now in utils.js — test it there
describe('slugify utility (utils.js)', function() {
    it('should convert spaces to hyphens', function() {
        expect(slugify('Salle 1')).to.equal('salle-1');
    });

    it('should convert mixed case to lowercase', function() {
        expect(slugify('Mixed Case')).to.equal('mixed-case');
    });

    it('should handle multiple spaces', function() {
        expect(slugify('  Multiple   Spaces  ')).to.equal('-multiple-spaces-');
    });

    it('should return empty string for empty input', function() {
        expect(slugify('')).to.equal('');
    });

    it('should handle numbers by converting to string', function() {
        expect(slugify(123)).to.equal('123');
    });

    it('should handle special characters', function() {
        expect(slugify('hello@world!')).to.equal('hello@world!');
    });

    it('should handle null and undefined', function() {
        expect(slugify(null)).to.equal('null');
        expect(slugify(undefined)).to.equal('undefined');
    });
});
