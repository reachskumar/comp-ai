import type { MarketDataProviderAdapter } from './market-data-provider.interface';
import { BlsProvider } from './bls-provider';
import { MercerProvider } from './mercer-provider';
import { SalaryComProvider } from './salary-com-provider';
import { PayScaleProvider } from './payscale-provider';
import { RadfordProvider } from './radford-provider';
import { KornFerryProvider } from './korn-ferry-provider';
import { GlassdoorProvider } from './glassdoor-provider';
import { NaukriProvider } from './naukri-provider';
import { EriProvider } from './eri-provider';
import { HaysProvider } from './hays-provider';

/**
 * Registry of all available market data provider adapters.
 *
 * To add a new provider:
 * 1. Create a class implementing MarketDataProviderAdapter
 * 2. Register it here with a unique key
 * 3. The key maps to MarketDataSource.config.providerType
 */
const PROVIDERS: Record<string, MarketDataProviderAdapter> = {
  BLS_OES: new BlsProvider(),
  MERCER_TRS: new MercerProvider(),
  SALARY_COM: new SalaryComProvider(),
  PAYSCALE: new PayScaleProvider(),
  RADFORD: new RadfordProvider(),
  KORN_FERRY: new KornFerryProvider(),
  GLASSDOOR: new GlassdoorProvider(),
  NAUKRI: new NaukriProvider(),
  ERI: new EriProvider(),
  HAYS: new HaysProvider(),
};

export function getProvider(providerType: string): MarketDataProviderAdapter | null {
  return PROVIDERS[providerType] ?? null;
}

export function listProviders(): Array<{ key: string; name: string }> {
  return Object.entries(PROVIDERS).map(([key, provider]) => ({
    key,
    name: provider.name,
  }));
}
