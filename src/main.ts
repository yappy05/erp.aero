import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { ConfigService } from '@nestjs/config';
import { getCorsConfig } from './config/cors.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const logger = new Logger(AppModule.name);

  const config = app.get(ConfigService);

  app.enableCors(getCorsConfig(config));

  app.useGlobalPipes(new ValidationPipe());
  app.use(cookieParser(config.getOrThrow<string>('COOKIES_SECRET')));

  const port = config.getOrThrow<string>('HTTP_PORT');
  const host = config.getOrThrow<string>('HTTP_HOST');

  try {
    await app.listen(port);
    logger.log(`Server is running at: ${host}`);
  } catch (error) {
    logger.error(`Failed to start server: ${error}`);
  }
}

bootstrap();
