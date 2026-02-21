const DolbySessionManager = require('./dolbySessionManager');
const axios = require('axios');

// Mock axios
jest.mock('axios');

describe('DolbySessionManager', () => {
  let sessionManager;
  let mockLogger;

  const theaterConfig = {
    url: 'http://example.com',
    username: 'admin',
    password: 'password',
    type: 'IMS3000'
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      truncate: jest.fn((str, len) => {
        if (!str) return '';
        if (str.length <= len) return str;
        return str.substring(0, len) + '...';
      }),
    };

    // Setup mock axios instance
    const mockAxiosInstance = jest.fn();
    axios.create.mockReturnValue(mockAxiosInstance);

    sessionManager = new DolbySessionManager('TestTheater', theaterConfig, mockLogger);
  });

  describe('parseCookies', () => {
    test('should do nothing if setCookieHeader is undefined', () => {
      sessionManager.parseCookies(undefined);
      expect(sessionManager.cookies).toEqual({});
      expect(sessionManager.sessionId).toBeNull();
    });

    test('should do nothing if setCookieHeader is null', () => {
      sessionManager.parseCookies(null);
      expect(sessionManager.cookies).toEqual({});
      expect(sessionManager.sessionId).toBeNull();
    });

    test('should parse a single cookie string correctly', () => {
      const cookieHeader = 'JSESSIONID=12345abcde; Path=/; HttpOnly';
      sessionManager.parseCookies(cookieHeader);

      expect(sessionManager.cookies).toEqual({
        'JSESSIONID': '12345abcde'
      });
      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Cookie updated: JSESSIONID=12345abcde'));
    });

    test('should parse an array of cookie strings', () => {
      const cookieHeader = [
        'JSESSIONID=12345abcde; Path=/',
        'other_cookie=some_value; Secure'
      ];
      sessionManager.parseCookies(cookieHeader);

      expect(sessionManager.cookies).toEqual({
        'JSESSIONID': '12345abcde',
        'other_cookie': 'some_value'
      });
    });

    test('should extract PHPSESSID and set sessionId property', () => {
      const cookieHeader = 'PHPSESSID=session_id_value; path=/';
      sessionManager.parseCookies(cookieHeader);

      expect(sessionManager.cookies['PHPSESSID']).toBe('session_id_value');
      expect(sessionManager.sessionId).toBe('session_id_value');
    });

    test('should update existing cookies', () => {
      // Set initial cookie
      sessionManager.cookies = { 'test_key': 'old_value' };

      const cookieHeader = 'test_key=new_value; Path=/';
      sessionManager.parseCookies(cookieHeader);

      expect(sessionManager.cookies['test_key']).toBe('new_value');
    });

    test('should handle malformed cookie strings gracefully', () => {
      const cookieHeader = ['valid=cookie', 'malformed_cookie_string'];
      sessionManager.parseCookies(cookieHeader);

      expect(sessionManager.cookies).toEqual({
        'valid': 'cookie'
      });
    });

    test('should trim keys and values', () => {
      const cookieHeader = '  key  =  value  ; Path=/';
      sessionManager.parseCookies(cookieHeader);

      expect(sessionManager.cookies).toEqual({
        'key': 'value'
      });
    });

    test('should handle cookie value containing equals sign', () => {
      // The current implementation uses match(/([^=]+)=([^;]*)/)
      // This regex captures key (everything up to first =) and value (everything after first = up to ;)
      // Let's verify if it handles values with = correctly.
      // Based on regex: ([^=]+) matches key. = matches the first =. ([^;]*) matches the rest.
      // So key=val=ue; should result in key="key", value="val=ue"

      const cookieHeader = 'auth_token=abc=def; Path=/';
      sessionManager.parseCookies(cookieHeader);

      expect(sessionManager.cookies).toEqual({
        'auth_token': 'abc=def'
      });
    });
  });
});
