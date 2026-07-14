import type { RequestHandler } from "express";
import { getRate, fxCurrencyError, fxDateError } from "./ecb.js";

/**
 * Runs BEFORE the paywall in the Express chain: every caller error decidable for
 * free (shape, unknown currency, future/out-of-window date) is rejected 400
 * unpaid — never charge for a request that was never fulfillable. What remains
 * post-payment is only genuinely unforeseeable: an ECB-side failure (502).
 */
export const eurFxValidate: RequestHandler = (req, res, next) => {
  const { currency, date } = req.query;
  const err =
    (currency
      ? typeof currency === "string" ? fxCurrencyError(currency) : "currency must be a single value"
      : null) ??
    (date
      ? typeof date === "string" ? fxDateError(date) : "date must be a single value"
      : null);
  if (err) {
    res.status(400).json({ error: err });
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
    // Paid but unservable — with input rejected pre-paywall this is a genuine
    // ECB-side failure; non-custodial x402 has no refunds, mirror the MCP
    // tool's structured-error behaviour.
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
};
