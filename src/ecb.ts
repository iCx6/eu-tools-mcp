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

export interface FxResult {
  currency: string;
  date: string;
  rate: number; // 1 EUR = rate × currency
}

export async function getRate(currency: string, date?: string): Promise<FxResult> {
  const ccy = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(ccy)) throw new Error("currency must be a 3-letter ISO code, e.g. USD");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be YYYY-MM-DD");
  if (ccy === "EUR") {
    return { currency: "EUR", date: date ?? new Date().toISOString().slice(0, 10), rate: 1 };
  }
  const table = await fetchTable(date ? HIST90_URL : DAILY_URL);
  const day = date ?? [...table.keys()].sort().at(-1);
  const rates = day ? table.get(day) : undefined;
  if (!rates) {
    throw new Error(
      `no ECB reference rate for ${date} — rates exist for business days in the last ~90 days only`,
    );
  }
  const rate = rates.get(ccy);
  if (rate === undefined) throw new Error(`currency ${ccy} is not on the ECB reference list`);
  return { currency: ccy, date: day!, rate };
}
