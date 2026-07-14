import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { withPayment, auditDashboard, x402Middleware } from "x402-mica";
import { parseVatInput, checkVat } from "./vies.js";
import { getRate, fxCurrencyError, fxDateError } from "./ecb.js";
import { eurFxValidate, eurFxHandler } from "./eur-fx.js";

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
      "or a specific date (YYYY-MM-DD within the last 90 days). Weekends/holidays return the most " +
      "recent preceding business day's rate — the response carries both requested_date and " +
      "rate_date, so a carried-forward rate is always explicit. Costs $0.001 USDC per call via " +
      "x402 (Base).",
    {
      // superRefine runs in the SDK's schema validation, BEFORE the payment
      // wrapper — invalid input is rejected unpaid, same as the HTTP route.
      currency: z.string()
        .superRefine((v, ctx) => {
          const e = fxCurrencyError(v);
          if (e) ctx.addIssue({ code: z.ZodIssueCode.custom, message: e });
        })
        .describe("3-letter ISO currency code on the ECB reference list, e.g. USD, HUF, GBP"),
      date: z.string()
        .superRefine((v, ctx) => {
          const e = fxDateError(v);
          if (e) ctx.addIssue({ code: z.ZodIssueCode.custom, message: e });
        })
        .optional()
        .describe("YYYY-MM-DD within the last 90 days; omit for latest. Non-business days return the preceding business day's rate (see rate_date)"),
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

// Plain-HTTP twin of the eur_fx MCP tool: a bare GET gets a real HTTP 402
// challenge (probe-friendly), a paid GET gets the same ECB data at the same
// price, logged to the same audit db. Note: unlike withPayment, x402Middleware
// wires its facilitator eagerly — on mainnet the CDP keys must be set at startup.
app.use("/eur-fx", eurFxValidate); // 400 on malformed input BEFORE any 402/charge
app.use(
  x402Middleware({
    ...paid,
    route: "GET /eur-fx",
    price: "$0.001",
    description:
      "Official ECB euro reference exchange rate (non-business days return the preceding business day's rate, labelled via rate_date)",
  }),
);
app.get("/eur-fx", eurFxHandler);

app.get("/audit", auditDashboard({ dbPath, apiKey: process.env.AUDIT_API_KEY }));

app.get("/", (_req, res) => {
  res.type("text/plain").send(
    "eu-tools-mcp — paid MCP tools for AI agents (x402, USDC on Base)\n\n" +
      "POST /mcp   MCP Streamable HTTP endpoint\n" +
      "  validate_vat  $0.005  EU VAT number check (official VIES registry)\n" +
      "  eur_fx        $0.001  official ECB euro reference rates\n" +
      "GET /eur-fx  $0.001  same ECB rates over plain HTTP (x402: the 402 challenge tells you how to pay);\n" +
      "             weekends/holidays return the preceding business day's rate — compare rate_date to requested_date\n" +
      "GET /audit  live MiCA-compliance audit trail (read-only)\n\n" +
      "Docs: https://github.com/iCx6/eu-tools-mcp — built with x402-mica (npmjs.com/package/x402-mica)",
  );
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => console.log(`eu-tools-mcp on :${port} (network ${network})`));
