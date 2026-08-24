'use client';

import React from 'react';
import { MermaidDiagram } from './MermaidDiagram';

export default function DocsContentDevelopers() {
  return (
    <>
      <div className="mb-16">
        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl mb-4">Developers</h1>
        <p className="text-xl text-gray-400">
          Technical architecture, smart contracts, and integration guides.
        </p>
      </div>

      {/* --- Protocol Architecture --- */}
      <section id="protocol-architecture" className="mb-16 scroll-mt-24">
        <h2 className="text-3xl font-bold text-white mb-8">Protocol Architecture</h2>
        
        <h3 id="system-overview" className="text-2xl font-semibold text-white mt-8 mb-4 scroll-mt-24">System Overview</h3>
        <p className="text-gray-300 mb-6">Novaire separates its logic into highly specialized Soroban smart contracts to maintain strict security boundaries.</p>
        
        <MermaidDiagram chart={`
graph TD
    subgraph Execution Layer
        U([User])
        IE(Intent Engine)
    end
    
    subgraph Custody Layer
        V(Vault)
        SY(SY Wrapper)
    end
    
    subgraph Derivatives Layer
        T(Tokenizer)
        PT[PT Token]
        YT[YT Token]
    end
    
    subgraph Liquidity Layer
        M(Marketplace AMM)
    end

    U -->|1. Submit Intent| IE
    IE -->|2. Route Capital| V
    V -->|3. Wrap Asset| SY
    SY -->|4. Backing| T
    T -->|5. Mint 1:1| PT
    T -->|5. Mint 1:1| YT
    PT -.->|6. Trade| M
    YT -.->|6. Trade| M
        `} />
      </section>

      {/* --- Smart Contracts --- */}
      <hr className="border-nova-border my-16" />
      <section id="smart-contracts" className="mb-16 scroll-mt-24">
        <h2 className="text-3xl font-bold text-white mb-8">Smart Contracts API</h2>

        <h3 id="smart-contracts-api" className="text-2xl font-semibold text-white mt-8 mb-4 scroll-mt-24">Contracts Overview</h3>
        <p className="text-gray-300 mb-4">
          Novaire&apos;s contracts are deployed on the Stellar Testnet. TypeScript bindings are automatically generated into the <code>/packages</code> directory upon deployment using the <code>stellar-cli</code>.
        </p>
        
        <div className="overflow-x-auto my-8 border border-nova-border rounded-xl max-h-[400px] overflow-y-auto">
          <table className="min-w-full divide-y divide-white/10 text-sm">
            <thead className="bg-gray-900 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-white">Contract</th>
                <th className="px-4 py-3 text-left font-semibold text-white">Purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 bg-transparent text-gray-300">
              <tr>
                <td className="px-4 py-3 font-mono text-nova-accent">Vault</td>
                <td className="px-4 py-3">Custodies underlying assets. Issues SY shares.</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-nova-accent">SY Wrapper</td>
                <td className="px-4 py-3">Standardizes accounting and yield exchange rates.</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-nova-accent">Tokenizer</td>
                <td className="px-4 py-3">Mints and burns PT and YT. Handles redemptions.</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-nova-accent">Marketplace</td>
                <td className="px-4 py-3">Yield-Space AMM for swap routing and price discovery.</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-nova-accent">Intent Engine</td>
                <td className="px-4 py-3">Abstract transaction router with TWAP protection.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 id="integration-guide" className="text-2xl font-semibold text-white mt-12 mb-4 scroll-mt-24">Integration Guide</h3>
        <p className="text-gray-300 mb-4">
          To integrate Novaire into your own dApp, import the generated TypeScript SDKs. For executing trades on behalf of users, interact exclusively with the <code>Intent Engine</code> to ensure slippage protections are active. 
        </p>
      </section>

      {/* --- FAQ --- */}
      <hr className="border-nova-border my-16" />
      <section id="faq" className="mb-32 scroll-mt-24">
        <h2 className="text-3xl font-bold text-white mb-8">FAQ</h2>
        
        <div className="space-y-6">
          <div>
            <h4 className="font-semibold text-white text-lg">Are my funds locked until maturity?</h4>
            <p className="text-gray-400 mt-2">No. While PT and YT have a fixed maturity date, they are fully liquid tokens. You can sell them at any time on the Novaire Marketplace AMM, subject to market prices and slippage.</p>
          </div>
          <div>
            <h4 className="font-semibold text-white text-lg">What happens if I don&apos;t redeem at maturity?</h4>
            <p className="text-gray-400 mt-2">Your PT will safely hold its 1:1 underlying value indefinitely after maturity. However, it will no longer earn any yield. We recommend opting into Auto Rollovers to prevent cash drag.</p>
          </div>
          <div>
            <h4 className="font-semibold text-white text-lg">Is Novaire audited?</h4>
            <p className="text-gray-400 mt-2">Novaire is currently operating on the Stellar Testnet and is unaudited. Do not attempt to bridge or use real funds.</p>
          </div>
        </div>
      </section>
    </>
  );
}
