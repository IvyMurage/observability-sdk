export interface ProcessErrorHandlerOptions {
  serviceName?: string;
  exitOnUncaught?: boolean;
  exitOnUnhandledRejection?: boolean;
}

export function setupProcessErrorHandlers(options: ProcessErrorHandlerOptions = {}): void {
  const {
    serviceName = process.env.npm_package_name || 'unknown-service',
    exitOnUncaught = true,
    exitOnUnhandledRejection = true,
  } = options;

  const formatError = (type: string, error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    return JSON.stringify({
      level: 'fatal',
      time: Date.now(),
      service_name: serviceName,
      msg: `${type}: ${err.message}`,
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
    });
  };

  process.on('uncaughtException', (error) => {
    process.stderr.write(formatError('uncaught_exception', error) + '\n');
    if (exitOnUncaught) process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    process.stderr.write(formatError('unhandled_rejection', reason) + '\n');
    if (exitOnUnhandledRejection) process.exit(1);
  });
}
