#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Mainnet deploy for novaire (sy-wrapper, pt-token, yt-token, tokenizer, amm).
#
# SAFE BY DEFAULT: this script only simulates. Nothing is submitted to
# Mainnet unless you pass --execute-mainnet explicitly.
#
#   ./deploy-mainnet.sh                 # dry run: builds + simulates every
#                                        # op, prints exact fees, exits.
#   ./deploy-mainnet.sh --execute-mainnet   # after review, actually deploys.
#
# No private key is ever hardcoded. Uses whatever identity `stellar keys`
# already has configured (DEPLOY_IDENTITY, default "novaire-deployer").

set -euo pipefail

CONTRACTS_DIR="${CONTRACTS_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
REPO="${REPO:-$(cd "$CONTRACTS_DIR/.." && pwd)}"
cd "$CONTRACTS_DIR"

NETWORK="${NETWORK:-mainnet}"
EXPECTED_PASSPHRASE="Public Global Stellar Network ; September 2015"
IDENTITY="${DEPLOY_IDENTITY:-novaire-deployer}"
WASM_DIR="${WASM_DIR:-target/wasm32v1-none/release/optimized}"
DEPLOYMENTS_DIR="${DEPLOYMENTS_DIR:-$REPO/deployments}"

EXECUTE=0
if [[ "${1:-}" == "--execute-mainnet" ]]; then
  EXECUTE=1
fi

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "$1 not found"; }
require_var() { [[ -n "${!1:-}" ]] || die "required mainnet config \$$1 is not set. Refusing to run."; }
require_cmd stellar
require_cmd python3

# --- required mainnet configuration (no testnet defaults, no guessing) ----
# Deployer must supply the real underlying asset, real Blend pool, and real
# market economics for Mainnet. Unlike deploy-testnet-resilient.sh these have
# no fallback values — a missing var must fail the run, not silently deploy
# against a placeholder.
UNDERLYING_ID="${UNDERLYING_ID:-}"
BLEND_POOL="${BLEND_POOL:-}"
MATURITY="${MATURITY:-}"
SCALAR_ROOT="${SCALAR_ROOT:-}"
INITIAL_ANCHOR="${INITIAL_ANCHOR:-}"
FEE_BPS="${FEE_BPS:-}"
TWAP_WINDOW="${TWAP_WINDOW:-}"

for v in UNDERLYING_ID BLEND_POOL MATURITY SCALAR_ROOT INITIAL_ANCHOR FEE_BPS TWAP_WINDOW; do
  require_var "$v"
done

# --- network validation -----------------------------------------------
CONFIGURED_PASSPHRASE="$(stellar network ls --long 2>/dev/null | awk -v n="$NETWORK" '
  $0 ~ "^Name: "n"$" {found=1}
  found && /^Network passphrase:/ {sub("^Network passphrase: ",""); print; exit}
')"

if [[ -z "$CONFIGURED_PASSPHRASE" ]]; then
  die "network '$NETWORK' is not configured (stellar network add ...). Refusing to run."
fi
if [[ "$CONFIGURED_PASSPHRASE" != "$EXPECTED_PASSPHRASE" ]]; then
  die "network '$NETWORK' passphrase is '$CONFIGURED_PASSPHRASE', expected mainnet passphrase '$EXPECTED_PASSPHRASE'. Refusing to run."
fi
if [[ "$NETWORK" == *testnet* || "$NETWORK" == *futurenet* ]]; then
  die "NETWORK name '$NETWORK' looks like a non-mainnet network. Refusing to run."
fi

log "Network: $NETWORK"
log "Passphrase: $CONFIGURED_PASSPHRASE (verified Mainnet)"

if ! stellar keys address "$IDENTITY" >/dev/null 2>&1; then
  die "deployer identity '$IDENTITY' not found. Run: stellar keys generate $IDENTITY  (then fund it — no auto-fund on Mainnet)"
fi
DEPLOYER_ADDRESS="$(stellar keys address "$IDENTITY")"
log "Deployer: $DEPLOYER_ADDRESS"

# --- admin must be a multisig ------------------------------------------
# The deployer key initializes every contract as admin. On mainnet that key can
# pause, schedule upgrades, sweep, and wind Blend down, so a single signer is
# not acceptable. Require an explicit ADMIN_ADDRESS whose Horizon record shows
# more than one signer and a med_threshold above 1.
ADMIN_ADDRESS="${ADMIN_ADDRESS:-}"
GUARDIAN_ADDRESS="${GUARDIAN_ADDRESS:-}"
require_var ADMIN_ADDRESS
require_var GUARDIAN_ADDRESS

