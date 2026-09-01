/**
 * CORS options factory that ensures server-to-server requests
 * (Prometheus scrapes, health checks, curl, k8s probes) are never blocked.
 *
 * Requests without an `Origin` header are always allowed — these come from
 * non-browser clients that don't send Origin. Without this check, Prometheus
 * gets 500 errors when scraping `/metrics`.
 *
 * @example
 * ```typescript
 * import { createCorsOptions } from '@ivymurage/observability';
 *
 * const whitelist = process.env.CORS_ORIGIN_WHITELIST?.split(';') ?? [];
 * app.enableCors(createCorsOptions(whitelist));
 * ```
 */

export interface CorsFactoryOptions {
  /** HTTP methods to allow. Default: 'GET,HEAD,PUT,PATCH,POST,DELETE' */
  methods?: string;
  /** Allow credentials (cookies, authorization headers). Default: true */
  credentials?: boolean;
}

export interface CorsResult {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void;
  methods: string;
  credentials: boolean;
}

export function createCorsOptions(
  whitelist: string[],
  options?: CorsFactoryOptions,
): CorsResult {
  const allowedOrigins = new Set(whitelist);

  return {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // No origin = server-to-server (Prometheus, k8s probes, curl, health checks)
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`${origin} is not allowed by CORS policy`));
      }
    },
    methods: options?.methods ?? 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: options?.credentials ?? true,
  };
}
