import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database';
import { getProvider, listProviders } from './providers';
import type { ProviderConfig, SyncResult } from './providers';

@Injectable()
export class MarketDataSyncService {
  private readonly logger = new Logger(MarketDataSyncService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * List all available provider adapters that can be configured.
   */
  getAvailableProviders() {
    return listProviders();
  }

  /**
   * Validate a provider's configuration before saving.
   */
  validateProviderConfig(providerType: string, config: ProviderConfig): string[] {
    const provider = getProvider(providerType);
    if (!provider) return [`Unknown provider: ${providerType}`];
    return provider.validateConfig(config);
  }

  /**
   * Check if a configured market data source is reachable.
   */
  async checkSourceHealth(tenantId: string, sourceId: string): Promise<boolean> {
    const source = await this.db.forTenant(tenantId, (tx) =>
      tx.marketDataSource.findFirst({ where: { id: sourceId, tenantId } }),
    );
    if (!source) throw new NotFoundException('Market data source not found');

    const config = source.config as Record<string, unknown>;
    const providerType = (config.providerType as string) ?? source.provider;
    const provider = getProvider(providerType);
    if (!provider) return false;

    return provider.healthCheck(config as ProviderConfig);
  }

  /**
   * Sync salary bands from a configured market data source.
   * Fetches data from the external provider and upserts into SalaryBand table.
   */
  async syncSource(
    tenantId: string,
    sourceId: string,
    filters?: { jobFamily?: string; location?: string },
  ): Promise<SyncResult> {
    const source = await this.db.forTenant(tenantId, (tx) =>
      tx.marketDataSource.findFirst({ where: { id: sourceId, tenantId } }),
    );
    if (!source) throw new NotFoundException('Market data source not found');

    const config = source.config as Record<string, unknown>;
    const providerType = (config.providerType as string) ?? source.provider;
    const provider = getProvider(providerType);

    if (!provider) {
      throw new BadRequestException(
        `No adapter found for provider type "${providerType}". Available: ${listProviders().map((p) => p.key).join(', ')}`,
      );
    }

    // Validate config
    const configErrors = provider.validateConfig(config as ProviderConfig);
    if (configErrors.length > 0) {
      throw new BadRequestException(`Invalid provider config: ${configErrors.join(', ')}`);
    }

    this.logger.log(`Starting sync for source "${source.name}" (${providerType})`);

    const errors: string[] = [];
    let bandsImported = 0;
    let bandsSkipped = 0;

    try {
      const bands = await provider.fetchBands(config as ProviderConfig, filters);

      // Upsert bands in a transaction
      await this.db.forTenant(tenantId, async (tx) => {
        for (const band of bands) {
          try {
            // Check for existing band with same key (jobFamily + level + location + source)
            const existing = await tx.salaryBand.findFirst({
              where: {
                tenantId,
                jobFamily: band.jobFamily,
                level: band.level,
                location: band.location,
                source: band.source,
              },
            });

            if (existing) {
              // Update if percentiles changed
              const changed =
                Number(existing.p50) !== band.p50 ||
                Number(existing.p25) !== band.p25 ||
                Number(existing.p75) !== band.p75;

              if (changed) {
                await tx.salaryBand.update({
                  where: { id: existing.id },
                  data: {
                    p10: band.p10,
                    p25: band.p25,
                    p50: band.p50,
                    p75: band.p75,
                    p90: band.p90,
                    effectiveDate: band.effectiveDate,
                    expiresAt: band.expiresAt,
                  },
                });
                bandsImported++;
              } else {
                bandsSkipped++;
              }
            } else {
              await tx.salaryBand.create({
                data: {
                  tenantId,
                  jobFamily: band.jobFamily,
                  level: band.level,
                  location: band.location,
                  currency: band.currency,
                  p10: band.p10,
                  p25: band.p25,
                  p50: band.p50,
                  p75: band.p75,
                  p90: band.p90,
                  source: band.source,
                  effectiveDate: band.effectiveDate,
                  expiresAt: band.expiresAt,
                },
              });
              bandsImported++;
            }
          } catch (err) {
            errors.push(`Failed to upsert ${band.jobFamily}/${band.level}: ${(err as Error).message}`);
          }
        }
      });

      // Update source lastSyncAt and status
      await this.db.forTenant(tenantId, (tx) =>
        tx.marketDataSource.update({
          where: { id: sourceId },
          data: {
            lastSyncAt: new Date(),
            status: errors.length > 0 ? 'ERROR' : 'ACTIVE',
          },
        }),
      );
    } catch (err) {
      errors.push(`Sync failed: ${(err as Error).message}`);

      await this.db.forTenant(tenantId, (tx) =>
        tx.marketDataSource.update({
          where: { id: sourceId },
          data: { status: 'ERROR' },
        }),
      ).catch(() => { /* swallow update failure during error handling */ });
    }

    const result: SyncResult = {
      provider: providerType,
      bandsImported,
      bandsSkipped,
      errors,
      syncedAt: new Date(),
    };

    this.logger.log(
      `Sync complete for "${source.name}": ${bandsImported} imported, ${bandsSkipped} skipped, ${errors.length} errors`,
    );

    return result;
  }
}
