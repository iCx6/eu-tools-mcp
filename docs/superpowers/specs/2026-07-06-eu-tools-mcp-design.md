# EU Tools MCP — design

**Date:** 2026-07-06
**Status:** approved by user (brainstorming session)

## Purpose

A hosted, paid MCP server that AI agents pay per call, built as the first
external-style consumer of the just-published `x402-mica@0.2.0` npm package.
Primary goal: **showcase + validation** of x402-mica (the launch-post
centerpiece). Revenue is a bonus, not the goal.

Dogfooding constraint: this project installs `x402-mica` from the npm
registry exactly like an outside developer would. It lives in its own repo
(`eu-tools-mcp`), NOT inside the x402-mica library repo.

## What it does

Streamable HTTP MCP server (stateless mode, same recipe as x402-mica's
`mcp-http-example.ts`) exposing two paid tools, priced per tool via
`withPayment`:

| Tool | Price | Upstream | What it returns |
|------|-------|----------|-----------------|
| `validate_vat(country, vat_number)` | $0.005 USDC | EU Commission VIES REST API | whether the VAT number is valid + registered company name/address |
| `eur_fx(currency, date?)` | $0.001 USDC | ECB official reference rates | the official EUR exchange rate (latest, or for a given historical date) |

Both tools are things an LLM cannot do reliably on its own (live,
authoritative data) and both fit the EU/MiCA story of the package.

## Decisions

- **Network/asset:** Base mainnet, real USDC (package default). EURC stays a
  one-line switch mentioned in the launch post; frictionless trying beats the
  "both assets live" demo.
- **Hosting:** Fly.io smallest machine (~$2–3/mo), persistent volume for the
  SQLite audit DB so it survives redeploys.
- **Audit dashboard public:** `/audit` deployed with a **publicly documented
  read-only key** in the README. The live audit trail (timestamp, amount,
  payer, tx, `mica_compliant`) is the product's best advertisement. Payer
  addresses are public on-chain anyway; the dashboard is read-only by design.
- **Repo:** `C:\Users\attil\eu-tools-mcp`, own GitHub repo. Expected size:
  ~2 source files, ~150 lines (`server.ts` with both tools + payment
  decoration, patterned on `mcp-http-example.ts`).

## Error handling

- **VIES downtime:** member states go down for maintenance. x402 settles
  payment *before* the handler runs and refunds don't exist non-custodially,
  so a caller who hits VIES downtime has paid $0.005 for a structured
  `MS_UNAVAILABLE` error. Mitigation: tiny price + the limitation documented
  in the tool description.
- **Input validation:** VAT number format pre-checked locally (country code +
  syntax) before hitting VIES; malformed input returns a structured error.
  Currency codes validated against the ECB rate table.
- **ECB caching:** rates are daily; in-memory cache (~1h TTL for the daily
  file, day-keyed for historical) instead of hitting ECB per call.

## Testing

- Pure-logic unit tests (no network): VAT format pre-validation, ECB
  XML/CSV parsing.
- Live smoke test before launch: real mainnet paid call to both tools from
  the existing funded payer wallet (~0.99 USDC), verifying the audit row —
  same choreography as previous live-verify rounds.

## Deliberately skipped (YAGNI)

- Rate limiting — the price is the rate limit.
- VIES response caching — VAT status can change; callers pay for freshness.
- MCP session management — stateless HTTP mode, per the proven example.
- Monitoring — Fly logs suffice at this scale.

## User-side prerequisites

- Fly.io account (signup + card), then interactive `fly auth login` at
  deploy time.
- `PAY_TO` + CDP API keys reused from the existing x402-mica `.env`.
