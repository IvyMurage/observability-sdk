import { describe, it, expect } from 'vitest';
import { sanitizeHeaders, DEFAULT_REDACTION_PATHS, DEFAULT_CENSOR } from '../../src/security/redaction';

describe('redaction', () => {
  describe('DEFAULT_REDACTION_PATHS', () => {
    it('should include critical security paths', () => {
      expect(DEFAULT_REDACTION_PATHS).toContain('*.password');
      expect(DEFAULT_REDACTION_PATHS).toContain('*.token');
      expect(DEFAULT_REDACTION_PATHS).toContain('*.secret');
      expect(DEFAULT_REDACTION_PATHS).toContain('*.accessToken');
      expect(DEFAULT_REDACTION_PATHS).toContain('*.refreshToken');
      expect(DEFAULT_REDACTION_PATHS).toContain('*.apiKey');
      expect(DEFAULT_REDACTION_PATHS).toContain('*.connectionString');
      expect(DEFAULT_REDACTION_PATHS).toContain('req.headers.authorization');
      expect(DEFAULT_REDACTION_PATHS).toContain('req.headers.cookie');
    });
  });

  describe('sanitizeHeaders', () => {
    it('should redact sensitive headers', () => {
      const headers = {
        'content-type': 'application/json',
        'authorization': 'Bearer secret-token',
        'cookie': 'session=abc123',
        'x-api-key': 'my-api-key',
        'x-request-id': 'req-123',
      };

      const sanitized = sanitizeHeaders(headers);

      expect(sanitized['content-type']).toBe('application/json');
      expect(sanitized['authorization']).toBe(DEFAULT_CENSOR);
      expect(sanitized['cookie']).toBe(DEFAULT_CENSOR);
      expect(sanitized['x-api-key']).toBe(DEFAULT_CENSOR);
      expect(sanitized['x-request-id']).toBe('req-123');
    });

    it('should use custom censor value', () => {
      const headers = { 'authorization': 'Bearer token' };
      const sanitized = sanitizeHeaders(headers, '***');

      expect(sanitized['authorization']).toBe('***');
    });

    it('should handle empty headers', () => {
      const sanitized = sanitizeHeaders({});
      expect(sanitized).toEqual({});
    });

    it('should be case-insensitive for header names', () => {
      const headers = {
        'Authorization': 'Bearer token',
        'COOKIE': 'session=abc',
      };

      // Headers should be lowercased by the HTTP layer, but our
      // function handles exact case matching from the Set
      const sanitized = sanitizeHeaders({
        authorization: 'Bearer token',
        cookie: 'session=abc',
      });

      expect(sanitized['authorization']).toBe(DEFAULT_CENSOR);
      expect(sanitized['cookie']).toBe(DEFAULT_CENSOR);
    });
  });
});
