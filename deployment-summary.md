# Deployment Summary

Source: `scripts/deployments.testnet.json` (current, non-deprecated entries). Values not independently re-verified beyond what `release-validation.md` documents for this session.

- **Network:** Stellar Testnet
- **RPC:** `https://soroban-testnet.stellar.org`
- **Build timestamp:** not recorded by the deploy scripts (not in `deployments.testnet.json`) — recommend adding a `deployed_at` field in a future change.
- **Git SHA (release commit):** `b384401` (contract WASM unchanged from prior deployment; this commit is frontend/scripts only)
- **Maturity ledger (current epoch):** `4135061`

## Contract IDs (current epoch)

| Contract | ID |
|---|---|
| Factory | `CAYYQE2L5F3UUNXJ6JBE667VDF7GVKMK6CO6U33J3GMHNFT5YCRA5LAB` |
| Maturity Engine | `CARZ26MGU3FX2VAP4346DKFDM4VAYD2LLSKVWTQ2O5HC2GIYL5RIBD4R` |
| Vault | `CCQOZDSOC3LZ7UW5SSGBMVBB65IOA7XXDQHRPB6WGDA5RWUDE6QFHTDW` |
| Tokenizer | `CAERQIJESV5K3K75WKB6W2UZGEMRE7SZCHZBGH766PQFDQ5GGZ57GB5E` |
| Marketplace | `CCTSO5FM2LOSHNH4VMMUKBHT4273KDXB4LKGHVXC6AYEZKTZ4VSH5NBZ` |
| SY Wrapper | `CDA5QOLRZWJLWHMKD2IPUFFZNXEAFRCFUWKBUZWP6X6RDXWS52SB42ZO` |
| PT Token | `CCF4IUEV73G5FUE6QPSWRYSS4COYU67NPBOVKE4HFA6QCAGHGVJSKLCV` |
| YT Token | `CD4T6Z55OTUXTJM3V4SIIW2W7LBP6CER26F2RHGD57VN3O6PI2RX2OTO` |
| Intent Engine | `CACPDKF7WEDRJYUB2MTIVG2B6VTCJN3WLFXWCV54EH5SOFKM7DJ5WP5H` |
| Rollover | `CCAAVSY4RNROHJSCJON6BP4BRID5ZZCMVK7Z7GBTH5KKS6E47PL6UJPK` |
| Underlying Token | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Blend Pool | `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF` (testnet default) |

## Reserve / Epoch history

Prior epochs are marked deprecated in `scripts/deployments.testnet.json`:

- **Epoch 1** — deployed against a stale/incorrect `underlying_token` that doesn't exist on testnet (`CAS3J7GY…`). Unusable, already initialized, cannot be reused. Maturity ledger `4032346`.
- **Epoch 2** — predates the SY Wrapper `b_rate` accounting fix (`004b62e`) and an intent_engine oracle-staleness fix. Superseded. Maturity ledger `4471443`.
- **Epoch 3** — fixed `sy_wrapper`/`intent_engine`, but reused stale cached WASM hashes for `vault`/`tokenizer`/`pt_token`/`yt_token`/`marketplace`/`rollover` (e.g. marketplace was missing `quote_underlying_for_yt`/`quote_yt_for_underlying`). Superseded by **Epoch 4**, which redeploys every child contract from current source. Maturity ledger `4134934`.
- **Deprecated Factory** — the earlier factory instance (`CCCMNVS2…`) predates Maturity Engine wiring in `deploy_epoch`; a fresh factory instance was deployed for Epoch 4.

Full deprecated-epoch contract ID sets are preserved in `scripts/deployments.testnet.json` for audit trail — not duplicated here.

## Mainnet

No mainnet deployment recorded in `scripts/deployments.mainnet.json` was verified in this session. Do not treat this file as a mainnet go-ahead.
