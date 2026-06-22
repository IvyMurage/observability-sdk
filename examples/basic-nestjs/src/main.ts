import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestPinoLogger } from '@brdrwanda/observability';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const logger = app.get(NestPinoLogger);
  app.useLogger(logger);

  await app.listen(3001);
}
bootstrap();
