import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrismaClient, PrismaClient } from '@compensation/database';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private _client: PrismaClient;

  constructor(private readonly configService: ConfigService) {
    const databaseUrl = this.configService.get<string>('DATABASE_URL');
    this._client = createPrismaClient(databaseUrl);
  }

  get client(): PrismaClient {
    return this._client;
  }

  async onModuleInit(): Promise<void> {
    await this.connectWithRetry();
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing database connections...');
    try {
      await this._client.$disconnect();
      this.logger.log('Database disconnected successfully');
    } catch (error) {
      this.logger.error('Error disconnecting from database', error);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this._client.$queryRawUnsafe('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private async connectWithRetry(): Promise<void> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this._client.$connect();
        this.logger.log('Database connected successfully');
        return;
      } catch (error) {
        if (attempt === MAX_RETRIES) {
          this.logger.error(
            `Failed to connect to database after ${MAX_RETRIES} attempts`,
            error,
          );
          throw error;
        }
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        this.logger.warn(
          `Database connection attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${delay}ms...`,
        );
        await this.sleep(delay);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

