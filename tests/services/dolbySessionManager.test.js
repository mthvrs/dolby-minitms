const DolbySessionManager = require('../../services/dolbySessionManager');
const axios = require('axios');
const Logger = require('../../services/logger');

jest.mock('axios');
jest.mock('../../services/logger');

describe('DolbySessionManager', () => {
  let manager;
  let mockLogger;
  let mockAxiosInstance;

  const theaterConfig = {
    url: 'http://example.com',
    username: 'admin',
    password: 'password',
    type: 'IMS3000'
  };

  beforeEach(() => {
    jest.useFakeTimers();
    // Reset mocks
    jest.clearAllMocks();

    // Mock Logger implementation
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      truncate: jest.fn((str) => str),
    };

    // Mock axios instance
    mockAxiosInstance = jest.fn();
    mockAxiosInstance.get = jest.fn();
    mockAxiosInstance.post = jest.fn();
    mockAxiosInstance.defaults = { baseURL: 'http://example.com' };
    axios.create.mockReturnValue(mockAxiosInstance);

    manager = new DolbySessionManager('Test Theater', theaterConfig, mockLogger);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    test('should initialize correctly', () => {
      expect(manager.name).toBe('Test Theater');
      expect(manager.config).toBe(theaterConfig);
      expect(manager.logger).toBe(mockLogger);
      expect(manager.isLoggedIn).toBe(false);
      expect(manager.sessionId).toBeNull();
      expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({
        baseURL: theaterConfig.url,
        withCredentials: false,
        maxRedirects: 0,
      }));
    });
  });

  describe('parseCookies', () => {
    test('should parse a single cookie string', () => {
      manager.parseCookies('PHPSESSID=12345; path=/');
      expect(manager.cookies['PHPSESSID']).toBe('12345');
      expect(manager.sessionId).toBe('12345');
    });

    test('should parse an array of cookie strings', () => {
      manager.parseCookies(['PHPSESSID=12345; path=/', 'other=value; path=/']);
      expect(manager.cookies['PHPSESSID']).toBe('12345');
      expect(manager.cookies['other']).toBe('value');
    });

    test('should handle missing set-cookie header', () => {
      manager.parseCookies(undefined);
      expect(manager.cookies).toEqual({});
    });
  });

  describe('isLoginPage', () => {
    test('should detect login page by attr-page="login"', () => {
      expect(manager.isLoginPage('<div attr-page="login"></div>')).toBe(true);
    });

    test('should detect login page by name="loginForm"', () => {
      expect(manager.isLoginPage('<form name="loginForm"></form>')).toBe(true);
    });

    test('should return false for non-login page', () => {
      expect(manager.isLoginPage('<div>Welcome</div>')).toBe(false);
    });

    test('should return false for invalid input', () => {
      expect(manager.isLoginPage(null)).toBe(false);
      expect(manager.isLoginPage(123)).toBe(false);
    });
  });

  describe('login', () => {
    test('should attempt IMS3000 login first if type is IMS3000', async () => {
      // Mock IMS3000 login success
      mockAxiosInstance.post.mockResolvedValueOnce({
        status: 302,
        headers: {
          'set-cookie': ['PHPSESSID=ims_session'],
          'location': 'index.php'
        },
        data: ''
      });

      mockAxiosInstance.get.mockResolvedValueOnce({
          status: 200,
          headers: { 'set-cookie': ['PHPSESSID=ims_session_2'] },
          data: '<html>index</html>'
      });

      const result = await manager.login();

      expect(result).toBe(true);
      expect(manager.isLoggedIn).toBe(true);
      expect(manager.detectedType).toBe('IMS3000');
      expect(manager.sessionId).toBe('ims_session_2');
      // Ensure startPolling is called (mocking setInterval might be needed but for now we check if function completes)
    });

    test('should fallback to DCP2000 if IMS3000 fails', async () => {
       // IMS3000 fail
       mockAxiosInstance.post.mockResolvedValueOnce({
           status: 200,
           headers: {},
           data: '<form name="loginForm"></form>' // Login page returned
       });

       // DCP2000 success
       mockAxiosInstance.post.mockResolvedValueOnce({
           status: 302,
           headers: {
               'set-cookie': ['PHPSESSID=dcp_session'],
               'location': '/web/index.php' // Not login page
           },
           data: ''
       });

       mockAxiosInstance.get.mockResolvedValueOnce({
           status: 200,
           headers: {},
           data: '<html>index</html>'
       });

       const result = await manager.login();

       expect(result).toBe(true);
       expect(manager.detectedType).toBe('DCP2000');
    });
  });

  describe('ensureLoggedIn', () => {
    test('should return true if already logged in and session exists', async () => {
      manager.isLoggedIn = true;
      manager.sessionId = '123';
      const result = await manager.ensureLoggedIn();
      expect(result).toBe(true);
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    test('should call login if not logged in', async () => {
      manager.isLoggedIn = false;
      // Mock login to succeed
      jest.spyOn(manager, 'login').mockResolvedValue(true);
      const result = await manager.ensureLoggedIn();
      expect(result).toBe(true);
      expect(manager.login).toHaveBeenCalled();
    });
  });

  describe('checkSystemStatus', () => {
     test('should return true if system status is OK', async () => {
         manager.sessionId = 'valid_session';
         mockAxiosInstance.post.mockResolvedValue({
             status: 200,
             headers: {},
             data: { GetSystemStatusResponse: {} }
         });

         const result = await manager.checkSystemStatus();
         expect(result).toBe(true);
     });

     test('should return false if session is missing', async () => {
         manager.sessionId = null;
         const result = await manager.checkSystemStatus();
         expect(result).toBe(false);
     });

     test('should return false on error', async () => {
         manager.sessionId = 'valid_session';
         mockAxiosInstance.post.mockRejectedValue(new Error('Network Error'));

         const result = await manager.checkSystemStatus();
         expect(result).toBe(false);
     });
  });

  describe('performHealthCheck', () => {
    test('should reconnect if system is down', async () => {
      manager.isLoggedIn = true;
      manager.checkSystemStatus = jest.fn().mockResolvedValue(false);
      manager.login = jest.fn().mockResolvedValue(true);

      await manager.performHealthCheck();

      expect(manager.checkSystemStatus).toHaveBeenCalled();
      expect(manager.logger.warn).toHaveBeenCalledWith('Health check failed. Auto-reconnecting...');
      expect(manager.isLoggedIn).toBe(false);
      expect(manager.login).toHaveBeenCalled();
    });

    test('should do nothing if system is up', async () => {
      manager.isLoggedIn = true;
      manager.checkSystemStatus = jest.fn().mockResolvedValue(true);
      manager.login = jest.fn();

      await manager.performHealthCheck();

      expect(manager.checkSystemStatus).toHaveBeenCalled();
      expect(manager.login).not.toHaveBeenCalled();
    });

    test('should do nothing if not logged in', async () => {
      manager.isLoggedIn = false;
      manager.checkSystemStatus = jest.fn();

      await manager.performHealthCheck();

      expect(manager.checkSystemStatus).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
      test('should clear session and cookies', async () => {
          manager.sessionId = '123';
          manager.isLoggedIn = true;
          manager.detectedType = 'IMS3000';

          mockAxiosInstance.get.mockResolvedValue({ status: 200 });

          await manager.logout();

          expect(manager.sessionId).toBeNull();
          expect(manager.cookies).toEqual({});
          expect(manager.isLoggedIn).toBe(false);
          expect(manager.detectedType).toBeNull();
      });
  });

  describe('request', () => {
      test('should make a request with correct headers', async () => {
          manager.isLoggedIn = true;
          manager.sessionId = '123';
          manager.cookies = { 'PHPSESSID': '123' };

          mockAxiosInstance.mockResolvedValue({
              status: 200,
              headers: {},
              data: 'ok'
          });

          await manager.request('GET', '/api/test');

          expect(mockAxiosInstance).toHaveBeenCalledWith(expect.objectContaining({
              method: 'GET',
              url: '/api/test',
              headers: expect.objectContaining({
                  'Cookie': 'PHPSESSID=123'
              })
          }));
      });

      test('should detect session invalidation', async () => {
          manager.isLoggedIn = true;
          manager.sessionId = '123';

          mockAxiosInstance.mockResolvedValue({
              status: 200,
              headers: {},
              data: '<form name="loginForm"></form>'
          });

          await manager.request('GET', '/api/test');

          expect(manager.isLoggedIn).toBe(false);
          expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Session invalidated'));
      });
  });
});
