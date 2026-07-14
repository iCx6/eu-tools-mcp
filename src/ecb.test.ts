import assert from "node:assert/strict";
import { parseEcbXml, getRate, fxCurrencyError, fxDateError } from "./ecb.js";

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <Cube>
    <Cube time='2026-07-06'>
      <Cube currency='USD' rate='1.1415'/>
      <Cube currency='HUF' rate='353.50'/>
    </Cube>
    <Cube time='2026-07-03'>
      <Cube currency='USD' rate='1.1398'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

const table = parseEcbXml(FIXTURE);
assert.equal(table.size, 2);
assert.equal(table.get("2026-07-06")?.get("USD"), 1.1415);
assert.equal(table.get("2026-07-06")?.get("HUF"), 353.5);
assert.equal(table.get("2026-07-03")?.get("USD"), 1.1398);
assert.equal(table.get("2026-07-03")?.get("HUF"), undefined);

// EUR needs no fetch and is always 1; no carry-forward applies
const eur = await getRate("eur", "2026-07-05");
assert.equal(eur.rate, 1);
assert.equal(eur.currency, "EUR");
assert.equal(eur.requested_date, "2026-07-05");
assert.equal(eur.rate_date, "2026-07-05");

// input validation fails fast, no network
await assert.rejects(() => getRate("DOLLARS"), /3-letter/);
await assert.rejects(() => getRate("USD", "06/07/2026"), /YYYY-MM-DD/);

// pre-payment validators: unknown-but-plausible code and bad dates are caller
// errors decidable for free, before any paywall
assert.equal(fxCurrencyError("huf"), null);
assert.match(fxCurrencyError("ZZZ")!, /ZZZ/); // names the offending value
assert.match(fxCurrencyError("ZZZ")!, /USD/); // lists supported codes
assert.match(fxCurrencyError("DOLLARS")!, /3-letter/);
assert.equal(fxDateError("2026-07-06"), null);
assert.match(fxDateError("06/07/2026")!, /YYYY-MM-DD/);
assert.match(fxDateError("2999-01-01")!, /future/);
assert.match(fxDateError("2020-01-01")!, /window/);

// carry-forward: a weekend/holiday date returns the most recent preceding
// business day's rate, explicitly labelled via rate_date != requested_date
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, text: async () => FIXTURE })) as never;
  try {
    const sunday = await getRate("USD", "2026-07-05"); // fixture has 07-03 (Fri) and 07-06 (Mon)
    assert.equal(sunday.requested_date, "2026-07-05");
    assert.equal(sunday.rate_date, "2026-07-03");
    assert.equal(sunday.rate, 1.1398);

    const exact = await getRate("USD", "2026-07-06"); // business day -> no carry
    assert.equal(exact.requested_date, "2026-07-06");
    assert.equal(exact.rate_date, "2026-07-06");
    assert.equal(exact.rate, 1.1415);

    // date before everything in the window -> loud error, never silent data
    await assert.rejects(() => getRate("USD", "2026-07-01"), /on or before/);
  } finally {
    globalThis.fetch = origFetch;
  }
}

console.log("ecb.test.ts: all assertions passed");
