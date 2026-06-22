import type { InstrumentationPlugin } from '../core/types';

export function redisInstrumentation(): InstrumentationPlugin {
  return {
    name: 'redis',
    otelInstrumentation() {
      try {
        const mod = require('@opentelemetry/instrumentation-ioredis');
        return new mod.IORedisInstrumentation();
      } catch {
        console.debug(
          '[observability] Install @opentelemetry/instrumentation-ioredis for Redis tracing',
        );
        return null;
      }
    },
  };
}