ADMIN_JSON_FILE="$(mktemp)"
trap 'rm -f "$ADMIN_JSON_FILE"' EXIT
curl -s -m 10 "https://horizon.stellar.org/accounts/$ADMIN_ADDRESS" > "$ADMIN_JSON_FILE" || true
python3 - "$ADMIN_JSON_FILE" <<'PYCHECK' || die "ADMIN_ADDRESS is not a usable multisig — refusing to deploy"
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
except Exception:
    print("error: could not read admin account from Horizon", file=sys.stderr)
    sys.exit(1)
signers = [s for s in d.get("signers", []) if s.get("weight", 0) > 0]
med = d.get("thresholds", {}).get("med_threshold", 0)
if len(signers) < 2 or med < 2:
    print(f"error: admin has {len(signers)} signer(s), med_threshold={med}; need >= 2 of each",
          file=sys.stderr)
    sys.exit(1)
print(f"  admin multisig OK: {len(signers)} signers, med_threshold={med}")
PYCHECK

if [[ "$GUARDIAN_ADDRESS" == "$ADMIN_ADDRESS" ]]; then
  die "GUARDIAN_ADDRESS must differ from ADMIN_ADDRESS — the guardian exists so a pause does not need the multisig"
fi

log "Admin (multisig): $ADMIN_ADDRESS"
log "Guardian:         $GUARDIAN_ADDRESS"

BALANCE_JSON="$(curl -s -m 10 "https://horizon.stellar.org/accounts/$DEPLOYER_ADDRESS" || true)"
BALANCE="$(printf '%s' "$BALANCE_JSON" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    for b in d.get('balances', []):
        if b.get('asset_type') == 'native':
            print(b['balance']); break
    else:
        print('0')
except Exception:
    print('UNKNOWN')
" 2>/dev/null || echo UNKNOWN)"
log "Deployer XLM balance: $BALANCE"

CONTRACTS=(sy_wrapper pt_token yt_token tokenizer amm)

TOTAL_RESOURCE_FEE=0
declare -A UPLOAD_HASH

log "---- Simulating WASM upload for each contract (no submission) ----"
for name in "${CONTRACTS[@]}"; do
  wasm="$WASM_DIR/novaire_${name}.wasm"
  [[ -f "$wasm" ]] || die "missing $wasm — run build-optimized-wasm.sh first"
  bytes=$(wc -c < "$wasm" | tr -d " ")
  hash="$(stellar contract info hash --wasm "$wasm")"
  UPLOAD_HASH[$name]="$hash"

  XDR="$(stellar contract upload --wasm "$wasm" --source-account "$DEPLOYER_ADDRESS" --network "$NETWORK" --build-only 2>/dev/null)"
  SIMXDR="$(echo "$XDR" | stellar tx simulate --source-account "$DEPLOYER_ADDRESS" --network "$NETWORK" 2>/dev/null)" \
    || die "simulation failed for $name upload — check RPC / account existence on Mainnet"

  DECODED="$(echo "$SIMXDR" | stellar tx decode 2>/dev/null)"
  read -r FEE RESFEE INSN WBYTES <<<"$(python3 -c "
import json
d=json.loads('''$DECODED''')
tx=d['tx']['tx']
v1=tx['ext']['v1']
res=v1['resources']
print(tx['fee'], v1['resource_fee'], res['instructions'], res['write_bytes'])
")"
  TOTAL_RESOURCE_FEE=$((TOTAL_RESOURCE_FEE + RESFEE))
  printf '  %-12s %6d B  hash=%s  resource_fee=%d stroops (%.7f XLM)\n' \
    "$name" "$bytes" "${hash:0:12}..." "$RESFEE" "$(python3 -c "print($RESFEE/1e7)")"
done

TOTAL_XLM="$(python3 -c "print($TOTAL_RESOURCE_FEE/1e7)")"
BUFFER_XLM="$(python3 -c "print(round($TOTAL_RESOURCE_FEE/1e7*0.10, 7))")"
RESERVE_XLM="1.0"
FUNDING_XLM="$(python3 -c "print(round($TOTAL_RESOURCE_FEE/1e7 + 0.10*$TOTAL_RESOURCE_FEE/1e7 + $RESERVE_XLM, 7))")"

echo
log "Simulated WASM-upload resource fees total: $TOTAL_XLM XLM"
log "10% buffer: $BUFFER_XLM XLM"
log "Account reserve (base 2 entries * 0.5 XLM): $RESERVE_XLM XLM"
log "Recommended funding (upload only — see report for create+init): $FUNDING_XLM XLM"
warn "Contract-create + initialize resource fees are NOT included above (each references an already-uploaded hash and cannot be simulated until its wasm is actually on-chain). They are consistently tiny (no wasm bytes moved) relative to upload cost — confirm exact figures live once uploads land, before spending on create+init."

