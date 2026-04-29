/**
 * Phase 5.5 — Public share-token redeemer.
 *
 * Lives outside the JWT/Tenant guards: the token IS the credential. Returns
 * the auditor or defensibility PDF for the bound run. Auditor + tenant view
 * the token's accessCount + lastAccessedAt via the dashboard.
 */
import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FastifyReply } from 'fastify';
import { PEDistributionService } from './pe-distribution.service';

@ApiTags('pay-equity-share')
@Controller('pe-share')
export class PEShareController {
  constructor(private readonly distribution: PEDistributionService) {}

  @Get(':token')
  @ApiOperation({
    summary:
      'Redeem a Pay Equity share token. Public route — no JWT required. The token itself is the credential. Returns the auditor or defensibility PDF bound to the token.',
  })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async resolve(@Param('token') token: string, @Res() reply: FastifyReply) {
    const { buffer, filename, mimeType } = await this.distribution.resolveShareToken(token);
    void reply
      .header('Content-Type', mimeType)
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Length', buffer.length)
      .send(buffer);
  }
}
