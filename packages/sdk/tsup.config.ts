import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/standalone.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'node18',
  external: [
    '@nestjs/common',
    '@nestjs/core',
    'reflect-metadata',
    'rxjs',
    'ioredis',
    'kafkajs',
    'mysql2',
    'pg',
    '@opentelemetry/instrumentation-ioredis',
    '@opentelemetry/instrumentation-kafkajs',
    '@opentelemetry/instrumentation-mysql2',
    '@opentelemetry/instrumentation-pg',
  ],
});
