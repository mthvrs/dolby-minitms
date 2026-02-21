const request = require('supertest');

describe('Playback API', () => {
    let app;
    let mockClients;

    beforeEach(() => {
        jest.resetModules(); // Clear module cache to reset soapSessionCache
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {}); // Silence console.error for expected errors

        // Mock config
        jest.mock('../config', () => ({
            THEATERS: {
                'Salle 1': {
                    url: 'http://ims3000.local',
                    type: 'IMS3000'
                },
                'Salle 2': {
                    url: 'http://dcp2000.local',
                    type: 'DCP2000'
                }
            }
        }));

        // Mock clients structure
        mockClients = {
            'Salle 1': {
                session: {
                    request: jest.fn(),
                    ensureLoggedIn: jest.fn().mockResolvedValue(true)
                },
                ensureLoggedIn: jest.fn().mockResolvedValue(true)
            },
            'Salle 2': {
                session: {
                    request: jest.fn(),
                    ensureLoggedIn: jest.fn().mockResolvedValue(true)
                },
                ensureLoggedIn: jest.fn().mockResolvedValue(true)
            }
        };

        jest.mock('../routes/theaters', () => ({
            resolveName: jest.fn((id) => {
                if (id === 'salle-1' || id === 'Salle 1') return 'Salle 1';
                if (id === 'salle-2' || id === 'Salle 2') return 'Salle 2';
                return null;
            }),
            clients: mockClients
        }));

        const express = require('express');
        const playbackRouter = require('../routes/playback');

        app = express();
        app.use(express.json());
        app.use(playbackRouter);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should return 404 if theater is not found', async () => {
        const response = await request(app).get('/api/playback/unknown');
        expect(response.status).toBe(404);
        expect(response.body.error).toBe('Theater not found');
    });

    it('should return playback status for IMS3000', async () => {
        const mockSoapSessionId = '12345678-1234-1234-1234-1234567890ab';
        const client = mockClients['Salle 1'];

        // Mock extractSoapSessionId response (HTML page)
        client.session.request.mockResolvedValueOnce({
            data: `<html><body><script>var uuid = "${mockSoapSessionId}";</script></body></html>`
        });

        // Mock SOAP response
        client.session.request.mockResolvedValueOnce({
            status: 200,
            data: {
                GetShowStatusResponse: {
                    showStatus: {
                        state: 'PLAYING',
                        cpl: 'Test CPL'
                    }
                }
            }
        });

        const response = await request(app).get('/api/playback/salle-1');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.playback.state).toBe('PLAYING');

        // Verify extractSoapSessionId was called
        expect(client.session.request).toHaveBeenNthCalledWith(1,
            'GET',
            '/web/index.php?page=sys_control/cinelister/playback.php',
            null,
            expect.objectContaining({ 'Accept': expect.stringContaining('text/html') })
        );

        // Verify SOAP request was called
        expect(client.session.request).toHaveBeenNthCalledWith(2,
            'POST',
            '/dc/dcp/json/v1/ShowControl',
            expect.stringContaining(`<sessionId>${mockSoapSessionId}</sessionId>`),
            expect.any(Object)
        );
    });

    it('should return playback status for DCP2000', async () => {
        const mockSoapSessionId = '87654321-4321-4321-4321-ba0987654321';
        const client = mockClients['Salle 2'];

        // Mock extractSoapSessionId response (HTML page)
        client.session.request.mockResolvedValueOnce({
            data: `<html><body><script>var uuid = "${mockSoapSessionId}";</script></body></html>`
        });

        // Mock SOAP response
        client.session.request.mockResolvedValueOnce({
            status: 200,
            data: {
                GetShowStatusResponse: {
                    showStatus: {
                        state: 'STOPPED',
                        cpl: 'Another CPL'
                    }
                }
            }
        });

        const response = await request(app).get('/api/playback/salle-2');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.playback.state).toBe('STOPPED');

        // Verify extractSoapSessionId was called with correct URL for DCP2000
        expect(client.session.request).toHaveBeenNthCalledWith(1,
            'GET',
            '/web/sys_control/cinelister/playback.php',
            null,
            expect.objectContaining({ 'Accept': expect.stringContaining('text/html') })
        );
    });

    it('should use cached SOAP session ID on subsequent requests', async () => {
        const mockSoapSessionId = '11111111-2222-3333-4444-555555555555';
        const client = mockClients['Salle 1'];

        // First request - extract ID + SOAP
        client.session.request
            .mockResolvedValueOnce({
                data: `<html>uuid="${mockSoapSessionId}"</html>`
            })
            .mockResolvedValueOnce({
                status: 200,
                data: { GetShowStatusResponse: { showStatus: { state: 'PLAYING' } } }
            });

        await request(app).get('/api/playback/salle-1');

        // Second request - should reuse ID (SOAP only)
        client.session.request.mockResolvedValueOnce({
            status: 200,
            data: { GetShowStatusResponse: { showStatus: { state: 'PAUSED' } } }
        });

        const response = await request(app).get('/api/playback/salle-1');

        expect(response.status).toBe(200);
        expect(response.body.playback.state).toBe('PAUSED');

        // Total calls: 1 extraction + 1 SOAP + 1 SOAP = 3 calls
        expect(client.session.request).toHaveBeenCalledTimes(3);

        // The last call should be the SOAP request, not extraction
        expect(client.session.request).toHaveBeenLastCalledWith(
            'POST',
            '/dc/dcp/json/v1/ShowControl',
            expect.stringContaining(`<sessionId>${mockSoapSessionId}</sessionId>`),
            expect.any(Object)
        );
    });

    it('should retry authentication on SOAP Fault "not authenticated"', async () => {
        const mockSoapSessionId = '22222222-3333-4444-5555-666666666666';
        const client = mockClients['Salle 1'];

        // Step 1: Populate cache
        client.session.request
            .mockResolvedValueOnce({ data: `uuid="${mockSoapSessionId}"` })
            .mockResolvedValueOnce({ status: 200, data: { GetShowStatusResponse: { showStatus: { state: 'OK' } } } });

        await request(app).get('/api/playback/salle-1');

        // Clear mocks to track new calls
        client.session.request.mockClear();

        // Step 2: Fail then succeed
        // Call 1: SOAP request with cached ID -> Fails
        client.session.request.mockResolvedValueOnce({
            data: { Fault: { faultstring: 'not authenticated' } }
        });

        // Recursive retry:
        // Call 2: Extract new ID
        const newSessionId = '33333333-4444-5555-6666-777777777777';
        client.session.request.mockResolvedValueOnce({
            data: `uuid="${newSessionId}"`
        });

        // Call 3: SOAP request with new ID -> Succeeds
        client.session.request.mockResolvedValueOnce({
            status: 200,
            data: { GetShowStatusResponse: { showStatus: { state: 'RECOVERED' } } }
        });

        const response = await request(app).get('/api/playback/salle-1');

        expect(response.status).toBe(200);
        expect(response.body.playback.state).toBe('RECOVERED');
        expect(client.session.request).toHaveBeenCalledTimes(3);
    });

    it('should handle general SOAP faults', async () => {
        const client = mockClients['Salle 1'];

        // Extract ID
        client.session.request.mockResolvedValueOnce({
            data: `uuid="44444444-5555-6666-7777-888888888888"`
        });

        // SOAP Fault
        client.session.request.mockResolvedValueOnce({
            data: { Fault: { faultstring: 'Some other error' } }
        });

        const response = await request(app).get('/api/playback/salle-1');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('SOAP Fault: Some other error');
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Some other error'));
    });

    it('should handle extraction failure', async () => {
        const client = mockClients['Salle 1'];

        // Extraction fails (no UUID found)
        client.session.request.mockResolvedValueOnce({
            data: `<html>No UUID here</html>`
        });

        const response = await request(app).get('/api/playback/salle-1');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Could not extract SOAP session ID');
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Error getting playback status'));
    });
});
