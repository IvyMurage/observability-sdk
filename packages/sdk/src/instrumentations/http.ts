import { HttpInstrumentation as OtelHttpInstrumentation } from '@opentelemetry/instrumentation-http';
import type { InstrumentationPlugin } from '../core/types';

export interface HttpInstrumentationOptions {
  ignoreIncomingPaths?: (string | RegExp)[];
  ignoreOutgoingUrls?: (string | RegExp)[];
}

export function httpInstrumentation(options?: HttpInstrumentationOptions): InstrumentationPlugin {
  return {
    name: 'http',
    otelInstrumentation() {
      return new OtelHttpInstrumentation({
        ignoreIncomingRequestHook: options?.ignoreIncomingPaths
          ? (req) => {
              const url = req.url || '';
              return options.ignoreIncomingPaths!.some((p) =>
                typeof p === 'string' ? url === p : p.test(url),
              );
            }
          : undefined,
        ignoreOutgoingRequestHook: options?.ignoreOutgoingUrls
          ? (opts) => {
              const url = `${opts.hostname || ''}${opts.path || ''}`;
              return options.ignoreOutgoingUrls!.some((p) =>
                typeof p === 'string' ? url.includes(p) : p.test(url),
              );
            }
          : undefined,
      });
    },
  };
}
