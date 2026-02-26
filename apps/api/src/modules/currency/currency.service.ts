import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database';
import { Prisma } from '@compensation/database';
import type { CreateExchangeRateDto, UpdateTenantCurrencyDto, ConvertQueryDto } from './dto';

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);

  constructor(private readonly db: DatabaseService) {}

  // ─── Exchange Rates ─────────────────────────────────────────

  async listRates(tenantId: string) {
    return this.db.client.exchangeRate.findMany({
      where: { tenantId },
      orderBy: [{ fromCurrency: 'asc' }, { toCurrency: 'asc' }, { effectiveDate: 'desc' }],
    });
  }

  async createOrUpdateRate(tenantId: string, dto: CreateExchangeRateDto) {
    // Upsert: find existing rate for same pair and update, or create new
    const existing = await this.db.client.exchangeRate.findFirst({
      where: {
        tenantId,
        fromCurrency: dto.fromCurrency,
        toCurrency: dto.toCurrency,
      },
      orderBy: { effectiveDate: 'desc' },
    });

    if (existing) {
      return this.db.client.exchangeRate.update({
        where: { id: existing.id },
        data: {
          rate: dto.rate,
          effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : new Date(),
          source: (dto.source as 'MANUAL' | 'ECB' | 'OPENEXCHANGE') || 'MANUAL',
        },
      });
    }

    return this.db.client.exchangeRate.create({
      data: {
        tenantId,
        fromCurrency: dto.fromCurrency,
        toCurrency: dto.toCurrency,
        rate: dto.rate,
        effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : new Date(),
        source: (dto.source as 'MANUAL' | 'ECB' | 'OPENEXCHANGE') || 'MANUAL',
      },
    });
  }

  async fetchLatestRates(tenantId: string) {
    // Fetch from free ECB API (no API key required)
    const settings = await this.getSettings(tenantId);
    const baseCurrency = settings?.baseCurrency || 'USD';

    try {
      const url = `https://api.exchangerate-api.com/v4/latest/${baseCurrency}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Exchange rate API returned ${response.status}`);
      }
      const data = (await response.json()) as { rates: Record<string, number> };
      const rates = data.rates || {};

      const supported = settings?.supportedCurrencies || ['USD'];
      const results: Array<{ fromCurrency: string; toCurrency: string; rate: number }> = [];

      for (const currency of supported) {
        if (currency === baseCurrency) continue;
        const rate = rates[currency];
        if (rate) {
          await this.createOrUpdateRate(tenantId, {
            fromCurrency: baseCurrency,
            toCurrency: currency,
            rate,
            source: 'OPENEXCHANGE',
          });
          results.push({ fromCurrency: baseCurrency, toCurrency: currency, rate });
        }
      }

      this.logger.log(`Fetched ${results.length} exchange rates for tenant ${tenantId}`);
      return { fetched: results.length, rates: results };
    } catch (error) {
      this.logger.error('Failed to fetch exchange rates', error);
      throw error;
    }
  }

  // ─── Currency Conversion ────────────────────────────────────

  async convert(tenantId: string, query: ConvertQueryDto) {
    const { amount, from, to } = query;
    if (from === to) {
      return { amount, from, to, convertedAmount: amount, rate: 1 };
    }

    const rate = await this.db.client.exchangeRate.findFirst({
      where: { tenantId, fromCurrency: from, toCurrency: to },
      orderBy: { effectiveDate: 'desc' },
    });

    if (!rate) {
      throw new NotFoundException(`No exchange rate found for ${from} → ${to}`);
    }

    const convertedAmount = Math.round(amount * Number(rate.rate) * 100) / 100;
    return { amount, from, to, convertedAmount, rate: Number(rate.rate) };
  }

  // ─── Tenant Currency Settings ───────────────────────────────

  async getSettings(tenantId: string) {
    return this.db.client.tenantCurrency.findUnique({
      where: { tenantId },
    });
  }

  async getSupportedCurrencies(tenantId: string) {
    const settings = await this.getSettings(tenantId);
    return {
      baseCurrency: settings?.baseCurrency || 'USD',
      supportedCurrencies: settings?.supportedCurrencies || ['USD'],
    };
  }

  async updateSettings(tenantId: string, dto: UpdateTenantCurrencyDto) {
    return this.db.client.tenantCurrency.upsert({
      where: { tenantId },
      update: {
        ...(dto.baseCurrency && { baseCurrency: dto.baseCurrency }),
        ...(dto.supportedCurrencies && { supportedCurrencies: dto.supportedCurrencies }),
        ...(dto.displayFormat && { displayFormat: dto.displayFormat as Prisma.InputJsonValue }),
      },
      create: {
        tenantId,
        baseCurrency: dto.baseCurrency || 'USD',
        supportedCurrencies: dto.supportedCurrencies || ['USD'],
        displayFormat: (dto.displayFormat || {}) as Prisma.InputJsonValue,
      },
    });
  }
}
