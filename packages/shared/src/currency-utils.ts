/**
 * Multi-Currency Utilities
 * Provides currency formatting, conversion, and symbol mapping.
 */

/** Map of ISO 4217 currency codes to their symbols */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  INR: '₹',
  AUD: 'A$',
  CAD: 'C$',
  CHF: 'CHF',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  NZD: 'NZ$',
  SGD: 'S$',
  HKD: 'HK$',
  KRW: '₩',
  TWD: 'NT$',
  THB: '฿',
  MYR: 'RM',
  PHP: '₱',
  IDR: 'Rp',
  VND: '₫',
  BRL: 'R$',
  MXN: 'MX$',
  ARS: 'AR$',
  CLP: 'CL$',
  COP: 'CO$',
  PEN: 'S/.',
  ZAR: 'R',
  NGN: '₦',
  EGP: 'E£',
  KES: 'KSh',
  GHS: 'GH₵',
  TZS: 'TSh',
  UGX: 'USh',
  AED: 'د.إ',
  SAR: '﷼',
  QAR: 'QR',
  KWD: 'د.ك',
  BHD: 'BD',
  OMR: 'ر.ع.',
  ILS: '₪',
  TRY: '₺',
  PLN: 'zł',
  CZK: 'Kč',
  HUF: 'Ft',
  RON: 'lei',
  BGN: 'лв',
  HRK: 'kn',
  RSD: 'din.',
  UAH: '₴',
  RUB: '₽',
  PKR: '₨',
  BDT: '৳',
  LKR: 'Rs',
  NPR: 'Rs',
  MMK: 'K',
  ISK: 'kr',
  MAD: 'MAD',
  TND: 'DT',
  JOD: 'JD',
  LBP: 'L£',
  GEL: '₾',
  AMD: '֏',
  AZN: '₼',
  KZT: '₸',
  UZS: 'сўм',
  CRC: '₡',
  GTQ: 'Q',
  HNL: 'L',
  NIO: 'C$',
  PAB: 'B/.',
  DOP: 'RD$',
  TTD: 'TT$',
  JMD: 'J$',
  BBD: 'Bds$',
  BSD: 'B$',
  BOB: 'Bs.',
  PYG: '₲',
  UYU: '$U',
  VES: 'Bs.S',
  FJD: 'FJ$',
  PGK: 'K',
  WST: 'WS$',
  TOP: 'T$',
  VUV: 'VT',
  XOF: 'CFA',
  XAF: 'FCFA',
  XPF: '₣',
  ETB: 'Br',
  RWF: 'RF',
  MZN: 'MT',
  ZMW: 'ZK',
  BWP: 'P',
  MUR: '₨',
  SCR: '₨',
  MDL: 'L',
  ALL: 'L',
  MKD: 'ден',
  BAM: 'KM',
  GIP: '£',
  FKP: '£',
  SHP: '£',
  AWG: 'ƒ',
  ANG: 'ƒ',
  SRD: '$',
  GYD: 'G$',
  BZD: 'BZ$',
  BMD: 'BD$',
  KYD: 'CI$',
  XCD: 'EC$',
  MVR: 'Rf',
  BND: 'B$',
  LAK: '₭',
  KHR: '៛',
  MNT: '₮',
  KGS: 'сом',
  TJS: 'SM',
  TMT: 'T',
  AFN: '؋',
  IRR: '﷼',
  IQD: 'ع.د',
  SYP: '£S',
  YER: '﷼',
  LYD: 'LD',
  SDG: 'ج.س.',
  SOS: 'Sh',
  DJF: 'Fdj',
  ERN: 'Nfk',
  GMD: 'D',
  GNF: 'FG',
  SLL: 'Le',
  LRD: 'L$',
  MWK: 'MK',
  BIF: 'FBu',
  CDF: 'FC',
  STN: 'Db',
  CVE: '$',
  KMF: 'CF',
  MGA: 'Ar',
  HTG: 'G',
  CUP: '₱',
  SBD: 'SI$',
  KPW: '₩',
};

/** List of commonly used currencies for UI dropdowns */
export const COMMON_CURRENCIES = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'PLN', name: 'Polish Zloty' },
  { code: 'TRY', name: 'Turkish Lira' },
  { code: 'THB', name: 'Thai Baht' },
  { code: 'MYR', name: 'Malaysian Ringgit' },
  { code: 'PHP', name: 'Philippine Peso' },
  { code: 'IDR', name: 'Indonesian Rupiah' },
  { code: 'NGN', name: 'Nigerian Naira' },
  { code: 'PKR', name: 'Pakistani Rupee' },
  { code: 'BDT', name: 'Bangladeshi Taka' },
];

/**
 * Format a monetary amount with the correct currency symbol and locale.
 * Uses Intl.NumberFormat for proper locale-aware formatting.
 */
export function formatCurrency(amount: number, currency = 'USD', locale = 'en-US'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback if Intl doesn't support the currency
    const symbol = CURRENCY_SYMBOLS[currency] || currency;
    return `${symbol}${amount.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
}

/**
 * Convert an amount from one currency to another using a given exchange rate.
 * @param amount - The amount to convert
 * @param rate - The exchange rate (from → to)
 * @returns The converted amount rounded to 2 decimal places
 */
export function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rate: number,
): number {
  if (fromCurrency === toCurrency) return amount;
  return Math.round(amount * rate * 100) / 100;
}

/**
 * Get the currency symbol for a given ISO 4217 currency code.
 */
export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] || currency;
}
