export const DEFAULT_CENSOR = '[REDACTED]';

export const DEFAULT_REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  '*.password',
  '*.secret',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.access_token',
  '*.refresh_token',
  '*.apiKey',
  '*.api_key',
  '*.connectionString',
  '*.connection_string',
  '*.creditCard',
  '*.credit_card',
  '*.ssn',
];

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
]);

export function sanitizeHeaders(
  headers: Record<string, string | string[] | undefined>,
  censor: string = DEFAULT_CENSOR,
): Record<string, string | string[] | undefined> {
  const sanitized: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    sanitized[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? censor : value;
  }
  return sanitized;
}
