import { Controller, Get, UseGuards, Res } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';

@ApiTags('csrf')
@Controller('csrf')
export class CsrfController {
  @Get('token')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a CSRF token (requires authentication)' })
  getToken(@Res({ passthrough: true }) reply: FastifyReply) {
    const token = reply.generateCsrf();
    return { csrfToken: token };
  }
}
