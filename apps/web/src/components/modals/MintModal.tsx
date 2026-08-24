'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Wallet, ArrowRight, Loader2, AlertCircle, CheckCircle2, TrendingUp, Zap, Sliders } from 'lucide-react';
import { useWallet } from '../../hooks/useWallet';
import { signTransaction } from '@stellar/freighter-api';
import { YieldService } from '../../services/yieldService';
import { CONTRACTS, RPC_URL, NETWORK_PASSPHRASE } from '../../config/contracts';
import { NotificationService } from '../../services/notificationService';
import type { Vault } from '../../types';

interface MintModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAsset?: string;
  onSuccess?: () => void;
  /** 'modal' (default) renders as a centered overlay dialog. 'page' renders inline as page content. */
  variant?: 'modal' | 'page';
}

type YieldPreference = 'fixed' | 'keep' | 'custom';

interface MintSimulationData {
  amountStroops: bigint;
  syEstimate: bigint;
  ptEstimateStroops: bigint;
  ytEstimateStroops: bigint;
}

export function MintModal({ isOpen, onClose, defaultAsset = 'XLM', onSuccess, variant = 'modal' }: MintModalProps) {
  const { isConnected, address, connect, balances, refreshBalances } = useWallet();
  const [amount, setAmount] = useState<string>('');
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [selectedVault, setSelectedVault] = useState<string>('');

  // Yield Preference state
  const [yieldPreference, setYieldPreference] = useState<YieldPreference>('keep');
  const [customYtPct, setCustomYtPct] = useState<string>('50');

  const [step, setStep] = useState<'idle' | 'simulating' | 'review' | 'signing' | 'broadcasting' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const [slippageBps, setSlippageBps] = useState<number>(50); // 0.5% default
  const [simulationData, setSimulationData] = useState<MintSimulationData | null>(null);

  const [balance, setBalance] = useState<number>(0);

  useEffect(() => {
    async function loadVaults() {
      try {
        const v = await YieldService.getVaults();
        setVaults(v);

        if (v.length > 0) {
          let defaultVaultId = v[0].id;

          if (balances && balances.length > 0) {
            const hasXlm = balances.some(b => b.assetCode === 'XLM' && parseFloat(b.amount) > 0);
            if (hasXlm) {
              const xlmVault = v.find(vault => vault.asset === 'XLM');
              if (xlmVault) defaultVaultId = xlmVault.id;
            }
          }

          setSelectedVault(defaultVaultId);
        }
      } catch (e) {
        console.error(e);
      }
    }
    if (isOpen) loadVaults();
  }, [isOpen, balances]);

  const activeVault = vaults.find(v => v.id === selectedVault);
  const availableAssets = activeVault ? (Array.isArray(activeVault.asset) ? activeVault.asset : [activeVault.asset]) : [defaultAsset];
  const [currentAsset, setCurrentAsset] = useState<string>(availableAssets[0]);

  useEffect(() => {
    if (activeVault) {
      const assets = Array.isArray(activeVault.asset) ? activeVault.asset : [activeVault.asset];
      if (!assets.includes(currentAsset)) queueMicrotask(() => setCurrentAsset(assets[0]));
    }
  }, [activeVault]);

  useEffect(() => {
    if (isConnected && address) {
      const b = balances?.find(b => b.assetCode === currentAsset);
      queueMicrotask(() => setBalance(b ? parseFloat(b.amount) : 0));
    } else {
      queueMicrotask(() => setBalance(0));
    }
  }, [isConnected, address, isOpen, currentAsset, balances]);

  const parsedAmount = parseFloat(amount) || 0;
  const isInvalidAmount = parsedAmount <= 0 || isNaN(parsedAmount);
  const isInsufficientBalance = parsedAmount > balance;

  const ptEstimate = parsedAmount * 1.0;
  const ytEstimate = parsedAmount * 1.0;
  const fixedApy = activeVault ? activeVault.fixedApy : 0;
  const maturityDate = activeVault ? new Date(activeVault.maturityDate).toLocaleDateString() : '-';
  const estimatedRedemption = parsedAmount * (1 + (fixedApy / 100) * (30 / 365));

  // Compute yt_sale_percentage
  const ytSalePercentage: number = (() => {
    if (yieldPreference === 'fixed') return 100;
    if (yieldPreference === 'keep') return 0;
    const pct = parseInt(customYtPct, 10);
    if (isNaN(pct)) return 0;
    return Math.max(0, Math.min(100, pct));
  })();

  const ytToSell = ytEstimate * (ytSalePercentage / 100);
  const ytToKeep = ytEstimate - ytToSell;

  const handleMax = () => setAmount(balance.toString());

  const handleMint = async () => {
    if (!isConnected) return connect();
    if (isInvalidAmount || isInsufficientBalance) return;

    setStep('simulating');
    try {
      const { Client: SyWrapperClient } = await import('../../../../../packages/bindings/sy_wrapper/src/index');
      const { Client: TokenizerClient } = await import('../../../../../packages/bindings/tokenizer/src/index');

      const clientOptions = { rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE, publicKey: address! };
      const syWrapperClient = new SyWrapperClient({ ...clientOptions, contractId: CONTRACTS.SY_WRAPPER });
      const tokenizerClient = new TokenizerClient({ ...clientOptions, contractId: CONTRACTS.TOKENIZER });

      const amountStroops = BigInt(Math.floor(parsedAmount * 10_000_000));

      // Minting is now: sy_wrapper.deposit(underlying) -> SY shares, then
      // tokenizer.split(sy_amount) -> equal-face PT + YT. Estimate the SY the deposit
      // will mint using the live exchange rate, then preview the split on that estimate.
      const exchangeRateTx = await syWrapperClient.exchange_rate();
      const rawRate = exchangeRateTx.result as unknown as Record<string, unknown>;
      const rate = Number(typeof rawRate?.unwrap === 'function' ? (rawRate.unwrap as () => unknown)() : rawRate) / 1e18;
      if (!(rate > 0)) throw new Error('SY exchange rate unavailable');

      const syEstimate = BigInt(Math.floor(Number(amountStroops) / rate));

      const previewTx = await tokenizerClient.preview_split({ sy_amount: syEstimate });
      const rawPreview = previewTx.result as unknown as Record<string, unknown>;
      const unwrappedPreview = typeof rawPreview?.unwrap === 'function' ? (rawPreview.unwrap as () => unknown)() : rawPreview;
      const [ptFace, ytFace] = Array.isArray(unwrappedPreview) ? unwrappedPreview : [syEstimate, syEstimate];

      setSimulationData({
        amountStroops,
        syEstimate,
        ptEstimateStroops: BigInt(ptFace as string | number | bigint),
        ytEstimateStroops: BigInt(ytFace as string | number | bigint),
      });
      setStep('review');
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : 'Transaction failed';
      setErrorMessage(message);
      setStep('error');
      NotificationService.addNotification('network', 'Contract Interaction Failed', message || 'Failed to simulate mint transaction.');
    }
  };

  const handleConfirm = async () => {
    if (!simulationData || !address) return;
    setStep('signing');
    try {
      const { Client: SyWrapperClient } = await import('../../../../../packages/bindings/sy_wrapper/src/index');
      const { Client: TokenizerClient } = await import('../../../../../packages/bindings/tokenizer/src/index');

      const clientOptions = { rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE, publicKey: address };
      const syWrapperClient = new SyWrapperClient({ ...clientOptions, contractId: CONTRACTS.SY_WRAPPER });
      const tokenizerClient = new TokenizerClient({ ...clientOptions, contractId: CONTRACTS.TOKENIZER });

      // Step 1: deposit underlying -> SY shares.
      const depositTx = await syWrapperClient.deposit({ from: address, amount: simulationData.amountStroops });
      const depositResult = await depositTx.signAndSend({ signTransaction });
      if (!depositResult) throw new Error('SY deposit failed on-chain');

      const rawDeposit = depositTx.result as unknown as Record<string, unknown>;
      const unwrappedDeposit = typeof rawDeposit?.unwrap === 'function' ? (rawDeposit.unwrap as () => unknown)() : rawDeposit;
      const syMinted = unwrappedDeposit !== undefined && unwrappedDeposit !== null
        ? BigInt(unwrappedDeposit as string | number | bigint)
        : simulationData.syEstimate;

      setStep('broadcasting');

      // Step 2: split the minted SY into equal-face PT + YT.
      const splitTx = await tokenizerClient.split({ from: address, sy_amount: syMinted });
      const result = await splitTx.signAndSend({ signTransaction });

      if (result) {
        setStep('success');
        NotificationService.addNotification('transaction', 'Mint Successful', `Successfully minted ${ptEstimate.toFixed(4)} PT and ${ytToKeep.toFixed(4)} YT.`);
      } else {
        throw new Error('Transaction failed on-chain');
      }
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : 'Transaction failed';
      setErrorMessage(message);
      setStep('error');
      NotificationService.addNotification('network', 'Contract Interaction Failed', message || 'Failed to execute mint transaction.');
    }
  };

  const handleClose = () => {
    if (step === 'success') {
      refreshBalances?.();
      onSuccess?.();
    }
    setStep('idle');
    setAmount('');
    onClose();
  };

  if (!isOpen) return null;

  const preferenceOptions: { key: YieldPreference; icon: React.ReactNode; title: string; badge?: string; badgeActive?: boolean; description: string; bullets: string[], disabled?: boolean }[] = [
    {
      key: 'keep',
      icon: <Zap className="h-4 w-4" />,
      title: 'Keep All YT',
      badge: 'Available',
      badgeActive: true,
      description: 'Receive both PT and YT tokens',
      bullets: ['No automatic YT sale', 'Trade or automate YT later', 'Speculate on variable yield'],
    },
    {
      key: 'fixed',
      icon: <TrendingUp className="h-4 w-4" />,
      title: 'Fixed Yield',
      badge: 'Coming Soon',
      badgeActive: false,
      description: 'Advanced marketplace-powered fixed yield strategy. Coming in Version 2.',
      bullets: ['Receive XLM immediately from YT sale', 'Hold only PT until maturity', 'Best for predictable fixed returns'],
      disabled: true,
    },
    {
      key: 'custom',
      icon: <Sliders className="h-4 w-4" />,
      title: 'Custom Split',
      badge: 'Coming Soon',
      badgeActive: false,
      description: 'Customize your PT/YT allocation with flexible strategies. Coming in Version 2.',
      bullets: ['Partial fixed + partial variable yield', 'Fine-tune your risk/reward profile'],
      disabled: true,
    },
  ];

  const content = (
    <>
          {/* Header */}
          {variant === 'modal' && (
            <div className="flex items-center justify-between border-b border-white/10 p-5 shrink-0">
              <h2 className="text-xl font-semibold text-[#F5F5F2]">Mint PT &amp; YT</h2>
              <button onClick={handleClose} className="rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
          )}

          <div className="p-5 space-y-5 overflow-y-auto">

            {step === 'idle' || step === 'error' ? (
              <>
                {/* Wallet Info */}
                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-3">
                    <Wallet className="h-5 w-5 text-[#BEB7A7]" />
                    <div className="flex flex-col">
                      <span className="text-xs text-white/50">Connected</span>
                      <span className="text-sm font-medium text-white">
                        {isConnected && address ? `${address.slice(0, 5)}...${address.slice(-4)}` : 'Not Connected'}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-xs text-white/50">Balance</span>
                    <span className="text-sm font-medium text-white">{balance.toFixed(4)} {currentAsset}</span>
                  </div>
                </div>

                {/* Inputs */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-white/60">Select Vault</label>
                    <select
                      value={selectedVault}
                      onChange={(e) => setSelectedVault(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-black p-3 text-sm text-white focus:border-[#BEB7A7] focus:outline-none focus:ring-1 focus:ring-[#BEB7A7]"
                    >
                      {vaults.map(v => {
                        const assetName = Array.isArray(v.asset) ? v.asset.join('/') : v.asset;
                        return (
                          <option key={v.id} value={v.id}>{v.protocol} {assetName} Vault - {v.fixedApy}% APY</option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-white/60">Amount to Deposit</label>
                      <button onClick={handleMax} className="text-xs text-[#BEB7A7] hover:underline">Max</button>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full rounded-xl border border-white/10 bg-black p-3 pr-24 text-lg text-white focus:border-[#BEB7A7] focus:outline-none focus:ring-1 focus:ring-[#BEB7A7]"
                      />
                      <div className="absolute inset-y-0 right-3 flex items-center">
                        {availableAssets.length > 1 ? (
                          <select
                            value={currentAsset}
                            onChange={(e) => setCurrentAsset(e.target.value)}
                            className="rounded bg-white/10 px-2 py-1 text-xs font-medium text-white outline-none cursor-pointer hover:bg-white/20 transition-colors"
                          >
                            {availableAssets.map((asset: string) => (
                              <option key={asset} value={asset} className="bg-black text-white">{asset}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="rounded bg-white/10 px-2 py-1 text-xs font-medium text-white cursor-not-allowed opacity-80">
                            {currentAsset}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Yield Preference ── */}
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Yield Preference</p>
                    <p className="text-xs text-white/50 mt-0.5">Choose how your Yield Tokens (YT) are handled after minting.</p>
                  </div>

                  <div className="space-y-2">
                    {preferenceOptions.map((opt) => (
                      <button
                        key={opt.key}
                        disabled={opt.disabled}
                        onClick={() => setYieldPreference(opt.key)}
                        className={`w-full text-left rounded-xl border p-4 transition-all duration-150 relative ${
                          opt.disabled 
                            ? 'border-white/10 bg-white/5 opacity-60 cursor-not-allowed'
                            : yieldPreference === opt.key
                              ? 'border-[#BEB7A7]/60 bg-[#BEB7A7]/8'
                              : 'border-white/8 bg-white/3 hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Radio */}
                          <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                            opt.disabled ? 'border-white/20' : yieldPreference === opt.key ? 'border-[#BEB7A7]' : 'border-white/30'
                          }`}>
                            {yieldPreference === opt.key && !opt.disabled && (
                              <div className="h-2 w-2 rounded-full bg-[#BEB7A7]" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <span className={`text-sm font-medium flex items-center gap-1.5 ${yieldPreference === opt.key && !opt.disabled ? 'text-white' : 'text-white/70'}`}>
                                <span className={opt.disabled ? 'text-white/40' : yieldPreference === opt.key ? 'text-[#BEB7A7]' : 'text-white/40'}>{opt.icon}</span>
                                {opt.title}
                              </span>
                              {opt.badge && (
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  opt.badgeActive ? 'bg-[#BEB7A7]/15 text-[#BEB7A7]' : 'bg-white/10 text-white/50'
                                }`}>
                                  {opt.badge}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-white/50 mt-0.5">{opt.description}</p>
                            {yieldPreference === opt.key && !opt.disabled && (
                              <ul className="mt-2 space-y-1">
                                {opt.bullets.map((b, i) => (
                                  <li key={i} className="flex items-center gap-1.5 text-xs text-white/60">
                                    <span className="h-1 w-1 rounded-full bg-[#BEB7A7]/60 shrink-0" />
                                    {b}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {/* Custom split input */}
                            {yieldPreference === 'custom' && opt.key === 'custom' && !opt.disabled && (
                              <div className="mt-3 flex items-center gap-2">
                                <span className="text-xs text-white/50">Sell</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={customYtPct}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => setCustomYtPct(e.target.value)}
                                  className="w-16 rounded-lg border border-white/10 bg-black px-2 py-1 text-center text-sm text-white focus:border-[#BEB7A7] focus:outline-none"
                                />
                                <span className="text-xs text-white/50">% of YT immediately</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Slippage Selector (only relevant if selling YT) */}
                {ytSalePercentage > 0 && (
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Slippage Tolerance</p>
                      <p className="text-xs text-white/50 mt-0.5">Maximum price slippage you are willing to accept for your YT sale.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {[10, 50, 100, 200].map((bps) => (
                        <button
                          key={bps}
                          onClick={() => setSlippageBps(bps)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                            slippageBps === bps
                              ? 'bg-[#BEB7A7] text-black'
                              : 'bg-white/5 text-white/70 hover:bg-white/10'
                          }`}
                        >
                          {bps / 100}%
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Live Preview */}
                <div className="rounded-xl border border-[#BEB7A7]/20 bg-[#BEB7A7]/5 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white/70">You receive PT</span>
                    <span className="text-sm font-medium text-white">{ptEstimate.toFixed(4)}</span>
                  </div>
                  {ytToKeep > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white/70">You receive YT</span>
                      <span className="text-sm font-medium text-white">{ytToKeep.toFixed(4)}</span>
                    </div>
                  )}
                  {ytToSell > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white/70">YT sold for {currentAsset}</span>
                      <span className="text-sm font-medium text-[#BEB7A7]">~{ytToSell.toFixed(4)} YT → {currentAsset}</span>
                    </div>
                  )}
                  <div className="h-px w-full bg-[#BEB7A7]/20" />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white/70">Fixed APY</span>
                    <span className="text-sm font-medium text-[#BEB7A7]">{fixedApy}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white/70">Maturity Date</span>
                    <span className="text-sm font-medium text-white">{maturityDate}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white/70">PT Redemption Value</span>
                    <span className="text-sm font-medium text-[#BEB7A7]">{estimatedRedemption.toFixed(4)} {currentAsset}</span>
                  </div>
                </div>

                {step === 'error' && (
                  <div className="flex items-center gap-2 rounded-lg bg-red-500/10 p-3 text-sm text-red-500">
                    <AlertCircle className="h-4 w-4" />
                    <span>{errorMessage}</span>
                  </div>
                )}
              </>
            ) : step === 'review' && simulationData ? (
              <div className="flex flex-col space-y-6 py-4">
                <div className="text-center space-y-1">
                  <h3 className="text-lg font-semibold text-white">Review Transaction</h3>
                  <p className="text-sm text-white/60">Confirm the estimated outputs before signing.</p>
                </div>
                
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white/70">PT to Receive</span>
                    <span className="text-sm font-medium text-white">{ptEstimate.toFixed(4)}</span>
                  </div>
                  {ytToKeep > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white/70">YT to Receive</span>
                      <span className="text-sm font-medium text-white">{ytToKeep.toFixed(4)}</span>
                    </div>
                  )}
                  {ytSalePercentage > 0 && (
                    <>
                      <div className="h-px w-full bg-white/10" />
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white/70">Expected YT (face)</span>
                        <span className="text-sm font-medium text-white">
                          {(Number(simulationData.ytEstimateStroops) / 1e7).toFixed(4)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white/70">Expected PT (face)</span>
                        <span className="text-sm font-medium text-[#BEB7A7]">
                          {(Number(simulationData.ptEstimateStroops) / 1e7).toFixed(4)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white/70">Slippage Tolerance</span>
                        <span className="text-sm font-medium text-white">{slippageBps / 100}%</span>
                      </div>
                    </>
                  )}
                </div>

                <button
                  onClick={handleConfirm}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#BEB7A7] py-4 font-semibold text-black transition-all duration-200 hover:brightness-110 hover:-translate-y-[1px] shadow-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
                >
                  Confirm and Mint
                  <ArrowRight className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setStep('idle')}
                  className="w-full flex items-center justify-center py-2 text-sm font-medium text-white/50 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : step === 'success' ? (
              <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#BEB7A7]/20">
                  <CheckCircle2 className="h-8 w-8 text-[#BEB7A7]" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold text-white">Mint Successful</h3>
                  <p className="text-sm text-white/60">
                    {yieldPreference === 'fixed' && `You received ${ptEstimate.toFixed(2)} PT. Your YT was automatically sold for ${currentAsset}.`}
                    {yieldPreference === 'keep' && `You received ${ptEstimate.toFixed(2)} PT and ${ytEstimate.toFixed(2)} YT.`}
                    {yieldPreference === 'custom' && `You received ${ptEstimate.toFixed(2)} PT, ${ytToKeep.toFixed(2)} YT, and sold ${ytToSell.toFixed(2)} YT for ${currentAsset}.`}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-6">
                <Loader2 className="h-10 w-10 animate-spin text-[#BEB7A7]" />
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-white">
                    {step === 'simulating' && 'Simulating Transaction'}
                    {step === 'signing' && 'Awaiting Signature'}
                    {step === 'broadcasting' && 'Broadcasting to Stellar Network'}
                  </h3>
                  <p className="text-sm text-white/60">
                    {step === 'simulating' && 'Checking parameters against on-chain state...'}
                    {step === 'signing' && 'Please sign the transaction in your Freighter wallet.'}
                    {step === 'broadcasting' && 'Waiting for ledger confirmation...'}
                  </p>
                </div>
              </div>
            )}

            {/* Actions */}
            {(step === 'idle' || step === 'error') && (
              <button
                onClick={handleMint}
                disabled={isConnected && (isInvalidAmount || isInsufficientBalance || !activeVault)}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#BEB7A7] py-4 font-semibold text-black transition-all duration-200 hover:brightness-110 hover:-translate-y-[1px] shadow-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
              >
                {!isConnected ? 'Connect Wallet' : isInvalidAmount ? 'Enter Amount' : isInsufficientBalance ? 'Insufficient Balance' : 'Review Transaction'}
                <ArrowRight className="h-5 w-5" />
              </button>
            )}
            {step === 'success' && (
              <button
                onClick={handleClose}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#BEB7A7] py-4 font-semibold text-black transition-all duration-200 hover:brightness-110 hover:-translate-y-[1px] shadow-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
              >
                Done
              </button>
            )}
          </div>
    </>
  );

  if (variant === 'page') {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#050505] shadow-2xl flex flex-col">
        {content}
      </div>
    );
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#050505] shadow-2xl max-h-[92vh] flex flex-col"
        >
          {content}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
