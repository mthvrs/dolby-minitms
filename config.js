module.exports = {
    PORT: 8347,
    
    THEATERS: {
        'Salle 1': {
            url: 'http://10.98.156.12',
            stream: 'rtsp://admin:Password@10.98.156.15:554/Streaming/Channels/1',
            username: 'admin',
            password: '1234',
            type: 'IMS3000'
        },
        'Salle 2': {
            url: 'http://10.98.156.22',
            stream: 'rtsp://admin:Password@10.98.156.25:554/Streaming/Channels/1',
            username: 'admin',
            password: '1234',
            type: 'DCP2000'
        },
        'Salle 3': {
            url: 'http://10.98.156.32',
            stream: 'rtsp://admin:Password@10.98.156.35:554/Streaming/Channels/1',
            username: 'admin',
            password: '1234',
            type: 'DCP2000'
        }
    },
    
    TIMEOUTS: {
        http: 5000,
        checkInterval: 30000
    }
};