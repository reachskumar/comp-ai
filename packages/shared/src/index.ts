/**
 * @compensation/shared
 * Shared TypeScript utilities, types, and constants for the compensation platform.
 */

export const APP_NAME = 'Compensation Platform';

export type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E };

export function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

export function err<E = Error>(error: E): Result<never, E> {
  return { success: false, error };
}

// Data Hygiene Module
export * from './data-hygiene/index.js';

// Rules Engine Module
export * from './rules-engine/index.js';

// Integration Hub Module
export * from './integrations/index.js';

// Encryption Module (AES-256-GCM for PII at rest)
export { encrypt, decrypt, deriveKey } from './encryption/index.js';

// Currency Utilities
export {
  CURRENCY_SYMBOLS,
  COMMON_CURRENCIES,
  formatCurrency,
  convertAmount,
  getCurrencySymbol,
} from './currency-utils.js';
