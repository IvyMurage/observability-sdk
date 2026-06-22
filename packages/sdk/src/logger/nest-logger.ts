import { LoggerService } from '@nestjs/common';
import { ObservabilityLogger } from './logger.service';

export class NestPinoLogger implements LoggerService {
  constructor(private logger: ObservabilityLogger) {}

  log(message: string, ...optionalParams: unknown[]): void {
    this.logger.info(message, this.extractMeta(optionalParams));
  }

  error(message: string, ...optionalParams: unknown[]): void {
    const meta = this.extractMeta(optionalParams);
    if (optionalParams[0] instanceof Error) {
      meta.err = optionalParams[0];
    }
    this.logger.error(message, meta);
  }

  warn(message: string, ...optionalParams: unknown[]): void {
    this.logger.warn(message, this.extractMeta(optionalParams));
  }

  debug(message: string, ...optionalParams: unknown[]): void {
    this.logger.debug(message, this.extractMeta(optionalParams));
  }

  verbose(message: string, ...optionalParams: unknown[]): void {
    this.logger.debug(message, this.extractMeta(optionalParams));
  }

  fatal(message: string, ...optionalParams: unknown[]): void {
    this.logger.fatal(message, this.extractMeta(optionalParams));
  }

  private extractMeta(params: unknown[]): Record<string, unknown> {
    const last = params[params.length - 1];
    if (typeof last === 'string') {
      return { context: last };
    }
    if (typeof last === 'object' && last !== null && !(last instanceof Error)) {
      return last as Record<string, unknown>;
    }
    return {};
  }
}
