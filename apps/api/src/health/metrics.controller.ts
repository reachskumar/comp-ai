import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { MetricsService } from '../common/services/metrics.service';

@ApiTags('metrics')
@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Prometheus metrics endpoint' })
  getMetrics(@Res() reply: FastifyReply) {
    const body = this.metrics.toPrometheus();
    void reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(body);
  }
}