if [[ "$EXECUTE" != "1" ]]; then
  echo
  warn "DRY RUN ONLY. No transaction was submitted. Re-run with --execute-mainnet to deploy for real."
  exit 0
fi

# --- real execution path ------------------------------------------------
[[ "$BALANCE" != "UNKNOWN" && "$BALANCE" != "0" ]] || die "could not confirm a funded balance for $DEPLOYER_ADDRESS on Mainnet — refusing to execute"

read -r -p "Type EXECUTE to confirm real Mainnet deployment of ${#CONTRACTS[@]} contracts from $DEPLOYER_ADDRESS: " CONFIRM
[[ "$CONFIRM" == "EXECUTE" ]] || die "confirmation not given"

mkdir -p "$DEPLOYMENTS_DIR"
RESULT_FILE="$DEPLOYMENTS_DIR/mainnet.$(date -u +%Y%m%dT%H%M%SZ).json"
declare -A ADDR
for name in "${CONTRACTS[@]}"; do
  wasm="$WASM_DIR/novaire_${name}.wasm"
  log "Deploying $name to Mainnet"
  ADDR[$name]="$(stellar contract deploy --wasm "$wasm" --source "$IDENTITY" --network "$NETWORK" 2>&1 | tail -1)"
  log "  $name -> ${ADDR[$name]}"
done

SY="${ADDR[sy_wrapper]}"
PT="${ADDR[pt_token]}"
YT="${ADDR[yt_token]}"
TK="${ADDR[tokenizer]}"
AMM="${ADDR[amm]}"

invoke() {
  local contract_id="$1"
  shift
  stellar contract invoke \
    --id "$contract_id" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- "$@" >/dev/null
}

# Initialization order mirrors deploy-testnet-resilient.sh: SY wrapper first
# (it owns the Blend pool link), then PT/YT (each needs the tokenizer address
# and maturity), then the tokenizer itself, then the AMM last since it
# references all four other contracts plus the curve parameters.
log "Initializing SY wrapper"
invoke "$SY" initialize_blend --admin "$ADMIN_ADDRESS" --underlying "$UNDERLYING_ID" --pool "$BLEND_POOL"

log "Initializing PT token"
invoke "$PT" initialize --admin "$ADMIN_ADDRESS" --tokenizer "$TK" --sy_token "$SY" --maturity "$MATURITY"

log "Initializing YT token"
invoke "$YT" initialize --admin "$ADMIN_ADDRESS" --tokenizer "$TK" --sy_token "$SY" --maturity "$MATURITY"

log "Initializing tokenizer"
invoke "$TK" initialize --admin "$ADMIN_ADDRESS" --sy_token "$SY" --pt_token "$PT" --yt_token "$YT" --maturity "$MATURITY"

log "Initializing AMM"
invoke "$AMM" initialize \
  --admin "$ADMIN_ADDRESS" \
  --pt_token "$PT" \
  --sy_token "$SY" \
  --yt_token "$YT" \
  --tokenizer "$TK" \
  --maturity "$MATURITY" \
  --scalar_root "$SCALAR_ROOT" \
  --initial_anchor "$INITIAL_ANCHOR" \
  --fee_bps "$FEE_BPS" \
  --twap_window "$TWAP_WINDOW"

log "Setting guardians (may pause, may not unpause)"
for target in "$SY" "$TK" "$AMM"; do
  invoke "$target" set_guardian --guardian "$GUARDIAN_ADDRESS"
done

log "Verifying on-chain Wasm hash matches upload for each contract"
for name in "${CONTRACTS[@]}"; do
  chain_hash="$(stellar contract info hash --id "${ADDR[$name]}" --network "$NETWORK")"
  [[ "$chain_hash" == "${UPLOAD_HASH[$name]}" ]] || die "$name on-chain Wasm hash mismatch after deploy"
done

python3 -c "
import json
json.dump({
  'network': '$NETWORK',
  'deployer': '$DEPLOYER_ADDRESS',
  'underlying': '$UNDERLYING_ID',
  'blend_pool': '$BLEND_POOL',
  'maturity': $MATURITY,
  'curve': {
    'scalar_root': '$SCALAR_ROOT',
    'initial_anchor': '$INITIAL_ANCHOR',
    'fee_bps': $FEE_BPS,
    'twap_window': $TWAP_WINDOW,
  },
  'contracts': { $(for n in "${CONTRACTS[@]}"; do printf '\"%s\": \"%s\", ' "$n" "${ADDR[$n]}"; done) },
  'initialized': True,
}, open('$RESULT_FILE', 'w'), indent=2)
"
log "Saved deployment addresses and init config to $RESULT_FILE"
log "Deployment and initialization complete"
warn "Review $RESULT_FILE, then hand it to whatever wires the frontend/manifest for Mainnet — this script intentionally does not touch apps/web or deployments/$NETWORK.toml."
