#!/usr/bin/env bash
# Grep-based defense-in-depth secret scan, complementing gitleaks.
# Only scans git-tracked files, so local/gitignored state (testnet_keys.json,
# storage.json, etc.) never trips this — those are covered by .gitignore, not CI.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

EXCLUDE_RE='\.(lock|md|map)$|(^|/)package-lock\.json$|(^|/)scan-secrets\.sh$|(^|/)\.env\.example$|\.min\.js$'

mapfile -t FILES < <(git ls-files | grep -vE "$EXCLUDE_RE")

fail=0

check() {
  local label="$1" pattern="$2"
  local hits
  hits=$(printf '%s\0' "${FILES[@]}" | xargs -0 grep -nEI "$pattern" -- 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    echo "::error::Potential $label detected:"
    echo "$hits"
    fail=1
  fi
}

# Stellar/Soroban secret keys (S...) and seed/mnemonic-shaped strings.
check "Stellar secret key" '\bS[A-Z0-9]{55}\b'
# 12/24-word BIP39-shaped mnemonic assigned to a var (heuristic: 11+ lowercase words in quotes).
check "hardcoded mnemonic/seed phrase" '(mnemonic|seed[_ ]?phrase)\s*[:=]\s*["'"'"'][a-z]+( [a-z]+){10,23}["'"'"']'
check "generic private key literal" '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
check "hardcoded RPC/API secret assignment" '(API_KEY|RPC_SECRET|ADMIN_SECRET|DEPLOYER_SECRET|KEEPER_SECRET)\s*=\s*["'"'"'][^"'"'"']{8,}["'"'"']'
check "AWS access key" 'AKIA[0-9A-Z]{16}'

if [[ "$fail" -ne 0 ]]; then
  echo "::error::Secret pattern scan failed. Remove hardcoded secrets and use GitHub Secrets / .env instead."
  exit 1
fi

echo "No hardcoded secrets detected."
