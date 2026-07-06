# EU Tools MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hosted, paid MCP server (VIES VAT validation + ECB FX rates) on Fly.io, Base mainnet, built as the first registry-installed consumer of `x402-mica@0.2.0`.

**Architecture:** Streamable HTTP MCP server in stateless mode (fresh `McpServer` + transport per POST), two tool handlers decorated with `withPayment` at module level so the payment wrapper + SQLite audit DB are shared across requests. Upstream calls use global `fetch` (Node 22). The `/audit` dashboard from x402-mica ships on the same Express app with a public read-only key.

**Tech Stack:** Node >=22.13, TypeScript ESM (NodeNext), Express 4, `@modelcontextprotocol/sdk`, zod 3, `x402-mica@^0.2.0` (from npm registry — the whole point), Fly.io + Docker, SQLite via `node:sqlite` (inside x402-mica).

## Global Constraints

- `x402-mica` MUST be installed from the npm registry (`^0.2.0`), never `file:`/`link:` — this project is the dogfood test.
- Node `>=22.13`, `"type": "module"`, tsconfig `module`/`moduleResolution` = `NodeNext` — imports need `.js` extensions.
- Prices exactly: `validate_vat` = `"$0.005"`, `eur_fx` = `"$0.001"`, both USDC (default asset, no `asset` option).
- Default network `eip155:8453` (Base mainnet), overridable via `X402_NETWORK`.
- Non-custodial; facilitator selection is inside x402-mica (`makeFacilitatorClient`) — mainnet needs `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` env vars at runtime.
- No dependencies beyond those listed in Task 1's package.json.
- Tests are assert-based scripts run with `tsx` (same style as x402-mica), no test framework.
- All new code in `C:\Users\attil\eu-tools-mcp` (own git repo, already initialized, spec committed).

**Verified upstream API facts (probed live 2026-07-06):**

- VIES REST: `GET https://ec.europa.eu/taxation_customs/vies/rest-api/ms/{CC}/vat/{NUM}` → JSON `{ isValid: boolean, requestDate: string, userError: "VALID"|"INVALID"|<error code>, name: string, address: string, ... }`; `"---"` means "not disclosed". Greece is `EL`, Northern Ireland is `XI`. Member-state downtime surfaces as `userError` codes like `MS_UNAVAILABLE`.
- ECB daily rates: `GET https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` — one `<Cube time='YYYY-MM-DD'>` holding self-closing `<Cube currency='USD' rate='1.1415'/>` entries. Last ~90 days in the same format: `eurofxref-hist-90d.xml`. Older history exists only as ZIP (no stdlib unzip) → **date parameter is limited to the 90-day window** (spec updated accordingly). ECB publishes business days only — weekends/holidays have no entry, exact-date lookup, no backfill.

---

