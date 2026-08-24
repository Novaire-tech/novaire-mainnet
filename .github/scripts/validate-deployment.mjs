#!/usr/bin/env node
// Validates apps/web/src/config/deployments.<network>.json for missing/placeholder/zero-value contract IDs.
// Usage: node .github/scripts/validate-deployment.mjs <path-to-deployments.json>
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: validate-deployment.mjs <deployments.json>");
  process.exit(2);
}

const REQUIRED_KEYS = [
  "underlying_token",
  "factory",
  "factory_wasm",
  "maturity_engine",
  "maturity_engine_wasm",
  "sy_wrapper_wasm",
  "vault_wasm",
  "tokenizer_wasm",
  "pt_token_wasm",
  "yt_token_wasm",
  "marketplace_wasm",
  "intent_engine_wasm",
  "rollover_wasm",
];

// Stellar/Soroban contract ("C...") and account ("G...") strkeys are 56 chars, base32.
const STRKEY_RE = /^[CG][A-Z2-7]{55}$/;
const WASM_HASH_RE = /^[0-9a-f]{64}$/i;

const PLACEHOLDER_VALUES = new Set([
  "",
  "TODO",
  "TBD",
  "CHANGEME",
  "PLACEHOLDER",
  "0x0000000000000000000000000000000000000000000000000000000000000000",
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", // zero-padded strkey
]);

let data;
try {
  data = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  console.error(`::error::Failed to parse ${file}: ${err.message}`);
  process.exit(1);
}

let failed = false;

function fail(key, reason) {
  console.error(`::error::${file}: "${key}" ${reason}`);
  failed = true;
}

for (const key of REQUIRED_KEYS) {
  const value = data[key];

  if (value === undefined || value === null) {
    fail(key, "is missing");
    continue;
  }
  if (typeof value !== "string") {
    fail(key, `is not a string (got ${typeof value})`);
    continue;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    fail(key, "is an empty string");
    continue;
  }
  if (PLACEHOLDER_VALUES.has(trimmed) || /^(placeholder|todo|tbd|changeme|xxx+)$/i.test(trimmed)) {
    fail(key, `looks like a placeholder value ("${trimmed}")`);
    continue;
  }
  if (/^0+$/.test(trimmed.replace(/^0x/, ""))) {
    fail(key, "is an all-zero value");
    continue;
  }

  const isWasmKey = key.endsWith("_wasm");
  if (isWasmKey && !WASM_HASH_RE.test(trimmed)) {
    fail(key, `does not look like a valid 32-byte wasm hash: "${trimmed}"`);
  } else if (!isWasmKey && !STRKEY_RE.test(trimmed)) {
    fail(key, `does not look like a valid Stellar contract/account strkey: "${trimmed}"`);
  }
}

if (failed) {
  console.error(`\n::error::Deployment validation FAILED for ${file}`);
  process.exit(1);
}

console.log(`Deployment validation passed for ${file} (${REQUIRED_KEYS.length} keys checked).`);
