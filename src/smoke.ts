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
