import type { InstrumentationPlugin } from '../core/types';

export function mysqlInstrumentation(): InstrumentationPlugin {
  return {
    name: 'mysql',
    otelInstrumentation() {
      try {
        const mod = require('@opentelemetry/instrumentation-mysql2');
        return new mod.MySQL2Instrumentation();
      } catch {
        console.debug(
          '[observability] Install @opentelemetry/instrumentation-mysql2 for MySQL tracing',
        );
        return null;
      }
    },
  };
}
