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
