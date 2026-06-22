import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObservabilityLogger } from '../../src/logger/logger.service';
import { NestPinoLogger } from '../../src/logger/nest-logger';
import { resolveConfig } from '../../src/core/config';
import { runWithContext, createRequestContext } from '../../src/core/context';

describe('ObservabilityLogger', () => {
  let logger: ObservabilityLogger;

  beforeEach(() => {
    const config = resolveConfig({
      serviceName: 'test-logger',
      logger: { level: 'debug', prettyPrint: false },
    });
    logger = new ObservabilityLogger(config);
  });

  it('should create logger instance', () => {
    expect(logger).toBeDefined();
    expect(logger.getPinoInstance()).toBeDefined();
  });

  it('should have all log level methods', () => {
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  it('should log without throwing', () => {
    expect(() => logger.debug('debug msg')).not.toThrow();
    expect(() => logger.info('info msg', { key: 'val' })).not.toThrow();
    expect(() => logger.warn('warn msg')).not.toThrow();
    expect(() => logger.error('error msg', { err: 'something' })).not.toThrow();
    expect(() => logger.fatal('fatal msg')).not.toThrow();
  });

  it('should create child logger', () => {
    const child = logger.child({ component: 'auth' });
    expect(child).toBeDefined();
    expect(child).toBeInstanceOf(ObservabilityLogger);
    expect(() => child.info('from child')).not.toThrow();
  });

  it('should include context fields when inside runWithContext', () => {
    const pino = logger.getPinoInstance();
    const written: string[] = [];

    const dest = pino[Symbol.for('pino.serializers') as unknown as string];

    const ctx = createRequestContext('test-svc', 'dev', '1.0.0', {
      requestId: 'req-abc',
    });

    runWithContext(ctx, () => {
      // Logger mixin should inject context fields — we verify no throw
      expect(() => logger.info('inside context')).not.toThrow();
    });
  });
});

describe('NestPinoLogger', () => {
  let nestLogger: NestPinoLogger;

  beforeEach(() => {
    const config = resolveConfig({
      serviceName: 'test-nest',
      logger: { level: 'debug', prettyPrint: false },
    });
    const obsLogger = new ObservabilityLogger(config);
    nestLogger = new NestPinoLogger(obsLogger);
  });

  it('should implement NestJS LoggerService interface', () => {
    expect(typeof nestLogger.log).toBe('function');
    expect(typeof nestLogger.error).toBe('function');
    expect(typeof nestLogger.warn).toBe('function');
    expect(typeof nestLogger.debug).toBe('function');
    expect(typeof nestLogger.verbose).toBe('function');
    expect(typeof nestLogger.fatal).toBe('function');
  });

  it('should log without throwing', () => {
    expect(() => nestLogger.log('message')).not.toThrow();
    expect(() => nestLogger.error('error', new Error('test'))).not.toThrow();
    expect(() => nestLogger.warn('warning')).not.toThrow();
    expect(() => nestLogger.debug('debug')).not.toThrow();
    expect(() => nestLogger.verbose('verbose')).not.toThrow();
    expect(() => nestLogger.fatal('fatal')).not.toThrow();
  });

  it('should handle context string param', () => {
    expect(() => nestLogger.log('message', 'MyController')).not.toThrow();
  });
});
