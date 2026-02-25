import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  getHealth() {
    return this.healthService.check();
  }

  @Get('deep')
  @ApiOperation({ summary: 'Deep health check — tests DB and Redis connectivity' })
  getDeepHealth() {
    return this.healthService.deepCheck();
  }
}

