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

**https://eu-tools-mcp.fly.dev/audit?key=demo-c43d89b159ec2227**

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
