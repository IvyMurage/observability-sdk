import { Injectable } from '@nestjs/common';
import { ObservabilityLogger, Span } from '@brdrwanda/observability';

@Injectable()
export class AppService {
  constructor(private logger: ObservabilityLogger) {}

  getHello(): string {
    this.logger.info('hello endpoint hit');
    return 'Hello World!';
  }

  @Span('get-user')
  getUser(id: string) {
    this.logger.info('fetching user', { userId: id });
    return { id, name: 'Jane Doe', email: 'jane@example.com' };
  }
}
