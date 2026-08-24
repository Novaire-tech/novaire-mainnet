#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Read-only live-state probe. SIMULATES ONLY — never submits a transaction.
//
// Prints protocol state plus a swap-quote size sweep, so a curve saturation
// (see FINDINGS.md P1-01) is visible as a flat output column.
//
//   node scripts/probe-live.mjs                     # testnet, addresses from deployments/testnet.toml
//   AMM=C... SY=C... node scripts/probe-live.mjs    # override individual addresses
//   RPC_URL=... NETWORK_PASSPHRASE=... node scripts/probe-live.mjs
import {
  rpc, Contract, Networks, TransactionBuilder, Account, scValToNative, nativeToScVal, BASE_FEE,
} from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOML = process.env.DEPLOYMENT_TOML || path.resolve(HERE, '../deployments/testnet.toml');

function fromToml(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const txt = fs.readFileSync(file, 'utf-8');
  for (const key of ['underlying', 'sy_wrapper', 'pt_token', 'yt_token', 'tokenizer', 'amm']) {
    const m = txt.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'm'));
    if (m) out[key] = m[1];
  }
  const src = txt.match(/^\s*deployer_public_key\s*=\s*"([^"]+)"/m);
  if (src) out.source = src[1];
  return out;
}

const d = fromToml(TOML);
const C = {
  sy_wrapper: process.env.SY || d.sy_wrapper,
  pt_token: process.env.PT || d.pt_token,
  yt_token: process.env.YT || d.yt_token,
  tokenizer: process.env.TOKENIZER || d.tokenizer,
  amm: process.env.AMM || d.amm,
};
const SOURCE = process.env.SOURCE || d.source;
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

for (const [k, v] of Object.entries(C)) {
  if (!v) { console.error(`missing address for ${k} (set $${k.toUpperCase()} or fix ${TOML})`); process.exit(1); }
}
if (!SOURCE) { console.error('missing simulation source account (set $SOURCE)'); process.exit(1); }

const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });
let seq = '0';
try { seq = (await server.getAccount(SOURCE)).sequenceNumber(); }
catch (e) { console.error(`warn: could not load source account ${SOURCE}: ${e.message}`); }

async function sim(contractId, method, args = []) {
  const tx = new TransactionBuilder(new Account(SOURCE, seq), { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const r = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(r)) {
    const code = r.error.match(/#\d+/)?.[0] ?? '';
    return { err: code || r.error.replace(/\s+/g, ' ').slice(0, 120) };
  }
  try { return { ok: scValToNative(r.result.retval) }; }
  catch (e) { return { err: 'decode: ' + e.message }; }
}
const i128 = (n) => nativeToScVal(BigInt(Math.round(n)), { type: 'i128' });
const j = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));

console.log(`network : ${PASSPHRASE}`);
console.log(`rpc     : ${RPC_URL}`);
console.log(`source  : ${SOURCE}`);
for (const [k, v] of Object.entries(C)) console.log(`${k.padEnd(11)}: ${v}`);

console.log('\n=== protocol state ===');
const reads = [
  ['amm', 'state'], ['amm', 'reserve_pt'], ['amm', 'reserve_sy'], ['amm', 'total_lp'],
  ['amm', 'spot_apy'], ['amm', 'twap_apy'], ['amm', 'twap_warming_up'], ['amm', 'maturity'],
  ['sy_wrapper', 'exchange_rate'], ['sy_wrapper', 'total_supply'],
  ['pt_token', 'total_supply'], ['yt_token', 'total_supply'],
  ['tokenizer', 'escrowed_sy'], ['tokenizer', 'is_matured'], ['tokenizer', 'maturity_rate'],
];
let rate = 1;
for (const [c, m] of reads) {
  const r = await sim(C[c], m);
  if (c === 'sy_wrapper' && m === 'exchange_rate' && r.ok) rate = Number(r.ok) / 1e18;
  console.log(`${(c + '.' + m).padEnd(28)}: ${r.err ? 'ERROR ' + r.err : j(r.ok)}`);
}

// Curve saturation sweep. A flat column means the exact-in solver has hit its
// bound: extra input buys nothing. Before P1-01 that extra input was confiscated.
console.log('\n=== quote size sweep (units of 1e7; flat column == curve saturation) ===');
console.log(' size    |     pt_out (sell PT->SY) |      pt_out (buy) |      yt_out (buy) |      sy_out (sell YT)');
const SIZES = [1e3, 1e4, 1e5, 1e6, 1e7, 4e7, 6e7, 1e8, 4e8];
for (const s of SIZES) {
  const cells = [];
  for (const m of ['quote_pt_for_sy', 'quote_sy_for_pt', 'quote_sy_for_yt', 'quote_yt_for_sy']) {
    const r = await sim(C.amm, m, [i128(s)]);
    if (r.err) { cells.push('ERR ' + r.err); continue; }
    const out = Number(r.ok);
    const px = m === 'quote_pt_for_sy' ? (out * rate) / s
      : m === 'quote_sy_for_pt' ? (s * rate) / out
        : m === 'quote_sy_for_yt' ? (s * rate) / out
          : (out * rate) / s;
    cells.push(`${(out / 1e7).toFixed(6)} @${px.toFixed(5)}`);
  }
  console.log(`${(s / 1e7).toFixed(4).padStart(8)} | ${cells.map((c) => c.padStart(23)).join(' | ')}`);
}
console.log('\nPT+YT should sum to ~1.00 at the smallest size (no-arb check).');
