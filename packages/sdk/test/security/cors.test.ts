import { describe, it, expect } from 'vitest';
import { createCorsOptions } from '../../src/security/cors';

describe('createCorsOptions', () => {
  const whitelist = ['https://app.example.com', 'https://admin.example.com'];

  it('should allow requests with no origin (server-to-server)', () => {
    const cors = createCorsOptions(whitelist);

    return new Promise<void>((resolve) => {
      cors.origin(undefined, (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);
        resolve();
      });
    });
  });

  it('should allow whitelisted origins', () => {
    const cors = createCorsOptions(whitelist);

    return new Promise<void>((resolve) => {
      cors.origin('https://app.example.com', (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);
        resolve();
      });
    });
  });

  it('should reject non-whitelisted origins', () => {
    const cors = createCorsOptions(whitelist);

    return new Promise<void>((resolve) => {
      cors.origin('https://evil.com', (err, allow) => {
        expect(err).toBeInstanceOf(Error);
        expect(err!.message).toContain('evil.com');
        expect(err!.message).toContain('CORS');
        resolve();
      });
    });
  });

  it('should use default methods and credentials', () => {
    const cors = createCorsOptions(whitelist);
    expect(cors.methods).toBe('GET,HEAD,PUT,PATCH,POST,DELETE');
    expect(cors.credentials).toBe(true);
  });

  it('should allow overriding methods and credentials', () => {
    const cors = createCorsOptions(whitelist, {
      methods: 'GET,POST',
      credentials: false,
    });
    expect(cors.methods).toBe('GET,POST');
    expect(cors.credentials).toBe(false);
  });

  it('should work with empty whitelist (only server-to-server allowed)', () => {
    const cors = createCorsOptions([]);

    return new Promise<void>((resolve) => {
      cors.origin(undefined, (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);

        cors.origin('https://anything.com', (err2) => {
          expect(err2).toBeInstanceOf(Error);
          resolve();
        });
      });
    });
  });
});