### Task 1: Scaffold + VIES module

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`
- Create: `src/vies.ts`
- Test: `src/vies.test.ts`

**Interfaces:**
- Produces: `parseVatInput(country: string, vatNumber: string): { ok: true; q: VatQuery } | { ok: false; error: string }` where `VatQuery = { country: string; number: string }`; `checkVat(q: VatQuery): Promise<VatResult>` where `VatResult = { valid: boolean; name?: string; address?: string; requestDate: string }` (throws `Error` on HTTP failure or VIES error codes like `MS_UNAVAILABLE`).

- [ ] **Step 1: Write scaffold files**

`package.json`:

```json
{
  "name": "eu-tools-mcp",
  "version": "0.1.0",
  "private": true,
  "description": "Paid MCP tools for AI agents — EU VAT validation (VIES) and official ECB EUR FX rates, paid per call in USDC via x402",
  "type": "module",
  "engines": { "node": ">=22.13" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "tsx src/vies.test.ts && tsx src/ecb.test.ts",
    "smoke": "tsx src/smoke.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "x402-mica": "^0.2.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.10.5",
    "@x402/evm": "^2.17.0",
    "@x402/mcp": "^2.17.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "viem": "^2.54.1"
  }
}
```

(`dotenv` is a regular dependency: `server.ts` imports `dotenv/config` and Docker prunes devDependencies. `@x402/*` + `viem` are dev-only — only the smoke-test payer needs them.)

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

`.gitignore`:

```
node_modules/
dist/
.env
data/
*.db
```

`.env.example`:

```
# Seller wallet — where USDC lands. Required.
PAY_TO=0x0000000000000000000000000000000000000000
# Base mainnet by default; eip155:84532 for Sepolia testing.
X402_NETWORK=eip155:8453
# CDP facilitator credentials (required on mainnet).
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
# Read-only audit dashboard key; unset = /audit disabled (503).
AUDIT_API_KEY=
PORT=8080
# --- smoke client only ---
PAYER_KEY=
MCP_URL=http://localhost:8080/mcp
```

- [ ] **Step 2: Install dependencies (dogfood moment)**

Run: `npm install`
Expected: succeeds; `npm ls x402-mica` shows `x402-mica@0.2.0` from the registry. If the published package fails to install or import here, STOP — that is a package bug worth more than this project; report it.

- [ ] **Step 3: Write the failing test**

`src/vies.test.ts`:

```ts
import assert from "node:assert/strict";
import { parseVatInput } from "./vies.js";

// happy path: lowercase + spaces normalized
let r = parseVatInput(" hu ", " 12345678 ");
assert.deepEqual(r, { ok: true, q: { country: "HU", number: "12345678" } });

// duplicated country prefix in the number is stripped
r = parseVatInput("HU", "HU12345678");
assert.deepEqual(r, { ok: true, q: { country: "HU", number: "12345678" } });

// dots/dashes/spaces inside the number are stripped (common paste formats)
r = parseVatInput("NL", "8043.46.703.B01");
assert.deepEqual(r, { ok: true, q: { country: "NL", number: "804346703B01" } });

// Greece must be EL in VIES
r = parseVatInput("GR", "123456789");
assert.equal(r.ok, false);
assert.match((r as { ok: false; error: string }).error, /EL/);

// non-EU country
r = parseVatInput("US", "123456789");
assert.equal(r.ok, false);

// garbage number
r = parseVatInput("DE", "!!");
assert.equal(r.ok, false);

// too short / too long
assert.equal(parseVatInput("DE", "1").ok, false);
assert.equal(parseVatInput("DE", "1234567890123").ok, false);

console.log("vies.test.ts: all assertions passed");
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx tsx src/vies.test.ts`
Expected: FAIL — cannot find module `./vies.js`

- [ ] **Step 5: Implement `src/vies.ts`**

```ts
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx src/vies.test.ts`
Expected: `vies.test.ts: all assertions passed`

- [ ] **Step 7: One live sanity call (manual, not in the test file)**

Run: `npx tsx -e "import { checkVat } from './src/vies.js'; console.log(await checkVat({ country: 'IE', number: '6388047V' }))"`
Expected: `{ valid: true, name: 'GOOGLE IRELAND LIMITED', ... }`

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example src/vies.ts src/vies.test.ts
git commit -m "Scaffold project + VIES VAT validation module"
```

---

### Task 2: ECB FX module

**Files:**
- Create: `src/ecb.ts`
- Test: `src/ecb.test.ts`

**Interfaces:**
- Produces: `parseEcbXml(xml: string): RateTable` where `RateTable = Map<string, Map<string, number>>` (date → currency → rate); `getRate(currency: string, date?: string): Promise<FxResult>` where `FxResult = { currency: string; date: string; rate: number }` meaning 1 EUR = `rate` × currency (throws `Error` on bad input, unknown currency, missing date, or ECB HTTP failure).

- [ ] **Step 1: Write the failing test**

`src/ecb.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/ecb.test.ts`
Expected: FAIL — cannot find module `./ecb.js`

- [ ] **Step 3: Implement `src/ecb.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/ecb.test.ts`
Expected: `ecb.test.ts: all assertions passed`

- [ ] **Step 5: Run the full test script**

Run: `npm test`
Expected: both test files pass.

- [ ] **Step 6: Commit**

```bash
git add src/ecb.ts src/ecb.test.ts
git commit -m "Add ECB FX rate module (daily + 90-day window, cached)"
```

---

### Task 3: MCP server with paid tools + audit dashboard

**Files:**
- Create: `src/server.ts`

**Interfaces:**
- Consumes: `parseVatInput`/`checkVat` (Task 1), `getRate` (Task 2), `withPayment`/`auditDashboard` from `x402-mica`.
- Produces: HTTP server — `POST /mcp` (MCP Streamable HTTP), `GET /audit` (dashboard), `GET /` (landing text). Tool names: `validate_vat`, `eur_fx`.

- [ ] **Step 1: Implement `src/server.ts`**

```ts
import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { withPayment, auditDashboard } from "x402-mica";
import { parseVatInput, checkVat } from "./vies.js";
import { getRate } from "./ecb.js";

const payTo = process.env.PAY_TO;
if (!payTo) throw new Error("Missing PAY_TO in environment");
const network = (process.env.X402_NETWORK ?? "eip155:8453") as `${string}:${string}`;
const dbPath = process.env.DB_PATH ?? "data/audit.db";
mkdirSync(dirname(dbPath), { recursive: true });

const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});
const paid = { network, payTo, dbPath } as const;

// Decorated once at module level: withPayment memoizes facilitator + audit db across requests.
const validateVat = withPayment(
  async ({ country, vat_number }: { country: string; vat_number: string }) => {
    const parsed = parseVatInput(country, vat_number);
    if (!parsed.ok) return text({ error: parsed.error });
    try {
      return text(await checkVat(parsed.q));
    } catch (err) {
      // Paid but VIES is down — non-custodial x402 has no refunds; documented in the tool description.
      return text({ error: err instanceof Error ? err.message : String(err) });
    }
  },
  {
    ...paid,
    price: "$0.005",
    description: "Validate an EU VAT number against the official VIES registry",
  },
);

const eurFx = withPayment(
  async ({ currency, date }: { currency: string; date?: string }) => {
    try {
      return text(await getRate(currency, date));
    } catch (err) {
      return text({ error: err instanceof Error ? err.message : String(err) });
    }
  },
  { ...paid, price: "$0.001", description: "Official ECB euro reference exchange rate" },
);

function buildServer(): McpServer {
  const server = new McpServer({ name: "eu-tools-mcp", version: "0.1.0" });
  server.tool(
    "validate_vat",
    "Check an EU VAT number against the official EU VIES registry; returns validity plus the " +
      "registered company name/address where the member state discloses them. Costs $0.005 USDC " +
      "per call via x402 (Base). Note: payment settles before the lookup, so if the member " +
      "state's VIES service is down you receive a structured error for that call, not a refund.",
    {
      country: z.string().describe("Two-letter EU VAT country code (EL = Greece, XI = Northern Ireland)"),
      vat_number: z.string().describe("VAT number, with or without the country prefix"),
    },
    validateVat,
  );
  server.tool(
    "eur_fx",
    "Official ECB euro reference rate: 1 EUR = rate × currency. Latest business day by default, " +
      "or a specific date (YYYY-MM-DD, business days within the last 90 days). Costs $0.001 USDC " +
      "per call via x402 (Base).",
    {
      currency: z.string().describe("3-letter ISO currency code, e.g. USD, HUF, GBP"),
      date: z.string().optional().describe("YYYY-MM-DD within the last 90 days; omit for latest"),
    },
    eurFx,
  );
  return server;
}

const app = express();
app.use(express.json());

// Stateless mode: fresh McpServer + transport per request (SDK's minimal documented pattern).
app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => void transport.close());
    await buildServer().connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null });
    }
  }
});
app.get("/mcp", (_req, res) => { res.status(405).send("stateless server: POST only"); });
app.delete("/mcp", (_req, res) => { res.status(405).send("stateless server: POST only"); });

app.get("/audit", auditDashboard({ dbPath, apiKey: process.env.AUDIT_API_KEY }));

app.get("/", (_req, res) => {
  res.type("text/plain").send(
    "eu-tools-mcp — paid MCP tools for AI agents (x402, USDC on Base)\n\n" +
      "POST /mcp   MCP Streamable HTTP endpoint\n" +
      "  validate_vat  $0.005  EU VAT number check (official VIES registry)\n" +
      "  eur_fx        $0.001  official ECB euro reference rates\n" +
      "GET /audit  live MiCA-compliance audit trail (read-only)\n\n" +
      "Docs: https://github.com/iCx6/eu-tools-mcp — built with x402-mica (npmjs.com/package/x402-mica)",
  );
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => console.log(`eu-tools-mcp on :${port} (network ${network})`));
```

- [ ] **Step 2: Typecheck and run tests**

Run: `npm run build && npm test`
Expected: clean build, both tests pass.

- [ ] **Step 3: Manual local verification (no payment yet)**

Copy `.env.example` → `.env`, set `PAY_TO` to the seller address from the x402-mica `.env`, set `X402_NETWORK=eip155:84532` (Sepolia — no CDP keys needed locally), set `AUDIT_API_KEY=localtest`.

Run: `npm run dev` in background, then:

```bash
curl -s -X POST http://localhost:8080/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expected: JSON listing both tools with descriptions (tool listing is free; only calls are paid).

```bash
curl -s "http://localhost:8080/audit?key=localtest"
```

Expected: HTTP 200, empty audit table HTML.

```bash
curl -s http://localhost:8080/
```

Expected: the landing text.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "Add paid MCP server: validate_vat + eur_fx + audit dashboard"
```

---

### Task 4: Smoke-test payer client

**Files:**
- Create: `src/smoke.ts`

**Interfaces:**
- Consumes: the deployed (or local) server's `POST /mcp`; env `PAYER_KEY` (payer EOA private key), `MCP_URL`.
- Produces: `npm run smoke` — pays for one `validate_vat` and one `eur_fx` call, prints results.

- [ ] **Step 1: Implement `src/smoke.ts`** (patterned on x402-mica's `mcp-http-client.ts`)

```ts
import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { wrapMCPClientWithPayment, x402Client } from "@x402/mcp";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

// Dev-only paid smoke test: calls both tools for real money. Payer must be a plain EOA
// (EIP-7702-delegated wallets fail USDC's ERC-1271 path) and must not equal PAY_TO.
const raw = process.env.PAYER_KEY;
if (!raw) throw new Error("Missing PAYER_KEY in .env");
const account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`);

const url = new URL(process.env.MCP_URL ?? "http://localhost:8080/mcp");
const paymentClient = new x402Client().register("eip155:*", new ExactEvmScheme(account));
const mcp = wrapMCPClientWithPayment(
  new Client({ name: "eu-tools-smoke", version: "0.1.0" }),
  paymentClient,
  { autoPayment: true },
);

await mcp.connect(new StreamableHTTPClientTransport(url));
console.log(`Paying from ${account.address} at ${url}`);

const vat: any = await mcp.callTool("validate_vat", { country: "IE", vat_number: "6388047V" });
console.log("validate_vat:", JSON.stringify(vat?.content ?? vat));

const fx: any = await mcp.callTool("eur_fx", { currency: "USD" });
console.log("eur_fx:", JSON.stringify(fx?.content ?? fx));

await mcp.close();
```

- [ ] **Step 2: Local paid loop on Sepolia**

With the Task 3 `.env` (Sepolia) plus `PAYER_KEY` = the funded Sepolia payer key from the x402-mica `.env` (holds ~0.99 testnet USDC): start `npm run dev` in background, run `npm run smoke`.
Expected: both tool results print (`valid: true, name: GOOGLE IRELAND LIMITED...` and a USD rate), no payment errors.

- [ ] **Step 3: Verify the audit trail recorded both paid calls**

```bash
curl -s "http://localhost:8080/audit?format=json&key=localtest"
```

Expected: 2 rows — amounts `$0.005` and `$0.001`, `mica_compliant: 1`, payer = the smoke wallet, tx refs present. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/smoke.ts
git commit -m "Add paid smoke-test client"
```

---

### Task 5: README + Docker + Fly config

**Files:**
- Create: `README.md`, `Dockerfile`, `.dockerignore`, `fly.toml`

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

`.dockerignore`:

```
node_modules
dist
data
.env
.git
docs
```

- [ ] **Step 2: Write `fly.toml`**

```toml
app = "eu-tools-mcp"
primary_region = "ams"

[env]
  DB_PATH = "/data/audit.db"
  PORT = "8080"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

[mounts]
  source = "audit_data"
  destination = "/data"

[[vm]]
  memory = "256mb"
  cpu_kind = "shared"
  cpus = 1
```

(`auto_stop_machines = "off"`: a showcase must not cold-start. One machine, one volume — SQLite needs exactly one writer.)

- [ ] **Step 3: Verify the Docker build locally (if Docker is available)**

Run: `docker build -t eu-tools-mcp . && docker run --rm -e PAY_TO=0x46dDBFf5203cBb28EF6236eCf431e2BBe3E6f7F4 -e X402_NETWORK=eip155:84532 -p 8080:8080 eu-tools-mcp` then `curl -s http://localhost:8080/` in another shell.
Expected: landing text. Stop the container. If Docker isn't installed locally, skip — Fly builds remotely (`fly deploy --remote-only`).

- [ ] **Step 4: Write `README.md`**

```markdown
# eu-tools-mcp

Paid MCP tools for AI agents — pay per call in USDC on Base via the
[x402](https://docs.cdp.coinbase.com/x402/welcome) protocol. No signup, no
API key: your agent's wallet signs a payment, the tool answers.

Built with [x402-mica](https://www.npmjs.com/package/x402-mica): every paid
call is logged with a MiCA-compliance flag to a **public, live audit
dashboard** — see below.

## Tools

| Tool | Price | What it does |
|------|-------|--------------|
| `validate_vat(country, vat_number)` | $0.005 | Checks an EU VAT number against the official [VIES](https://ec.europa.eu/taxation_customs/vies/) registry; returns validity + registered company name/address. |
| `eur_fx(currency, date?)` | $0.001 | Official ECB euro reference rate (latest, or a business day within the last 90 days). |

Endpoint: `https://eu-tools-mcp.fly.dev/mcp` (MCP Streamable HTTP, stateless)

## Call it from an agent

Your MCP client needs x402 payment support and a funded wallet (USDC on
Base, a plain EOA — smart-wallet/EIP-7702 signers are not supported by
USDC's transfer authorization):

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { wrapMCPClientWithPayment, x402Client } from "@x402/mcp";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.WALLET_KEY);
const mcp = wrapMCPClientWithPayment(
  new Client({ name: "my-agent", version: "1.0.0" }),
  new x402Client().register("eip155:*", new ExactEvmScheme(account)),
  { autoPayment: true },
);
await mcp.connect(new StreamableHTTPClientTransport(new URL("https://eu-tools-mcp.fly.dev/mcp")));
const res = await mcp.callTool("validate_vat", { country: "IE", vat_number: "6388047V" });
```

Tool listing (`tools/list`) is free — only calls are paid.

## Live audit dashboard

Every paid call lands in a public, read-only MiCA audit trail (timestamp,
asset, amount, payer, on-chain tx, `mica_compliant` flag):

**https://eu-tools-mcp.fly.dev/audit?key=PUBLIC_DEMO_KEY**

CSV/JSON export: append `&format=csv` or `&format=json`.

## Notes

- Payment settles before the tool runs (that's x402); if VIES has a
  member-state outage you get a structured error for that call, not a
  refund. That's why the price is half a cent.
- Non-custodial: funds go payer wallet → seller wallet; this server never
  holds money.

## Run your own

`cp .env.example .env`, set `PAY_TO`, `npm install && npm run dev` — then
read the [x402-mica docs](https://github.com/iCx6/x402-mica) for mainnet
(CDP facilitator keys) and dashboard options.
```

(Replace `PUBLIC_DEMO_KEY` with the actual generated key during Task 6, and the Fly URLs if the app name differs.)

- [ ] **Step 5: Commit**

```bash
git add README.md Dockerfile .dockerignore fly.toml
git commit -m "Add README, Dockerfile and Fly.io config"
```

---

### Task 6: GitHub repo + Fly.io deploy

**Files:**
- Modify: `README.md` (fill in the real `PUBLIC_DEMO_KEY`)

**User-interactive steps — coordinate with the user; they run `fly auth login`.**

- [ ] **Step 1: Create the GitHub repo and push**

```bash
gh repo create eu-tools-mcp --public --source . --push
```

Expected: repo at `https://github.com/iCx6/eu-tools-mcp`, master pushed. (If `gh` is not authenticated, ask the user to run `! gh auth login`.)

- [ ] **Step 2: User logs in to Fly**

Ask the user to run: `! fly auth login` (requires their Fly.io account; if `fly` is not installed, first: `! powershell -c "iwr https://fly.io/install.ps1 -useb | iex"` and restart the shell).

- [ ] **Step 3: Create app + volume + secrets**

Generate the public demo key: `node -e "console.log('demo-' + require('crypto').randomBytes(8).toString('hex'))"` — record it.

```bash
fly apps create eu-tools-mcp
fly volumes create audit_data --size 1 --region ams --app eu-tools-mcp --yes
fly secrets set --app eu-tools-mcp PAY_TO=<seller address from x402-mica .env> CDP_API_KEY_ID=<from .env> CDP_API_KEY_SECRET=<from .env> AUDIT_API_KEY=<generated demo key>
```

Expected: app, 1GB volume, and secrets staged. (`X402_NETWORK` defaults to mainnet in code — no secret needed. If the name `eu-tools-mcp` is taken, pick `eu-tools-mcp-<suffix>` and update `fly.toml` `app` + README URLs.)

- [ ] **Step 4: Deploy**

Run: `fly deploy --remote-only`
Expected: build + release succeed, health check on :8080 passes, `https://eu-tools-mcp.fly.dev/` serves the landing text and `.../audit?key=<demo key>` returns the (empty) dashboard.

- [ ] **Step 5: Update README with the real demo key + verified URLs, commit, push**

```bash
git add README.md
git commit -m "Fill in live audit dashboard demo key"
git push
```

---

### Task 7: Live mainnet smoke test (real money)

**No new files — the final verification. Needs the funded mainnet payer (~0.99 USDC).**

- [ ] **Step 1: Paid calls against production**

In `.env` set `MCP_URL=https://eu-tools-mcp.fly.dev/mcp` and `PAYER_KEY` = the mainnet payer key (0x91ED…10a1's key from the x402-mica `.env` — plain EOA, ≠ PAY_TO).

Run: `npm run smoke`
Expected: `validate_vat` returns `valid: true, name: "GOOGLE IRELAND LIMITED"...`; `eur_fx` returns today's USD rate. Total cost: $0.006 real USDC.

- [ ] **Step 2: Verify the public audit trail**

```bash
curl -s "https://eu-tools-mcp.fly.dev/audit?format=json&key=<demo key>"
```

Expected: 2 rows, network `eip155:8453`, amounts `$0.005`/`$0.001`, `mica_compliant: 1`, real tx refs (spot-check one on basescan.org).

- [ ] **Step 3: Confirm persistence across restart**

Run: `fly machine restart --app eu-tools-mcp` (get the machine id from `fly machines list --app eu-tools-mcp` if needed), wait for it to come back, re-run the curl from Step 2.
Expected: the same 2 audit rows survive the restart (volume works).

- [ ] **Step 4: Done marker**

Update the x402-mica repo's CLAUDE.md roadmap line "Cloud deploy of the hosted MCP demo" → note it shipped as the separate `eu-tools-mcp` project, and record the outcome in memory. Commit that in the x402-mica repo.
