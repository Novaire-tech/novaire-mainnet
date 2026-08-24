'use client';

import React from 'react';
import { MermaidDiagram } from './MermaidDiagram';
import { Callout } from './Callout';

export default function DocsContentGettingStarted() {
  return (
    <>
      <div className="mb-16">
        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl mb-4">Getting Started</h1>
        <p className="text-xl text-gray-400">
          The complete guide to institutional-grade yield tokenization on Stellar.
        </p>
      </div>

      {/* --- Introduction --- */}
      <section id="introduction" className="mb-16 scroll-mt-24">
        <h2 id="what-is-novaire" className="text-3xl font-bold text-white mb-6 scroll-mt-24">What is Novaire?</h2>
        <p className="text-gray-300 mb-6 leading-relaxed">
          Novaire is a decentralized finance protocol built on the Stellar network using Soroban smart contracts. It enables the strict separation of yield-bearing assets into their principal and future yield components. By establishing an automated on-chain marketplace for these components, Novaire provides a permissionless foundation for fixed-rate lending, variable-rate speculation, and tailored yield strategies.
        </p>
        
        <h3 id="why-novaire" className="text-2xl font-semibold text-white mt-12 mb-4 scroll-mt-24">Why Novaire?</h3>
        <p className="text-gray-300 mb-6 leading-relaxed">
          Yield in decentralized finance is inherently volatile and fragmented. Institutional and retail investors face significant risks when deploying capital into variable-rate money markets. Novaire exists to solve this by creating deeply liquid, capital-efficient markets that allow users to cleanly isolate and trade future yield independently from the underlying principal.
        </p>
        
        <Callout type="developer">
          Novaire is designed to be highly composable. The core contracts are strictly modular, allowing external protocols to integrate standardized yield (SY) assets seamlessly.
        </Callout>

        <h3 id="protocol-overview" className="text-2xl font-semibold text-white mt-12 mb-4 scroll-mt-24">Protocol Overview</h3>
        <p className="text-gray-300 mb-6 leading-relaxed">
          The protocol operates via a system of interacting smart contracts that manage the asset lifecycle from deposit to maturity. The primary mechanism is **Yield Tokenization**, where an underlying asset is wrapped and bifurcated into a Principal Token (PT) and a Yield Token (YT).
        </p>

        <h3 id="how-it-works" className="text-2xl font-semibold text-white mt-12 mb-4 scroll-mt-24">How it Works</h3>
        <MermaidDiagram chart={`
graph TD
    A([Deposit XLM]) -->|User deposits capital| B(Vault)
    B -->|Issues receipt| C(SY Wrapper)
    C -->|Provides backing| D(Tokenizer)
    D -->|Mints 1:1| E[PT]
    D -->|Mints 1:1| F[YT]
    
    E --> G{Marketplace}
    F --> G
    
    G -->|Trade for underlying| H(Intent Engine)
        `} />
      </section>

      {/* --- Core Concepts --- */}
      <hr className="border-nova-border my-16" />
      <section id="core-concepts" className="mb-16 scroll-mt-24">
        <h2 className="text-3xl font-bold text-white mb-8">Core Concepts</h2>

        <h3 id="standardized-yield" className="text-2xl font-semibold text-white mt-8 mb-4 scroll-mt-24">Standardized Yield (SY)</h3>
        <p className="text-gray-300 mb-4"><strong>Definition:</strong> SY is a standardized token wrapper that homogenizes disparate yield-bearing assets into a common accounting interface.</p>
        <p className="text-gray-300 mb-4"><strong>Why it exists:</strong> To allow the core Tokenizer contracts to interact with any yield-bearing asset (lending markets, staking derivatives) without requiring custom integration logic for each.</p>
        <p className="text-gray-300 mb-4"><strong>How it works:</strong> Assets deposited into the Vault are minted as SY shares based on the current internal exchange rate. As yield accrues, the exchange rate grows, increasing the underlying value of each SY share.</p>

        <h3 id="vaults" className="text-2xl font-semibold text-white mt-12 mb-4 scroll-mt-24">Vaults</h3>
        <p className="text-gray-300 mb-4"><strong>Definition:</strong> The central treasury that secures underlying assets (like XLM) and issues SY shares to depositors.</p>
        <p className="text-gray-300 mb-4"><strong>Why it exists:</strong> To isolate custody from tokenization and market-making, significantly reducing the attack surface of the protocol.</p>
        
        <h3 id="principal-tokens" className="text-2xl font-semibold text-white mt-12 mb-4 scroll-mt-24">Principal Tokens (PT)</h3>
        <p className="text-gray-300 mb-4"><strong>Definition:</strong> A claim on the base principal of an asset, redeemable 1:1 at a specific future maturity date.</p>
        <p className="text-gray-300 mb-4"><strong>Why it exists:</strong> To provide principal protection and enable fixed-rate lending. Because time must pass before redemption, PT naturally trades at a discount. Buying PT at a discount locks in a guaranteed fixed yield at maturity.</p>
        
        <h3 id="yield-tokens" className="text-2xl font-semibold text-white mt-12 mb-4 scroll-mt-24">Yield Tokens (YT)</h3>
        <p className="text-gray-300 mb-4"><strong>Definition:</strong> A claim on all variable yield generated by the underlying principal until the maturity date.</p>
        <p className="text-gray-300 mb-4"><strong>Why it exists:</strong> To offer highly capital-efficient, leveraged exposure to interest rates. YT holders receive 100% of the yield generated by the underlying asset, even though the YT costs a fraction of the underlying price.</p>
        
        <h3 id="tokenizer" className="text-2xl font-semibold text-white mt-12 mb-4 scroll-mt-24">Tokenizer</h3>
        <p className="text-gray-300 mb-4"><strong>Definition:</strong> The core yield-stripping engine that issues PT and YT.</p>
        <p className="text-gray-300 mb-4"><strong>How it works:</strong> Users lock SY shares in the Tokenizer to mint equal amounts of PT and YT. At maturity, the Tokenizer facilitates the burning of PT for the base asset, and calculates the final yield claimable by YT holders.</p>

        <h3 id="marketplace" className="text-2xl font-semibold text-white mt-12 mb-4 scroll-mt-24">Marketplace</h3>
        <p className="text-gray-300 mb-4"><strong>Definition:</strong> A custom Yield-Space Automated Market Maker (AMM) enabling the trading of PT and YT against the underlying asset.</p>
        
        <h3 id="intent-engine" className="text-2xl font-semibold text-white mt-12 mb-4 scroll-mt-24">Intent Engine</h3>
        <p className="text-gray-300 mb-4"><strong>Definition:</strong> An abstract transaction router that executes multi-step retail strategies in a single transaction.</p>
        <p className="text-gray-300 mb-4"><strong>Why it exists:</strong> To dramatically improve user experience. Instead of a user manually depositing, wrapping, minting, and trading, they sign a single &quot;Intent&quot; which the engine fulfills atomically.</p>
      </section>
    </>
  );
}
