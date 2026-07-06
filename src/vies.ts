// EU-27 VAT country codes as VIES knows them: Greece is EL, Northern Ireland is XI.
const EU_VAT_CODES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR",
  "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI",
  "SK", "XI",
]);

export interface VatQuery {
  country: string;
  number: string;
}

/**
 * Normalize and pre-validate a VAT number so obvious garbage never reaches VIES.
 * ponytail: syntax-only check (country whitelist + charset/length), not the
 * per-country checksum table — VIES itself is the authority we're paid to ask.
 */
export function parseVatInput(
  country: string,
  vatNumber: string,
): { ok: true; q: VatQuery } | { ok: false; error: string } {
  const cc = country.trim().toUpperCase();
  if (cc === "GR") return { ok: false, error: "Greece uses country code EL in VIES" };
  if (!EU_VAT_CODES.has(cc)) {
    return { ok: false, error: `"${cc}" is not an EU VAT country code (EL = Greece, XI = Northern Ireland)` };
  }
  let num = vatNumber.trim().toUpperCase().replace(/[\s.\-]/g, "");
  if (num.startsWith(cc)) num = num.slice(2);
  if (!/^[0-9A-Z+*]{2,12}$/.test(num)) {
    return { ok: false, error: "VAT number must be 2-12 letters/digits after the country prefix" };
  }
  return { ok: true, q: { country: cc, number: num } };
}

export interface VatResult {
  valid: boolean;
  name?: string;
  address?: string;
  requestDate: string;
}

const VIES = "https://ec.europa.eu/taxation_customs/vies/rest-api/ms";

/** Ask the official VIES registry. Throws on HTTP errors and VIES error codes (e.g. MS_UNAVAILABLE). */
export async function checkVat(q: VatQuery): Promise<VatResult> {
  const res = await fetch(`${VIES}/${q.country}/vat/${q.number}`);
  if (!res.ok) throw new Error(`VIES returned HTTP ${res.status}`);
  const data = (await res.json()) as {
    isValid: boolean;
    requestDate: string;
    userError: string;
    name: string;
    address: string;
  };
  if (data.userError && data.userError !== "VALID" && data.userError !== "INVALID") {
    throw new Error(`VIES error: ${data.userError}`);
  }
  return {
    valid: data.isValid,
    name: data.name && data.name !== "---" ? data.name : undefined,
    address: data.address && data.address !== "---" ? data.address : undefined,
    requestDate: data.requestDate,
  };
}
