# SPDX-License-Identifier: Apache-2.0
# Convenience targets for the novaire contracts workspace.

.PHONY: help test wasm build deploy clean bench bench-check

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

test: ## Run all Soroban contract tests
	cargo test --workspace

bench: ## Run contract cost benchmarks (CPU/mem per entrypoint call)
	cargo run -p novaire-benches --release -- --out ../benchmarks/results/contracts-latest.json

bench-check: ## Run contract cost benchmarks and fail on regressions vs the committed baseline
	cargo run -p novaire-benches --release -- --out ../benchmarks/results/contracts-latest.json --check benches/baseline.json

wasm: ## Build optimized deployable contract Wasm artifacts
	bash scripts/build-optimized-wasm.sh

build: wasm ## Build the contracts (wasm)

deploy: ## Deploy the protocol to testnet (resumable) and regenerate TS bindings
	bash scripts/deploy-testnet-resilient.sh

clean: ## Remove build artifacts
	cargo clean
