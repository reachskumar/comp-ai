import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Transporter } from 'nodemailer';

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromOverride?: string;
}

/**
 * Thin wrapper over nodemailer with safety rails:
 *  - If SMTP_HOST isn't configured, send() throws a recognizable error so the
 *    caller can surface 503 to the client. No silent failures, and no
 *    accidental email blasts in dev.
 *  - Transporter is built lazily on first send (avoids resolving env at boot).
 *  - HMAC token helpers used for the public acknowledgement endpoint.
 */
@Injectable()
export class LetterEmailService {
  private readonly logger = new Logger(LetterEmailService.name);
  private transporter: Transporter | null = null;
  private buildAttempted = false;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!this.config.get<string>('SMTP_HOST');
  }

  async send(args: SendArgs): Promise<{ messageId: string; accepted: string[] }> {
    if (!this.isConfigured()) {
      throw new EmailNotConfiguredError(
        'SMTP not configured (set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM)',
      );
    }
    const transporter = await this.getTransporter();
    const from =
      args.fromOverride ?? this.config.get<string>('EMAIL_FROM') ?? 'no-reply@example.com';

    const result = await transporter.sendMail({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });

    return {
      messageId: result.messageId,
      accepted: (result.accepted ?? []).map((a: string | { address: string }) =>
        typeof a === 'string' ? a : a.address,
      ),
    };
  }

  /** Sign an opaque token tying letterId+tenantId together for acknowledgement. */
  signAckToken(letterId: string, tenantId: string): string {
    const secret = this.requireSecret();
    const payload = `${tenantId}:${letterId}`;
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    return `${Buffer.from(payload).toString('base64url')}.${sig}`;
  }

  /** Verify and unpack a token. Returns null on any tampering or format error. */
  verifyAckToken(token: string): { letterId: string; tenantId: string } | null {
    const secret = this.requireSecret();
    const [encoded, sig] = token.split('.');
    if (!encoded || !sig) return null;
    let payload: string;
    try {
      payload = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      return null;
    }
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    if (!safeEq(sig, expected)) return null;
    const [tenantId, letterId] = payload.split(':');
    if (!tenantId || !letterId) return null;
    return { tenantId, letterId };
  }

  /** Public-facing URL the email should link to for acknowledgement. */
  buildAckUrl(letterId: string, tenantId: string): string {
    const base =
      this.config.get<string>('APP_BASE_URL') ??
      this.config.get<string>('PUBLIC_API_URL') ??
      'http://localhost:4000';
    const token = this.signAckToken(letterId, tenantId);
    return `${base.replace(/\/$/, '')}/api/v1/letters/acknowledge?token=${encodeURIComponent(token)}`;
  }

  private requireSecret(): string {
    const s = this.config.get<string>('EMAIL_TOKEN_SECRET');
    if (!s || s.length < 16) {
      throw new Error('EMAIL_TOKEN_SECRET must be set and at least 16 characters');
    }
    return s;
  }

  private async getTransporter(): Promise<Transporter> {
    if (this.transporter) return this.transporter;
    if (this.buildAttempted) {
      // Previous attempt failed; try again only on next call.
      this.buildAttempted = false;
    }
    this.buildAttempted = true;

    const nodemailer = await import('nodemailer');
    const host = this.config.get<string>('SMTP_HOST')!;
    const port = parseInt(this.config.get<string>('SMTP_PORT') ?? '587', 10);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const secure = this.config.get<string>('SMTP_SECURE') === 'true';

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
    this.logger.log(`SMTP transporter ready: host=${host} port=${port} secure=${secure}`);
    return this.transporter;
  }
}

export class EmailNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailNotConfiguredError';
  }
}

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
