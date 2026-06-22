import { Module } from '@nestjs/common';
import {
  ObservabilityModule,
  ObservabilityHealthModule,
  httpInstrumentation,
} from '@brdrwanda/observability';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'example-service',
      logger: { level: 'debug' },
      tracing: {
        exporter: { type: 'otlp-http', endpoint: 'http://localhost:4318' },
        sampling: { ratio: 1 },
      },
      metrics: { prefix: 'example' },
      instrumentations: [
        httpInstrumentation({ ignoreIncomingPaths: ['/health', '/metrics'] }),
      ],
    }),
    ObservabilityHealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
