import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { LettersService } from './letters.service';

/**
 * Public endpoint hit by the recipient employee from the acknowledgement link
 * in the email. NOT authenticated — verification is by HMAC token only.
 *
 * Lives outside `LettersController` so it isn't covered by JwtAuthGuard /
 * TenantGuard / PermissionGuard.
 */
@ApiTags('letters')
@Controller('letters/acknowledge')
export class LetterAcknowledgeController {
  private readonly logger = new Logger(LetterAcknowledgeController.name);

  constructor(private readonly letters: LettersService) {}

  @Get()
  @ApiOperation({ summary: 'Acknowledge letter receipt via signed token (public).' })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async acknowledge(@Query('token') token: string, @Res() reply: FastifyReply) {
    if (!token) {
      void reply
        .code(400)
        .type('text/html; charset=utf-8')
        .send(
          renderHtml({
            ok: false,
            title: 'Missing token',
            body: 'This acknowledgement link is incomplete.',
          }),
        );
      return;
    }
    try {
      const result = await this.letters.acknowledgeLetter(token);
      void reply
        .code(200)
        .type('text/html; charset=utf-8')
        .send(
          renderHtml({
            ok: true,
            title: result.alreadyAcknowledged ? 'Already acknowledged' : 'Acknowledgement received',
            body: result.firstName
              ? `Thank you${result.firstName ? `, ${escapeHtml(result.firstName)}` : ''}. Your acknowledgement was recorded on ${new Date(result.acknowledgedAt).toLocaleString()}.`
              : `Your acknowledgement was recorded on ${new Date(result.acknowledgedAt).toLocaleString()}.`,
          }),
        );
    } catch (err) {
      this.logger.warn(`Acknowledge failed: ${err instanceof Error ? err.message : String(err)}`);
      void reply
        .code(400)
        .type('text/html; charset=utf-8')
        .send(
          renderHtml({
            ok: false,
            title: 'Could not acknowledge',
            body:
              err instanceof Error && err.message
                ? escapeHtml(err.message)
                : 'This link is invalid or has expired.',
          }),
        );
    }
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHtml(opts: { ok: boolean; title: string; body: string }): string {
  const accent = opts.ok ? '#10b981' : '#ef4444';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center">
  <div style="max-width:480px;margin:24px;padding:32px;background:white;border-radius:12px;border:1px solid #e2e8f0;text-align:center">
    <div style="width:56px;height:56px;border-radius:999px;background:${accent}15;color:${accent};font-size:28px;line-height:56px;margin:0 auto 16px;font-weight:700">${opts.ok ? '✓' : '!'}</div>
    <h1 style="margin:0 0 8px;font-size:22px;color:#1e293b">${escapeHtml(opts.title)}</h1>
    <p style="margin:0;color:#475569;line-height:1.6">${opts.body}</p>
  </div>
</body></html>`;
}
