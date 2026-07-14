const DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const HIST90_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";

/** date (YYYY-MM-DD) → currency → units per 1 EUR */
export type RateTable = Map<string, Map<string, number>>;

/**
 * The eurofxref format is rigidly machine-generated (single-quoted attributes,
 * self-closing currency cubes), so two regexes beat an XML dependency.
 */
export function parseEcbXml(xml: string): RateTable {
  const table: RateTable = new Map();
  for (const day of xml.matchAll(/<Cube time='(\d{4}-\d{2}-\d{2})'>([\s\S]*?)<\/Cube>/g)) {
    const rates = new Map<string, number>();
    for (const m of day[2].matchAll(/<Cube currency='([A-Z]{3})' rate='([\d.]+)'\/>/g)) {
      rates.set(m[1], Number(m[2]));
    }
    table.set(day[1], rates);
  }
  return table;
}

const TTL_MS = 60 * 60 * 1000; // rates change once per business day; 1h is generous
const cache = new Map<string, { at: number; table: RateTable }>();

async function fetchTable(url: string): Promise<RateTable> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.table;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ECB returned HTTP ${res.status}`);
  const table = parseEcbXml(await res.text());
  cache.set(url, { at: Date.now(), table });
  return table;
}

/**
 * Currencies the ECB publishes reference rates for, plus EUR itself. The list
 * changes roughly once a decade (HRK left on euro accession, RUB was suspended
 * in 2022) — update here when the ECB list changes.
 */
export const ECB_CURRENCIES: ReadonlySet<string> = new Set([
  "EUR", "USD", "JPY", "BGN", "CZK", "DKK", "GBP", "HUF", "PLN", "RON", "SEK",
  "CHF", "ISK", "NOK", "TRY", "AUD", "BRL", "CAD", "CNY", "HKD", "IDR", "ILS",
  "INR", "KRW", "MXN", "MYR", "NZD", "PHP", "SGD", "THB", "ZAR",
]);

const todayUtc = () => new Date().toISOString().slice(0, 10);

/**
 * Caller-input errors decidable for free, BEFORE any payment: shared by the
 * HTTP route's pre-paywall validator and the MCP tool's zod schema (which the
 * MCP SDK enforces before the payment wrapper runs). Null = valid.
 */
export function fxCurrencyError(currency: string): string | null {
  const ccy = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(ccy)) return "currency must be a 3-letter ISO code, e.g. USD";
  if (!ECB_CURRENCIES.has(ccy)) {
    return `currency ${ccy} is not on the ECB reference list (supported: ${[...ECB_CURRENCIES].join(", ")})`;
  }
  return null;
}

export function fxDateError(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "date must be YYYY-MM-DD";
  if (date > todayUtc()) return `date ${date} is in the future — ECB rates exist for past business days only`;
  const oldest = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  if (date < oldest) return `date ${date} is outside the ECB ~90-day history window (oldest available is around ${oldest})`;
  return null;
}

export interface FxResult {
  currency: string;
  requested_date: string; // the date the caller asked about (or the latest business day)
  rate_date: string; // the ECB business day the rate was published for (<= requested_date)
  rate: number; // 1 EUR = rate × currency
}

export async function getRate(currency: string, date?: string): Promise<FxResult> {
  const err = fxCurrencyError(currency) ?? (date ? fxDateError(date) : null);
  if (err) throw new Error(err);
  const ccy = currency.trim().toUpperCase();
  if (ccy === "EUR") {
    const d = date ?? todayUtc();
    return { currency: "EUR", requested_date: d, rate_date: d, rate: 1 };
  }
  const table = await fetchTable(date ? HIST90_URL : DAILY_URL);
  const days = [...table.keys()].sort();
  // Standard financial convention: no rate published for the requested day
  // (weekend/holiday) -> carry the most recent preceding business day's rate,
  // labelled explicitly via rate_date so the substitution is never silent.
  const day = date ? days.filter((d) => d <= date).at(-1) : days.at(-1);
  if (!day) {
    throw new Error(`no ECB rate on or before ${date} — the history window covers ~90 days only`);
  }
  const rate = table.get(day)!.get(ccy);
  if (rate === undefined) throw new Error(`currency ${ccy} is not on the ECB reference list`);
  return { currency: ccy, requested_date: date ?? day, rate_date: day, rate };
}
