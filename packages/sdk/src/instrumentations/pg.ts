import type { InstrumentationPlugin } from '../core/types';

export function pgInstrumentation(): InstrumentationPlugin {
  return {
    name: 'pg',
    otelInstrumentation() {
      try {
        const mod = require('@opentelemetry/instrumentation-pg');
        return new mod.PgInstrumentation();
      } catch {
        console.debug(
          '[observability] Install @opentelemetry/instrumentation-pg for PostgreSQL tracing',
        );
        return null;
      }
    },
  };
}
