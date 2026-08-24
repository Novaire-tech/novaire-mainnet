import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CA26BB3KXS4XCY3SSAHTBSFXZYI46Q2L4X4H56IVBCLYBVAJVAABJM3L",
  }
} as const

export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"InvalidMaturity"},
  4: {message:"InvalidAmount"},
  5: {message:"AmountMismatch"},
  6: {message:"Matured"},
  7: {message:"MathOverflow"},
  8: {message:"LiveMarket"},
  /**
   * Retired: no entrypoint gates on escrow coverage anymore (shortfalls are
   * priced pro-rata at redemption instead). Kept so code 9 stays reserved.
   */
  9: {message:"Insolvent"}
}



export interface Config {
  admin: string;
  maturity: u64;
  pt_token: string;
  sy_token: string;
  yt_token: string;
}


/**
 * A holder's PT and YT balances, read from the real token contracts.
 */
export interface Position {
  pt_balance: i128;
  yt_balance: i128;
}




export interface Client {
  /**
   * Construct and simulate a split transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pulls `sy_amount` SY from `from` into escrow and mints equal PT and YT,
   * denominated in asset units: `face = sy_amount * rate / WAD`. At rate 1.00
   * this equals `sy_amount`. PT is the fixed principal claim; YT is the yield
   * claim. The escrow holds the SY shares; their asset value at the current
   * rate equals the PT face exactly at mint, which is the coverage invariant.
   */
  split: ({from, sy_amount}: {from: string, sy_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<readonly [i128, i128]>>>

  /**
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<Config>>>

  /**
   * Construct and simulate a maturity transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  maturity: (options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * PT and YT balances the holder currently owns, read from the token
   * contracts.
   */
  position: ({holder}: {holder: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Position>>>

  /**
   * Construct and simulate a recombine transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Burns equal PT and YT (asset units) from `from` and returns principal in SY
   * shares: `pt_amount * WAD / rate`, capped to the holder's pro-rata share of
   * escrow under a shortfall (identical cap to `redeem_at_maturity`). Burning the
   * YT settles the holder's accrued yield first (the YT burn hook banks it into
   * the holder's claim ledger), so recombine returns only principal and the
   * banked yield stays owed and covered by the remaining escrow. Never reverts on
   * collateralization: a shortfall is priced as a haircut, matching Pendle.
   */
  recombine: ({from, pt_amount, yt_amount}: {from: string, pt_amount: i128, yt_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin, sy_token, pt_token, yt_token, maturity}: {admin: string, sy_token: string, pt_token: string, yt_token: string, maturity: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a is_matured transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_matured: (options?: MethodOptions) => Promise<AssembledTransaction<Result<boolean>>>

  /**
   * Construct and simulate a claim_yield transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pays `holder` their accrued YT yield in SY out of escrow, capped so PT
   * principal is always senior to banked YT yield, and returns the SY amount
   * paid. Allowed any time, including after maturity, so a holder can always
   * collect yield earned over the term.
   * 
   * PT-senior surplus cap. The YT contract settles the holder and reports the
   * banked total `owed` WITHOUT zeroing it (`settle`). The tokenizer then pays
   * only `min(owed, surplus)`, where
   * `surplus = max(0, escrow_shares - pt_face_reservation)`
   * and `pt_face_reservation = ceil(pt_supply * WAD / rate)` is the SY escrow
   * needed to redeem every outstanding PT at its face at `rate`. The
   * reservation is rounded UP, so PT is never shorted by a rounding notch and
   * the surplus is the conservative (smaller) amount. It then `consume`s
   * exactly `pay` from the YT ledger and pushes `pay` SY. Anything owed beyond
   * `pay` stays banked in the YT ledger, claimable later once the rate
   * recovers (a transient sub-stroop dip) or, under a permanent slash, capped
   * there forever by the short escrow:
   */
  claim_yield: ({holder}: {holder: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a escrowed_sy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * SY the tokenizer custodies, equal to the outstanding PT (and YT) supply.
   */
  escrowed_sy: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a observe_rate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permissionless: before maturity, read the live SY rate and record it as
   * the latest observation the maturity freeze may use. Every mutating
   * operation records one as a side effect; this poke exists so anyone (a
   * keeper, or a YT holder who wants the freeze to credit yield accrued
   * right up to maturity) can refresh the observation on an otherwise idle
   * market without moving tokens. Returns the observed rate.
   * 
   * After maturity, delegates to `freeze_maturity_rate` instead of erroring,
   * so a keeper polling this single entrypoint never dead-ends on a bare
   * `Error::Matured` with no indication of what to call instead.
   */
  observe_rate: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a maturity_rate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The frozen maturity rate, or 0 if not yet snapshotted.
   */
  maturity_rate: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a preview_split transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * PT and YT minted for `sy_amount` SY at the current rate, in asset units.
   */
  preview_split: ({sy_amount}: {sy_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<readonly [i128, i128]>>>

  /**
   * Construct and simulate a preview_recombine transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * SY shares returned for recombining equal PT and YT (asset units) at the
   * current rate. This is the principal only; any accrued YT yield is settled
   * separately into the holder's claim ledger. Mirrors `recombine` exactly,
   * including the pro-rata escrow cap, so the preview never overquotes
   * during a rate-regression shortfall.
   * 
   * Point-in-time read of the live Blend SY rate: if the rate moves between
   * this quote and submission, the executed `recombine` share count can
   * differ. The underlying value redeemed does not — `recombine` always
   * returns `pt_face` worth of principal regardless of rate, so a moved rate
   * changes the SY share count, not what it's worth. `recombine` has no
   * on-chain `min_sy_out` floor by design; a caller needing an exact share
   * count should compare this preview to its bound client-side before
   * submitting.
   */
  preview_recombine: ({pt_amount, yt_amount}: {pt_amount: i128, yt_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a redeem_at_maturity transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * After maturity, burns `pt_amount` PT (asset units) from `from` and returns
   * principal in SY shares: `pt_amount * WAD / rate`, capped to the holder's
   * pro-rata share of escrow.
   * 
   * Insolvency guard: if a rate regression (negative yield, a slash) has left
   * the escrow unable to cover all PT principal, the payout is capped to
   * `escrow_shares * pt_amount / pt_supply`, so PT holders share the shortfall
   * pro-rata rather than letting the first redeemers drain the escrow at the
   * expense of the last. When solvent, the ideal payout is the smaller of the
   * two, so this pays principal in full. Capping preserves the escrow/PT ratio,
   * keeping every later redeemer's share fair.
   * 
   * The rate read here is the current SY rate; Phase 3 step 9 snapshots a
   * maturity rate so post-maturity rate moves do not change redemption.
   */
  redeem_at_maturity: ({from, pt_amount}: {from: string, pt_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a freeze_maturity_rate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permissionless: after maturity, snapshot and return the SY rate used for
   * all redemption. Any caller may poke this so the maturity rate is captured
   * promptly; redemption also snapshots it lazily on first use. Idempotent
   * once set. The snapshot is the last rate observed at or before maturity,
   * never a live post-maturity read (see `effective_rate`), so the timing of
   * this call cannot move value between PT and YT.
   */
  freeze_maturity_rate: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACQAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAPSW52YWxpZE1hdHVyaXR5AAAAAAMAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAAEAAAAAAAAAA5BbW91bnRNaXNtYXRjaAAAAAAABQAAAAAAAAAHTWF0dXJlZAAAAAAGAAAAAAAAAAxNYXRoT3ZlcmZsb3cAAAAHAAAAAAAAAApMaXZlTWFya2V0AAAAAAAIAAAAjlJldGlyZWQ6IG5vIGVudHJ5cG9pbnQgZ2F0ZXMgb24gZXNjcm93IGNvdmVyYWdlIGFueW1vcmUgKHNob3J0ZmFsbHMgYXJlCnByaWNlZCBwcm8tcmF0YSBhdCByZWRlbXB0aW9uIGluc3RlYWQpLiBLZXB0IHNvIGNvZGUgOSBzdGF5cyByZXNlcnZlZC4AAAAAAAlJbnNvbHZlbnQAAAAAAAAJ",
        "AAAABQAAADNFbWl0dGVkIHdoZW4gU1kgaXMgc3BsaXQgaW50byBlcXVhbC1mYWNlIFBUIGFuZCBZVC4AAAAAAAAAAAVTcGxpdAAAAAAAAAEAAAAFc3BsaXQAAAAAAAADAAAAAAAAAAZob2xkZXIAAAAAABMAAAABAAAAAAAAAAlzeV9hbW91bnQAAAAAAAALAAAAAAAAAAAAAAAEZmFjZQAAAAsAAAAAAAAAAg==",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAABQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAhtYXR1cml0eQAAAAYAAAAAAAAACHB0X3Rva2VuAAAAEwAAAAAAAAAIc3lfdG9rZW4AAAATAAAAAAAAAAh5dF90b2tlbgAAABM=",
        "AAAAAQAAAEJBIGhvbGRlcidzIFBUIGFuZCBZVCBiYWxhbmNlcywgcmVhZCBmcm9tIHRoZSByZWFsIHRva2VuIGNvbnRyYWN0cy4AAAAAAAAAAAAIUG9zaXRpb24AAAACAAAAAAAAAApwdF9iYWxhbmNlAAAAAAALAAAAAAAAAAp5dF9iYWxhbmNlAAAAAAAL",
        "AAAAAAAAAW1QdWxscyBgc3lfYW1vdW50YCBTWSBmcm9tIGBmcm9tYCBpbnRvIGVzY3JvdyBhbmQgbWludHMgZXF1YWwgUFQgYW5kIFlULApkZW5vbWluYXRlZCBpbiBhc3NldCB1bml0czogYGZhY2UgPSBzeV9hbW91bnQgKiByYXRlIC8gV0FEYC4gQXQgcmF0ZSAxLjAwCnRoaXMgZXF1YWxzIGBzeV9hbW91bnRgLiBQVCBpcyB0aGUgZml4ZWQgcHJpbmNpcGFsIGNsYWltOyBZVCBpcyB0aGUgeWllbGQKY2xhaW0uIFRoZSBlc2Nyb3cgaG9sZHMgdGhlIFNZIHNoYXJlczsgdGhlaXIgYXNzZXQgdmFsdWUgYXQgdGhlIGN1cnJlbnQKcmF0ZSBlcXVhbHMgdGhlIFBUIGZhY2UgZXhhY3RseSBhdCBtaW50LCB3aGljaCBpcyB0aGUgY292ZXJhZ2UgaW52YXJpYW50LgAAAAAAAAVzcGxpdAAAAAAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAAlzeV9hbW91bnQAAAAAAAALAAAAAQAAA+kAAAPtAAAAAgAAAAsAAAALAAAAAw==",
        "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAAAAAAAAQAAA+kAAAfQAAAABkNvbmZpZwAAAAAAAw==",
        "AAAABQAAADlFbWl0dGVkIHdoZW4gZXF1YWwgUFQgYW5kIFlUIGFyZSByZWNvbWJpbmVkIGJhY2sgaW50byBTWS4AAAAAAAAAAAAACVJlY29tYmluZQAAAAAAAAEAAAAJcmVjb21iaW5lAAAAAAAABAAAAAAAAAAGaG9sZGVyAAAAAAATAAAAAQAAAAAAAAAJcHRfYW1vdW50AAAAAAAACwAAAAAAAAAAAAAACXl0X2Ftb3VudAAAAAAAAAsAAAAAAAAAAAAAAAZzeV9vdXQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAADRFbWl0dGVkIHdoZW4gYSBZVCBob2xkZXIgY2xhaW1zIHRoZWlyIGFjY3J1ZWQgeWllbGQuAAAAAAAAAApDbGFpbVlpZWxkAAAAAAABAAAAC2NsYWltX3lpZWxkAAAAAAIAAAAAAAAABmhvbGRlcgAAAAAAEwAAAAEAAAAAAAAABnN5X291dAAAAAAACwAAAAAAAAAC",
        "AAAAAAAAAAAAAAAIbWF0dXJpdHkAAAAAAAAAAQAAA+kAAAAGAAAAAw==",
        "AAAAAAAAAExQVCBhbmQgWVQgYmFsYW5jZXMgdGhlIGhvbGRlciBjdXJyZW50bHkgb3ducywgcmVhZCBmcm9tIHRoZSB0b2tlbgpjb250cmFjdHMuAAAACHBvc2l0aW9uAAAAAQAAAAAAAAAGaG9sZGVyAAAAAAATAAAAAQAAA+kAAAfQAAAACFBvc2l0aW9uAAAAAw==",
        "AAAAAAAAAg5CdXJucyBlcXVhbCBQVCBhbmQgWVQgKGFzc2V0IHVuaXRzKSBmcm9tIGBmcm9tYCBhbmQgcmV0dXJucyBwcmluY2lwYWwgaW4gU1kKc2hhcmVzOiBgcHRfYW1vdW50ICogV0FEIC8gcmF0ZWAsIGNhcHBlZCB0byB0aGUgaG9sZGVyJ3MgcHJvLXJhdGEgc2hhcmUgb2YKZXNjcm93IHVuZGVyIGEgc2hvcnRmYWxsIChpZGVudGljYWwgY2FwIHRvIGByZWRlZW1fYXRfbWF0dXJpdHlgKS4gQnVybmluZyB0aGUKWVQgc2V0dGxlcyB0aGUgaG9sZGVyJ3MgYWNjcnVlZCB5aWVsZCBmaXJzdCAodGhlIFlUIGJ1cm4gaG9vayBiYW5rcyBpdCBpbnRvCnRoZSBob2xkZXIncyBjbGFpbSBsZWRnZXIpLCBzbyByZWNvbWJpbmUgcmV0dXJucyBvbmx5IHByaW5jaXBhbCBhbmQgdGhlCmJhbmtlZCB5aWVsZCBzdGF5cyBvd2VkIGFuZCBjb3ZlcmVkIGJ5IHRoZSByZW1haW5pbmcgZXNjcm93LiBOZXZlciByZXZlcnRzIG9uCmNvbGxhdGVyYWxpemF0aW9uOiBhIHNob3J0ZmFsbCBpcyBwcmljZWQgYXMgYSBoYWlyY3V0LCBtYXRjaGluZyBQZW5kbGUuAAAAAAAJcmVjb21iaW5lAAAAAAAAAwAAAAAAAAAEZnJvbQAAABMAAAAAAAAACXB0X2Ftb3VudAAAAAAAAAsAAAAAAAAACXl0X2Ftb3VudAAAAAAAAAsAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAABQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAhzeV90b2tlbgAAABMAAAAAAAAACHB0X3Rva2VuAAAAEwAAAAAAAAAIeXRfdG9rZW4AAAATAAAAAAAAAAhtYXR1cml0eQAAAAYAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAKaXNfbWF0dXJlZAAAAAAAAAAAAAEAAAPpAAAAAQAAAAM=",
        "AAAAAAAABABQYXlzIGBob2xkZXJgIHRoZWlyIGFjY3J1ZWQgWVQgeWllbGQgaW4gU1kgb3V0IG9mIGVzY3JvdywgY2FwcGVkIHNvIFBUCnByaW5jaXBhbCBpcyBhbHdheXMgc2VuaW9yIHRvIGJhbmtlZCBZVCB5aWVsZCwgYW5kIHJldHVybnMgdGhlIFNZIGFtb3VudApwYWlkLiBBbGxvd2VkIGFueSB0aW1lLCBpbmNsdWRpbmcgYWZ0ZXIgbWF0dXJpdHksIHNvIGEgaG9sZGVyIGNhbiBhbHdheXMKY29sbGVjdCB5aWVsZCBlYXJuZWQgb3ZlciB0aGUgdGVybS4KClBULXNlbmlvciBzdXJwbHVzIGNhcC4gVGhlIFlUIGNvbnRyYWN0IHNldHRsZXMgdGhlIGhvbGRlciBhbmQgcmVwb3J0cyB0aGUKYmFua2VkIHRvdGFsIGBvd2VkYCBXSVRIT1VUIHplcm9pbmcgaXQgKGBzZXR0bGVgKS4gVGhlIHRva2VuaXplciB0aGVuIHBheXMKb25seSBgbWluKG93ZWQsIHN1cnBsdXMpYCwgd2hlcmUKYHN1cnBsdXMgPSBtYXgoMCwgZXNjcm93X3NoYXJlcyAtIHB0X2ZhY2VfcmVzZXJ2YXRpb24pYAphbmQgYHB0X2ZhY2VfcmVzZXJ2YXRpb24gPSBjZWlsKHB0X3N1cHBseSAqIFdBRCAvIHJhdGUpYCBpcyB0aGUgU1kgZXNjcm93Cm5lZWRlZCB0byByZWRlZW0gZXZlcnkgb3V0c3RhbmRpbmcgUFQgYXQgaXRzIGZhY2UgYXQgYHJhdGVgLiBUaGUKcmVzZXJ2YXRpb24gaXMgcm91bmRlZCBVUCwgc28gUFQgaXMgbmV2ZXIgc2hvcnRlZCBieSBhIHJvdW5kaW5nIG5vdGNoIGFuZAp0aGUgc3VycGx1cyBpcyB0aGUgY29uc2VydmF0aXZlIChzbWFsbGVyKSBhbW91bnQuIEl0IHRoZW4gYGNvbnN1bWVgcwpleGFjdGx5IGBwYXlgIGZyb20gdGhlIFlUIGxlZGdlciBhbmQgcHVzaGVzIGBwYXlgIFNZLiBBbnl0aGluZyBvd2VkIGJleW9uZApgcGF5YCBzdGF5cyBiYW5rZWQgaW4gdGhlIFlUIGxlZGdlciwgY2xhaW1hYmxlIGxhdGVyIG9uY2UgdGhlIHJhdGUKcmVjb3ZlcnMgKGEgdHJhbnNpZW50IHN1Yi1zdHJvb3AgZGlwKSBvciwgdW5kZXIgYSBwZXJtYW5lbnQgc2xhc2gsIGNhcHBlZAp0aGVyZSBmb3JldmVyIGJ5IHRoZSBzaG9ydCBlc2Nyb3c6AAAAC2NsYWltX3lpZWxkAAAAAAEAAAAAAAAABmhvbGRlcgAAAAAAEwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAEhTWSB0aGUgdG9rZW5pemVyIGN1c3RvZGllcywgZXF1YWwgdG8gdGhlIG91dHN0YW5kaW5nIFBUIChhbmQgWVQpIHN1cHBseS4AAAALZXNjcm93ZWRfc3kAAAAAAAAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAmBQZXJtaXNzaW9ubGVzczogYmVmb3JlIG1hdHVyaXR5LCByZWFkIHRoZSBsaXZlIFNZIHJhdGUgYW5kIHJlY29yZCBpdCBhcwp0aGUgbGF0ZXN0IG9ic2VydmF0aW9uIHRoZSBtYXR1cml0eSBmcmVlemUgbWF5IHVzZS4gRXZlcnkgbXV0YXRpbmcKb3BlcmF0aW9uIHJlY29yZHMgb25lIGFzIGEgc2lkZSBlZmZlY3Q7IHRoaXMgcG9rZSBleGlzdHMgc28gYW55b25lIChhCmtlZXBlciwgb3IgYSBZVCBob2xkZXIgd2hvIHdhbnRzIHRoZSBmcmVlemUgdG8gY3JlZGl0IHlpZWxkIGFjY3J1ZWQKcmlnaHQgdXAgdG8gbWF0dXJpdHkpIGNhbiByZWZyZXNoIHRoZSBvYnNlcnZhdGlvbiBvbiBhbiBvdGhlcndpc2UgaWRsZQptYXJrZXQgd2l0aG91dCBtb3ZpbmcgdG9rZW5zLiBSZXR1cm5zIHRoZSBvYnNlcnZlZCByYXRlLgoKQWZ0ZXIgbWF0dXJpdHksIGRlbGVnYXRlcyB0byBgZnJlZXplX21hdHVyaXR5X3JhdGVgIGluc3RlYWQgb2YgZXJyb3JpbmcsCnNvIGEga2VlcGVyIHBvbGxpbmcgdGhpcyBzaW5nbGUgZW50cnlwb2ludCBuZXZlciBkZWFkLWVuZHMgb24gYSBiYXJlCmBFcnJvcjo6TWF0dXJlZGAgd2l0aCBubyBpbmRpY2F0aW9uIG9mIHdoYXQgdG8gY2FsbCBpbnN0ZWFkLgAAAAxvYnNlcnZlX3JhdGUAAAAAAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAADZUaGUgZnJvemVuIG1hdHVyaXR5IHJhdGUsIG9yIDAgaWYgbm90IHlldCBzbmFwc2hvdHRlZC4AAAAAAA1tYXR1cml0eV9yYXRlAAAAAAAAAAAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAEhQVCBhbmQgWVQgbWludGVkIGZvciBgc3lfYW1vdW50YCBTWSBhdCB0aGUgY3VycmVudCByYXRlLCBpbiBhc3NldCB1bml0cy4AAAANcHJldmlld19zcGxpdAAAAAAAAAEAAAAAAAAACXN5X2Ftb3VudAAAAAAAAAsAAAABAAAD6QAAA+0AAAACAAAACwAAAAsAAAAD",
        "AAAABQAAADlFbWl0dGVkIHdoZW4gUFQgaXMgcmVkZWVtZWQgZm9yIHByaW5jaXBhbCBhZnRlciBtYXR1cml0eS4AAAAAAAAAAAAAEFJlZGVlbUF0TWF0dXJpdHkAAAABAAAAEnJlZGVlbV9hdF9tYXR1cml0eQAAAAAAAwAAAAAAAAAGaG9sZGVyAAAAAAATAAAAAQAAAAAAAAAJcHRfYW1vdW50AAAAAAAACwAAAAAAAAAAAAAABnN5X291dAAAAAAACwAAAAAAAAAC",
        "AAAAAAAAAzVTWSBzaGFyZXMgcmV0dXJuZWQgZm9yIHJlY29tYmluaW5nIGVxdWFsIFBUIGFuZCBZVCAoYXNzZXQgdW5pdHMpIGF0IHRoZQpjdXJyZW50IHJhdGUuIFRoaXMgaXMgdGhlIHByaW5jaXBhbCBvbmx5OyBhbnkgYWNjcnVlZCBZVCB5aWVsZCBpcyBzZXR0bGVkCnNlcGFyYXRlbHkgaW50byB0aGUgaG9sZGVyJ3MgY2xhaW0gbGVkZ2VyLiBNaXJyb3JzIGByZWNvbWJpbmVgIGV4YWN0bHksCmluY2x1ZGluZyB0aGUgcHJvLXJhdGEgZXNjcm93IGNhcCwgc28gdGhlIHByZXZpZXcgbmV2ZXIgb3ZlcnF1b3RlcwpkdXJpbmcgYSByYXRlLXJlZ3Jlc3Npb24gc2hvcnRmYWxsLgoKUG9pbnQtaW4tdGltZSByZWFkIG9mIHRoZSBsaXZlIEJsZW5kIFNZIHJhdGU6IGlmIHRoZSByYXRlIG1vdmVzIGJldHdlZW4KdGhpcyBxdW90ZSBhbmQgc3VibWlzc2lvbiwgdGhlIGV4ZWN1dGVkIGByZWNvbWJpbmVgIHNoYXJlIGNvdW50IGNhbgpkaWZmZXIuIFRoZSB1bmRlcmx5aW5nIHZhbHVlIHJlZGVlbWVkIGRvZXMgbm90IOKAlCBgcmVjb21iaW5lYCBhbHdheXMKcmV0dXJucyBgcHRfZmFjZWAgd29ydGggb2YgcHJpbmNpcGFsIHJlZ2FyZGxlc3Mgb2YgcmF0ZSwgc28gYSBtb3ZlZCByYXRlCmNoYW5nZXMgdGhlIFNZIHNoYXJlIGNvdW50LCBub3Qgd2hhdCBpdCdzIHdvcnRoLiBgcmVjb21iaW5lYCBoYXMgbm8Kb24tY2hhaW4gYG1pbl9zeV9vdXRgIGZsb29yIGJ5IGRlc2lnbjsgYSBjYWxsZXIgbmVlZGluZyBhbiBleGFjdCBzaGFyZQpjb3VudCBzaG91bGQgY29tcGFyZSB0aGlzIHByZXZpZXcgdG8gaXRzIGJvdW5kIGNsaWVudC1zaWRlIGJlZm9yZQpzdWJtaXR0aW5nLgAAAAAAABFwcmV2aWV3X3JlY29tYmluZQAAAAAAAAIAAAAAAAAACXB0X2Ftb3VudAAAAAAAAAsAAAAAAAAACXl0X2Ftb3VudAAAAAAAAAsAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAx1BZnRlciBtYXR1cml0eSwgYnVybnMgYHB0X2Ftb3VudGAgUFQgKGFzc2V0IHVuaXRzKSBmcm9tIGBmcm9tYCBhbmQgcmV0dXJucwpwcmluY2lwYWwgaW4gU1kgc2hhcmVzOiBgcHRfYW1vdW50ICogV0FEIC8gcmF0ZWAsIGNhcHBlZCB0byB0aGUgaG9sZGVyJ3MKcHJvLXJhdGEgc2hhcmUgb2YgZXNjcm93LgoKSW5zb2x2ZW5jeSBndWFyZDogaWYgYSByYXRlIHJlZ3Jlc3Npb24gKG5lZ2F0aXZlIHlpZWxkLCBhIHNsYXNoKSBoYXMgbGVmdAp0aGUgZXNjcm93IHVuYWJsZSB0byBjb3ZlciBhbGwgUFQgcHJpbmNpcGFsLCB0aGUgcGF5b3V0IGlzIGNhcHBlZCB0bwpgZXNjcm93X3NoYXJlcyAqIHB0X2Ftb3VudCAvIHB0X3N1cHBseWAsIHNvIFBUIGhvbGRlcnMgc2hhcmUgdGhlIHNob3J0ZmFsbApwcm8tcmF0YSByYXRoZXIgdGhhbiBsZXR0aW5nIHRoZSBmaXJzdCByZWRlZW1lcnMgZHJhaW4gdGhlIGVzY3JvdyBhdCB0aGUKZXhwZW5zZSBvZiB0aGUgbGFzdC4gV2hlbiBzb2x2ZW50LCB0aGUgaWRlYWwgcGF5b3V0IGlzIHRoZSBzbWFsbGVyIG9mIHRoZQp0d28sIHNvIHRoaXMgcGF5cyBwcmluY2lwYWwgaW4gZnVsbC4gQ2FwcGluZyBwcmVzZXJ2ZXMgdGhlIGVzY3Jvdy9QVCByYXRpbywKa2VlcGluZyBldmVyeSBsYXRlciByZWRlZW1lcidzIHNoYXJlIGZhaXIuCgpUaGUgcmF0ZSByZWFkIGhlcmUgaXMgdGhlIGN1cnJlbnQgU1kgcmF0ZTsgUGhhc2UgMyBzdGVwIDkgc25hcHNob3RzIGEKbWF0dXJpdHkgcmF0ZSBzbyBwb3N0LW1hdHVyaXR5IHJhdGUgbW92ZXMgZG8gbm90IGNoYW5nZSByZWRlbXB0aW9uLgAAAAAAABJyZWRlZW1fYXRfbWF0dXJpdHkAAAAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAAlwdF9hbW91bnQAAAAAAAALAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAZlQZXJtaXNzaW9ubGVzczogYWZ0ZXIgbWF0dXJpdHksIHNuYXBzaG90IGFuZCByZXR1cm4gdGhlIFNZIHJhdGUgdXNlZCBmb3IKYWxsIHJlZGVtcHRpb24uIEFueSBjYWxsZXIgbWF5IHBva2UgdGhpcyBzbyB0aGUgbWF0dXJpdHkgcmF0ZSBpcyBjYXB0dXJlZApwcm9tcHRseTsgcmVkZW1wdGlvbiBhbHNvIHNuYXBzaG90cyBpdCBsYXppbHkgb24gZmlyc3QgdXNlLiBJZGVtcG90ZW50Cm9uY2Ugc2V0LiBUaGUgc25hcHNob3QgaXMgdGhlIGxhc3QgcmF0ZSBvYnNlcnZlZCBhdCBvciBiZWZvcmUgbWF0dXJpdHksCm5ldmVyIGEgbGl2ZSBwb3N0LW1hdHVyaXR5IHJlYWQgKHNlZSBgZWZmZWN0aXZlX3JhdGVgKSwgc28gdGhlIHRpbWluZyBvZgp0aGlzIGNhbGwgY2Fubm90IG1vdmUgdmFsdWUgYmV0d2VlbiBQVCBhbmQgWVQuAAAAAAAAFGZyZWV6ZV9tYXR1cml0eV9yYXRlAAAAAAAAAAEAAAPpAAAACwAAAAM=" ]),
      options
    )
  }
  public readonly fromJSON = {
    split: this.txFromJSON<Result<readonly [i128, i128]>>,
        config: this.txFromJSON<Result<Config>>,
        maturity: this.txFromJSON<Result<u64>>,
        position: this.txFromJSON<Result<Position>>,
        recombine: this.txFromJSON<Result<i128>>,
        initialize: this.txFromJSON<Result<void>>,
        is_matured: this.txFromJSON<Result<boolean>>,
        claim_yield: this.txFromJSON<Result<i128>>,
        escrowed_sy: this.txFromJSON<Result<i128>>,
        observe_rate: this.txFromJSON<Result<i128>>,
        maturity_rate: this.txFromJSON<Result<i128>>,
        preview_split: this.txFromJSON<Result<readonly [i128, i128]>>,
        preview_recombine: this.txFromJSON<Result<i128>>,
        redeem_at_maturity: this.txFromJSON<Result<i128>>,
        freeze_maturity_rate: this.txFromJSON<Result<i128>>
  }
}