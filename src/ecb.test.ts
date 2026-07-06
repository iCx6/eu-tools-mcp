import assert from "node:assert/strict";
import { parseEcbXml, getRate } from "./ecb.js";

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

// EUR needs no fetch and is always 1
const eur = await getRate("eur");
assert.equal(eur.rate, 1);
assert.equal(eur.currency, "EUR");

// input validation fails fast, no network
await assert.rejects(() => getRate("DOLLARS"), /3-letter/);
await assert.rejects(() => getRate("USD", "06/07/2026"), /YYYY-MM-DD/);

console.log("ecb.test.ts: all assertions passed");
