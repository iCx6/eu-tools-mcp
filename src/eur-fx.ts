import type { RequestHandler } from "express";
import { getRate } from "./ecb.js";

/**
 * Runs BEFORE the paywall in the Express chain: a malformed request is rejected
 * 400 unpaid — never charge for a request that was never fulfillable. Only shape
 * is checked here; semantic failures (currency not on the ECB list, no rate for
 * the date) surface post-payment as 502 from the handler.
 */
export const eurFxValidate: RequestHandler = (req, res, next) => {
  const { currency, date } = req.query;
  if (currency && !(typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency.trim()))) {
    res.status(400).json({ error: "invalid currency — use a single 3-letter ISO 4217 code, e.g. USD" });
    return;
  }
  if (date && !(typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date))) {
    res.status(400).json({ error: "invalid date — use YYYY-MM-DD" });
    return;
  }
  next();
};

/**
 * Paid HTTP twin of the eur_fx MCP tool — mounted behind x402Middleware in
 * server.ts, so this only runs on a settled payment. Same ECB data, same price.
 * GET /eur-fx?currency=USD&date=YYYY-MM-DD (both optional).
 */
export const eurFxHandler: RequestHandler = async (req, res) => {
  try {
    res.json(
      await getRate(
        typeof req.query.currency === "string" && req.query.currency !== "" ? req.query.currency : "USD",
        typeof req.query.date === "string" && req.query.date !== "" ? req.query.date : undefined,
      ),
    );
  } catch (err) {
    // Paid but unservable (bad input or ECB down) — non-custodial x402 has no
    // refunds; mirror the MCP tool's structured-error behaviour.
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
};
