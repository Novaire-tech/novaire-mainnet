'use client';

import React from 'react';
import { MermaidDiagram } from './MermaidDiagram';
import { CodeBlock } from './CodeBlock';

export default function DocsContentTradingYield() {
  return (
    <>
      <div className="mb-16">
        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl mb-4">Trading & Yield</h1>
        <p className="text-xl text-gray-400">
          Understand investment strategies, market mechanics, and how to manage your portfolio.
        </p>
      </div>

      {/* --- Investment Strategies --- */}
      <section id="investment-strategies" className="mb-16 scroll-mt-24">
        <h2 className="text-3xl font-bold text-white mb-8">Investment Strategies</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          <div className="bg-white/5 border border-nova-border rounded-2xl p-6">
            <h3 id="keep-all-yield" className="text-xl font-bold text-white mb-2 flex items-center justify-between">
              Keep All Yield
              <span className="text-[10px] uppercase font-bold px-2 py-1 rounded-full bg-nova-accent/20 text-nova-accent">V1 Active</span>
            </h3>
            <p className="text-gray-400 text-sm">Deposit underlying assets to mint PT and YT, holding both to maturity to retain principal and all accrued variable yield.</p>
          </div>
          
          <div className="bg-white/5 border border-nova-border rounded-2xl p-6 opacity-60">
            <h3 id="fixed-yield" className="text-xl font-bold text-white mb-2 flex items-center justify-between">
              Fixed Yield
              <span className="text-[10px] uppercase font-bold px-2 py-1 rounded-full bg-gray-800 text-gray-400">Coming Soon (V2)</span>
            </h3>
            <p className="text-gray-400 text-sm">Automatically mint PT/YT and instantly sell YT to buy more PT, locking in a guaranteed fixed APY at maturity.</p>
          </div>
          
          <div className="bg-white/5 border border-nova-border rounded-2xl p-6 opacity-60">
            <h3 id="custom-yield-split" className="text-xl font-bold text-white mb-2 flex items-center justify-between">
              Custom Split
              <span className="text-[10px] uppercase font-bold px-2 py-1 rounded-full bg-gray-800 text-gray-400">Coming Soon (V2)</span>
            </h3>
            <p className="text-gray-400 text-sm">Design custom portfolio allocations blending PT and YT for tailored risk/reward profiles.</p>
          </div>
        </div>
      </section>

      {/* --- Yield Lifecycle & Market Mechanics --- */}
      <hr className="border-nova-border my-16" />
      <section id="yield-lifecycle-mechanics" className="mb-16 scroll-mt-24">
        <h2 className="text-3xl font-bold text-white mb-8">Lifecycle & Mechanics</h2>

        <h3 id="yield-lifecycle" className="text-2xl font-semibold text-white mt-8 mb-4 scroll-mt-24">Yield Lifecycle</h3>
        <p className="text-gray-300 mb-4">
          The Tokenizer mints PT and YT against deposited SY shares. As yield accrues natively to the SY shares in the Vault, the exchange rate climbs. YT holders can interact with the Tokenizer at any point to claim their proportional slice of this accrued yield without sacrificing their underlying YT position.
        </p>

        <h3 id="market-mechanics" className="text-2xl font-semibold text-white mt-12 mb-4 scroll-mt-24">Market Mechanics</h3>
        <p className="text-gray-300 mb-4">
          Because PT is a zero-coupon bond, it must mathematically converge to 1.0 (relative to the underlying asset) as the maturity date approaches. The Yield-Space AMM invariant dynamically adjusts weights based on time-to-maturity to minimize impermanent loss for liquidity providers and ensure efficient capital pricing.
        </p>
      </section>

      {/* --- Marketplace Deep Dive --- */}
      <hr className="border-nova-border my-16" />
      <section id="marketplace-deep-dive" className="mb-16 scroll-mt-24">
        <h2 className="text-3xl font-bold text-white mb-8">Marketplace Deep Dive</h2>

        <h3 id="market-driven-pricing" className="text-2xl font-semibold text-white mt-8 mb-4 scroll-mt-24">Market Driven Pricing</h3>
        <p className="text-gray-300 mb-4">
          Novaire does not rely on Oracles to determine its fixed APY. It is entirely market-driven. The Fixed APY is derived from the current Spot Price of the Principal Token (PT).
        </p>
        
        <CodeBlock code="Implied APY = ( ( 1 / PT_Price ) ^ ( 365 / Days_Remaining ) ) - 1" language="math" />

        <p className="text-gray-300 mb-4">
          For example, if 1 PT trades for 0.95 XLM and matures in exactly 1 year, the implied fixed APY is ~5.26%. If demand for fixed yield surges, users buy PT, driving the price up (e.g., to 0.98 XLM), which naturally compresses the implied APY down to ~2.04%.
        </p>

        <h3 id="twap" className="text-2xl font-semibold text-white mt-12 mb-4 scroll-mt-24">TWAP (Time-Weighted Average Price)</h3>
        <p className="text-gray-300 mb-4">
          The Marketplace implements an internal TWAP accumulator that tracks the spot price over time. The Intent Engine queries this TWAP prior to executing retail trades to guarantee that the user is not being sandwiched or subjected to flash-loan price manipulation.
        </p>
      </section>

      {/* --- Portfolio & Analytics --- */}
      <hr className="border-nova-border my-16" />
      <section id="portfolio-analytics" className="mb-16 scroll-mt-24">
        <h2 className="text-3xl font-bold text-white mb-8">Portfolio & Analytics</h2>

        <h3 id="portfolio-value" className="text-2xl font-semibold text-white mt-8 mb-4 scroll-mt-24">Portfolio Value</h3>
        <p className="text-gray-300 mb-4">
          The Portfolio Dashboard aggregates the value of all active positions. Since PT and YT are deeply liquid and tradable before maturity, your portfolio value fluctuates dynamically based on real-time market prices, not just deposited capital.
        </p>
        <CodeBlock code="Portfolio Value = Wallet Balance + (PT * Spot Price) + (YT * Implied Price) + Claimable Yield" language="math" />

        <h3 id="claimable-yield" className="text-2xl font-semibold text-white mt-12 mb-4 scroll-mt-24">Claimable Yield</h3>
        <p className="text-gray-300 mb-4">
          Yield accrued by YT tokens does not automatically compound back into your wallet. It builds up as a claimable balance within the Tokenizer contract. Users must actively invoke the <code>claim_yield</code> function (available via the Portfolio UI) to realize these gains.
        </p>
      </section>
    </>
  );
}
