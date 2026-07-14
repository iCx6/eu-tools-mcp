import assert from "node:assert/strict";
import { eurFxValidate, eurFxHandler } from "./eur-fx.js";

// Minimal req/res doubles — no network needed except where fetch is stubbed.
function reqRes(query: Record<string, unknown>) {
  const out = { status: 200, body: undefined as unknown, nextCalled: false };
  const req = { query };
  const res = {
    status(c: number) { out.status = c; return this; },
    json(b: unknown) { out.body = b; return this; },
  };
  const next = () => { out.nextCalled = true; };
  return { req, res, next, out };
}
const runValidate = (q: Record<string, unknown>) => {
  const t = reqRes(q);
  (eurFxValidate as never as (r: unknown, s: unknown, n: unknown) => void)(t.req, t.res, t.next);
  return t.out;
};
const runHandler = async (q: Record<string, unknown>) => {
  const t = reqRes(q);
  await (eurFxHandler as never as (r: unknown, s: unknown) => Promise<void>)(t.req, t.res);
  return t.out;
};

// validator: malformed currency -> 400 BEFORE the paywall (next never called, so
// no 402 challenge and no charge for a request that was never fulfillable)
{
  const out = runValidate({ currency: "not-a-currency" });
  assert.equal(out.status, 400);
  assert.equal(out.nextCalled, false);
  assert.match((out.body as { error: string }).error, /currency/);
}

// validator: repeated param (?currency=a&currency=b arrives as an array) -> 400
{
  const out = runValidate({ currency: ["USD", "HUF"] });
  assert.equal(out.status, 400);
  assert.equal(out.nextCalled, false);
}

// validator: malformed date -> 400 naming the date param
{
  const out = runValidate({ currency: "EUR", date: "07/14/2026" });
  assert.equal(out.status, 400);
  assert.equal(out.nextCalled, false);
  assert.match((out.body as { error: string }).error, /date/);
}

// validator: well-formed request passes through untouched to the paywall
{
  const out = runValidate({ currency: "usd", date: "2026-07-14" });
  assert.equal(out.nextCalled, true);
  assert.equal(out.body, undefined);
}

// validator: omitted/empty params are valid (defaults apply downstream)
{
  const out = runValidate({});
  assert.equal(out.nextCalled, true);
  assert.equal(runValidate({ currency: "", date: "" }).nextCalled, true);
}

// handler success: EUR is served without hitting the ECB (rate 1)
{
  const out = await runHandler({ currency: "EUR" });
  assert.equal(out.status, 200);
  assert.equal((out.body as { currency: string }).currency, "EUR");
  assert.equal((out.body as { rate: number }).rate, 1);
}

// handler: genuine ECB-side failure on a VALID request -> 502 (post-payment; the
// no-refund case we deliberately keep). Stub fetch to simulate the outage.
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("ECB unreachable (stubbed)"); };
  try {
    const out = await runHandler({ currency: "USD" });
    assert.equal(out.status, 502);
    assert.match((out.body as { error: string }).error, /ECB unreachable/);
  } finally {
    globalThis.fetch = origFetch;
  }
}

console.log("eur-fx.test.ts: all assertions passed");
