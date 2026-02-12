import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrismaClient, PrismaClient } from '@compensation/database';

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
    try {
      await this._client.$connect();
      this.logger.log('Database connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to database', error);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this._client.$disconnect();
    this.logger.log('Database disconnected');
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this._client.$queryRawUnsafe('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}

