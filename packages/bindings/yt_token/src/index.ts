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
    contractId: "CBJNHGM6J64PS2ZLB4YNTQ7OENHBYFJI7Z4JXKE4FDCAHP3DBIZAVVCH",
  }
} as const



export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"InvalidMaturity"},
  4: {message:"InvalidAmount"},
  5: {message:"InvalidExchangeRate"},
  6: {message:"ExchangeRateRegression"},
  7: {message:"InsufficientBalance"},
  8: {message:"InsufficientAllowance"},
  9: {message:"MathOverflow"},
  10: {message:"InvalidExpiration"},
  /**
   * `consume` was asked to remove more than the holder's banked balance. This
   * is a tokenizer-side invariant violation (it only consumes what a prior
   * `settle` reported as banked), surfaced as an error rather than a silent
   * underflow.
   */
  11: {message:"ConsumeExceedsBanked"}
}


export interface Config {
  admin: string;
  maturity: u64;
  sy_token: string;
  tokenizer: string;
}



export interface AllowanceValue {
  amount: i128;
  expiration_ledger: u32;
}

export interface Client {
  /**
   * Construct and simulate a burn transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Burns `amount` YT from `from`, on a holder's own direct call. The
   * holder is settled first so their accrued yield is banked before the
   * balance shrinks, at a rate observed through the tokenizer. The
   * tokenizer's recombine burns through `burn_settled` instead, passing the
   * rate down, because it is on the call stack here and cannot be called
   * back into.
   * 
   * This can drop YT total_supply below PT total_supply by design — not a
   * bug. No economic path reads YT total_supply; the tokenizer's escrow,
   * PT-senior cap, and pro-rata math read only `pt_total_supply`.
   */
  burn: ({from, amount}: {from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Mints `amount` YT to `to`. Restricted to the tokenizer recorded at
   * initialization, which mints YT when a holder splits SY. The recipient is
   * settled first, so a fresh holder's checkpoint starts at the current rate
   * and an existing holder's prior yield is banked before the balance grows.
   */
  mint: ({to, amount}: {to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a name transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  name: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<Config>>>

  /**
   * Construct and simulate a settle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Settles `holder` at the `rate` supplied by the tokenizer and returns their
   * current banked total in SY shares WITHOUT zeroing it. Restricted to the
   * tokenizer. Moves no tokens; it is the first half of a claim.
   * 
   * This is deliberately split from `consume` (they used to be one
   * `settle_and_consume` that zeroed the whole ledger). All-or-nothing consume
   * could not express a partial payment, but the tokenizer now caps a claim to
   * the escrow surplus over the senior PT reservation. So it `settle`s to learn
   * the owed total, decides how much the surplus can cover, and `consume`s only
   * that. Whatever it does not consume stays banked and is claimable later.
   * 
   * The rate is passed in, not read here, on purpose. The tokenizer is already
   * on the call stack when it invokes this (claim_yield -> here), so yt cannot
   * call back into the tokenizer to fetch the canonical maturity rate: Soroban
   * prohibits re-entering a contract already on the stack. The tokenizer instead
   * computes its single canonical rate (live before maturity, its frozen
   * snapsh
   */
  settle: ({holder, rate}: {holder: string, rate: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a symbol transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  symbol: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a approve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  approve: ({from, spender, amount, expiration_ledger}: {from: string, spender: string, amount: i128, expiration_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  balance: ({id}: {id: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a consume transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Subtracts exactly `amount` SY shares from `holder`'s banked ledger.
   * Restricted to the tokenizer, which calls this after `settle` and pushes the
   * same `amount` of SY out of escrow itself. Moves no tokens. `amount == 0` is
   * a no-op; `amount` must be `<= banked` (the tokenizer only ever consumes what
   * a prior `settle` reported), enforced so the ledger can never go negative.
   * The remainder stays banked and claimable later once escrow can cover it.
   */
  consume: ({holder, amount}: {holder: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a decimals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  decimals: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a maturity transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  maturity: (options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer: ({from, to, amount}: {from: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a allowance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  allowance: ({from, spender}: {from: string, spender: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a burn_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  burn_from: ({spender, from, amount}: {spender: string, from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a checkpoint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The SY rate the holder's yield was last settled at. Zero means the
   * holder has never been settled (no YT minted to them yet).
   */
  checkpoint: ({holder}: {holder: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin, tokenizer, sy_token, maturity}: {admin: string, tokenizer: string, sy_token: string, maturity: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a burn_settled transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Burns `amount` YT from `from`, settling them first at the `rate`
   * supplied by the tokenizer. Restricted to the tokenizer, which calls
   * this from `recombine` while it is on the call stack: yt cannot call
   * back into it to observe a rate, so the tokenizer hands down the same
   * rate it observed in that transaction. Trusting the argument is safe
   * because of the auth gate, the same model as `settle` and `consume`.
   * The holder's own authorization is enforced by `recombine` itself.
   */
  burn_settled: ({from, amount, rate}: {from: string, amount: i128, rate: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a total_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  total_supply: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a accrued_yield transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * SY shares already banked to the holder but not yet claimed.
   */
  accrued_yield: ({holder}: {holder: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a transfer_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer_from: ({spender, from, to, amount}: {spender: string, from: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a preview_claim_yield transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Total SY shares claimable by `holder` right now: already-banked yield
   * plus what a settle at the current SY rate would add. The contract reads
   * the rate from the SY contract itself, so no caller can supply a fake one.
   * 
   * Before maturity this is a point-in-time read of the live rate, so the
   * executed `claim_yield` amount may differ if the rate moves between this
   * quote and submission. After maturity it uses the tokenizer's frozen
   * maturity rate (see `preview_rate`), so it no longer tracks live accrual.
   */
  preview_claim_yield: ({holder}: {holder: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

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
      new ContractSpec([ "AAAABQAAAChFbWl0dGVkIHdoZW4gWVQgaXMgYnVybmVkIGZyb20gYSBob2xkZXIuAAAAAAAAAARCdXJuAAAAAQAAAARidXJuAAAAAgAAAAAAAAAEZnJvbQAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAACZFbWl0dGVkIHdoZW4gWVQgaXMgbWludGVkIHRvIGEgaG9sZGVyLgAAAAAAAAAAAARNaW50AAAAAQAAAARtaW50AAAAAgAAAAAAAAACdG8AAAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACwAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAPSW52YWxpZE1hdHVyaXR5AAAAAAMAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAAEAAAAAAAAABNJbnZhbGlkRXhjaGFuZ2VSYXRlAAAAAAUAAAAAAAAAFkV4Y2hhbmdlUmF0ZVJlZ3Jlc3Npb24AAAAAAAYAAAAAAAAAE0luc3VmZmljaWVudEJhbGFuY2UAAAAABwAAAAAAAAAVSW5zdWZmaWNpZW50QWxsb3dhbmNlAAAAAAAACAAAAAAAAAAMTWF0aE92ZXJmbG93AAAACQAAAAAAAAARSW52YWxpZEV4cGlyYXRpb24AAAAAAAAKAAAA42Bjb25zdW1lYCB3YXMgYXNrZWQgdG8gcmVtb3ZlIG1vcmUgdGhhbiB0aGUgaG9sZGVyJ3MgYmFua2VkIGJhbGFuY2UuIFRoaXMKaXMgYSB0b2tlbml6ZXItc2lkZSBpbnZhcmlhbnQgdmlvbGF0aW9uIChpdCBvbmx5IGNvbnN1bWVzIHdoYXQgYSBwcmlvcgpgc2V0dGxlYCByZXBvcnRlZCBhcyBiYW5rZWQpLCBzdXJmYWNlZCBhcyBhbiBlcnJvciByYXRoZXIgdGhhbiBhIHNpbGVudAp1bmRlcmZsb3cuAAAAABRDb25zdW1lRXhjZWVkc0JhbmtlZAAAAAs=",
        "AAAAAAAAAihCdXJucyBgYW1vdW50YCBZVCBmcm9tIGBmcm9tYCwgb24gYSBob2xkZXIncyBvd24gZGlyZWN0IGNhbGwuIFRoZQpob2xkZXIgaXMgc2V0dGxlZCBmaXJzdCBzbyB0aGVpciBhY2NydWVkIHlpZWxkIGlzIGJhbmtlZCBiZWZvcmUgdGhlCmJhbGFuY2Ugc2hyaW5rcywgYXQgYSByYXRlIG9ic2VydmVkIHRocm91Z2ggdGhlIHRva2VuaXplci4gVGhlCnRva2VuaXplcidzIHJlY29tYmluZSBidXJucyB0aHJvdWdoIGBidXJuX3NldHRsZWRgIGluc3RlYWQsIHBhc3NpbmcgdGhlCnJhdGUgZG93biwgYmVjYXVzZSBpdCBpcyBvbiB0aGUgY2FsbCBzdGFjayBoZXJlIGFuZCBjYW5ub3QgYmUgY2FsbGVkCmJhY2sgaW50by4KClRoaXMgY2FuIGRyb3AgWVQgdG90YWxfc3VwcGx5IGJlbG93IFBUIHRvdGFsX3N1cHBseSBieSBkZXNpZ24g4oCUIG5vdCBhCmJ1Zy4gTm8gZWNvbm9taWMgcGF0aCByZWFkcyBZVCB0b3RhbF9zdXBwbHk7IHRoZSB0b2tlbml6ZXIncyBlc2Nyb3csClBULXNlbmlvciBjYXAsIGFuZCBwcm8tcmF0YSBtYXRoIHJlYWQgb25seSBgcHRfdG90YWxfc3VwcGx5YC4AAAAEYnVybgAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAR1NaW50cyBgYW1vdW50YCBZVCB0byBgdG9gLiBSZXN0cmljdGVkIHRvIHRoZSB0b2tlbml6ZXIgcmVjb3JkZWQgYXQKaW5pdGlhbGl6YXRpb24sIHdoaWNoIG1pbnRzIFlUIHdoZW4gYSBob2xkZXIgc3BsaXRzIFNZLiBUaGUgcmVjaXBpZW50IGlzCnNldHRsZWQgZmlyc3QsIHNvIGEgZnJlc2ggaG9sZGVyJ3MgY2hlY2twb2ludCBzdGFydHMgYXQgdGhlIGN1cnJlbnQgcmF0ZQphbmQgYW4gZXhpc3RpbmcgaG9sZGVyJ3MgcHJpb3IgeWllbGQgaXMgYmFua2VkIGJlZm9yZSB0aGUgYmFsYW5jZSBncm93cy4AAAAAAAAEbWludAAAAAIAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAAAAAAAEbmFtZQAAAAAAAAABAAAAEA==",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAABAAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAhtYXR1cml0eQAAAAYAAAAAAAAACHN5X3Rva2VuAAAAEwAAAAAAAAAJdG9rZW5pemVyAAAAAAAAEw==",
        "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAAAAAAAAQAAA+kAAAfQAAAABkNvbmZpZwAAAAAAAw==",
        "AAAAAAAABABTZXR0bGVzIGBob2xkZXJgIGF0IHRoZSBgcmF0ZWAgc3VwcGxpZWQgYnkgdGhlIHRva2VuaXplciBhbmQgcmV0dXJucyB0aGVpcgpjdXJyZW50IGJhbmtlZCB0b3RhbCBpbiBTWSBzaGFyZXMgV0lUSE9VVCB6ZXJvaW5nIGl0LiBSZXN0cmljdGVkIHRvIHRoZQp0b2tlbml6ZXIuIE1vdmVzIG5vIHRva2VuczsgaXQgaXMgdGhlIGZpcnN0IGhhbGYgb2YgYSBjbGFpbS4KClRoaXMgaXMgZGVsaWJlcmF0ZWx5IHNwbGl0IGZyb20gYGNvbnN1bWVgICh0aGV5IHVzZWQgdG8gYmUgb25lCmBzZXR0bGVfYW5kX2NvbnN1bWVgIHRoYXQgemVyb2VkIHRoZSB3aG9sZSBsZWRnZXIpLiBBbGwtb3Itbm90aGluZyBjb25zdW1lCmNvdWxkIG5vdCBleHByZXNzIGEgcGFydGlhbCBwYXltZW50LCBidXQgdGhlIHRva2VuaXplciBub3cgY2FwcyBhIGNsYWltIHRvCnRoZSBlc2Nyb3cgc3VycGx1cyBvdmVyIHRoZSBzZW5pb3IgUFQgcmVzZXJ2YXRpb24uIFNvIGl0IGBzZXR0bGVgcyB0byBsZWFybgp0aGUgb3dlZCB0b3RhbCwgZGVjaWRlcyBob3cgbXVjaCB0aGUgc3VycGx1cyBjYW4gY292ZXIsIGFuZCBgY29uc3VtZWBzIG9ubHkKdGhhdC4gV2hhdGV2ZXIgaXQgZG9lcyBub3QgY29uc3VtZSBzdGF5cyBiYW5rZWQgYW5kIGlzIGNsYWltYWJsZSBsYXRlci4KClRoZSByYXRlIGlzIHBhc3NlZCBpbiwgbm90IHJlYWQgaGVyZSwgb24gcHVycG9zZS4gVGhlIHRva2VuaXplciBpcyBhbHJlYWR5Cm9uIHRoZSBjYWxsIHN0YWNrIHdoZW4gaXQgaW52b2tlcyB0aGlzIChjbGFpbV95aWVsZCAtPiBoZXJlKSwgc28geXQgY2Fubm90CmNhbGwgYmFjayBpbnRvIHRoZSB0b2tlbml6ZXIgdG8gZmV0Y2ggdGhlIGNhbm9uaWNhbCBtYXR1cml0eSByYXRlOiBTb3JvYmFuCnByb2hpYml0cyByZS1lbnRlcmluZyBhIGNvbnRyYWN0IGFscmVhZHkgb24gdGhlIHN0YWNrLiBUaGUgdG9rZW5pemVyIGluc3RlYWQKY29tcHV0ZXMgaXRzIHNpbmdsZSBjYW5vbmljYWwgcmF0ZSAobGl2ZSBiZWZvcmUgbWF0dXJpdHksIGl0cyBmcm96ZW4Kc25hcHNoAAAABnNldHRsZQAAAAAAAgAAAAAAAAAGaG9sZGVyAAAAAAATAAAAAAAAAARyYXRlAAAACwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAGc3ltYm9sAAAAAAAAAAAAAQAAABA=",
        "AAAAAAAAAAAAAAAHYXBwcm92ZQAAAAAEAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAEWV4cGlyYXRpb25fbGVkZ2VyAAAAAAAABAAAAAA=",
        "AAAAAAAAAAAAAAAHYmFsYW5jZQAAAAABAAAAAAAAAAJpZAAAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAbtTdWJ0cmFjdHMgZXhhY3RseSBgYW1vdW50YCBTWSBzaGFyZXMgZnJvbSBgaG9sZGVyYCdzIGJhbmtlZCBsZWRnZXIuClJlc3RyaWN0ZWQgdG8gdGhlIHRva2VuaXplciwgd2hpY2ggY2FsbHMgdGhpcyBhZnRlciBgc2V0dGxlYCBhbmQgcHVzaGVzIHRoZQpzYW1lIGBhbW91bnRgIG9mIFNZIG91dCBvZiBlc2Nyb3cgaXRzZWxmLiBNb3ZlcyBubyB0b2tlbnMuIGBhbW91bnQgPT0gMGAgaXMKYSBuby1vcDsgYGFtb3VudGAgbXVzdCBiZSBgPD0gYmFua2VkYCAodGhlIHRva2VuaXplciBvbmx5IGV2ZXIgY29uc3VtZXMgd2hhdAphIHByaW9yIGBzZXR0bGVgIHJlcG9ydGVkKSwgZW5mb3JjZWQgc28gdGhlIGxlZGdlciBjYW4gbmV2ZXIgZ28gbmVnYXRpdmUuClRoZSByZW1haW5kZXIgc3RheXMgYmFua2VkIGFuZCBjbGFpbWFibGUgbGF0ZXIgb25jZSBlc2Nyb3cgY2FuIGNvdmVyIGl0LgAAAAAHY29uc3VtZQAAAAACAAAAAAAAAAZob2xkZXIAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAABQAAACNFbWl0dGVkIG9uIGFueSBZVCBiYWxhbmNlIHRyYW5zZmVyLgAAAAAAAAAACFRyYW5zZmVyAAAAAQAAAAh0cmFuc2ZlcgAAAAMAAAAAAAAABGZyb20AAAATAAAAAQAAAAAAAAACdG8AAAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAAAAAAAAAAAAAIZGVjaW1hbHMAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAAIbWF0dXJpdHkAAAAAAAAAAQAAA+kAAAAGAAAAAw==",
        "AAAAAAAAAAAAAAAIdHJhbnNmZXIAAAADAAAAAAAAAARmcm9tAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAA=",
        "AAAAAAAAAAAAAAAJYWxsb3dhbmNlAAAAAAAAAgAAAAAAAAAEZnJvbQAAABMAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAAAAAAAJYnVybl9mcm9tAAAAAAAAAwAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==",
        "AAAAAAAAAHxUaGUgU1kgcmF0ZSB0aGUgaG9sZGVyJ3MgeWllbGQgd2FzIGxhc3Qgc2V0dGxlZCBhdC4gWmVybyBtZWFucyB0aGUKaG9sZGVyIGhhcyBuZXZlciBiZWVuIHNldHRsZWQgKG5vIFlUIG1pbnRlZCB0byB0aGVtIHlldCkuAAAACmNoZWNrcG9pbnQAAAAAAAEAAAAAAAAABmhvbGRlcgAAAAAAEwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAABAAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAl0b2tlbml6ZXIAAAAAAAATAAAAAAAAAAhzeV90b2tlbgAAABMAAAAAAAAACG1hdHVyaXR5AAAABgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAddCdXJucyBgYW1vdW50YCBZVCBmcm9tIGBmcm9tYCwgc2V0dGxpbmcgdGhlbSBmaXJzdCBhdCB0aGUgYHJhdGVgCnN1cHBsaWVkIGJ5IHRoZSB0b2tlbml6ZXIuIFJlc3RyaWN0ZWQgdG8gdGhlIHRva2VuaXplciwgd2hpY2ggY2FsbHMKdGhpcyBmcm9tIGByZWNvbWJpbmVgIHdoaWxlIGl0IGlzIG9uIHRoZSBjYWxsIHN0YWNrOiB5dCBjYW5ub3QgY2FsbApiYWNrIGludG8gaXQgdG8gb2JzZXJ2ZSBhIHJhdGUsIHNvIHRoZSB0b2tlbml6ZXIgaGFuZHMgZG93biB0aGUgc2FtZQpyYXRlIGl0IG9ic2VydmVkIGluIHRoYXQgdHJhbnNhY3Rpb24uIFRydXN0aW5nIHRoZSBhcmd1bWVudCBpcyBzYWZlCmJlY2F1c2Ugb2YgdGhlIGF1dGggZ2F0ZSwgdGhlIHNhbWUgbW9kZWwgYXMgYHNldHRsZWAgYW5kIGBjb25zdW1lYC4KVGhlIGhvbGRlcidzIG93biBhdXRob3JpemF0aW9uIGlzIGVuZm9yY2VkIGJ5IGByZWNvbWJpbmVgIGl0c2VsZi4AAAAADGJ1cm5fc2V0dGxlZAAAAAMAAAAAAAAABGZyb20AAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAABHJhdGUAAAALAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMdG90YWxfc3VwcGx5AAAAAAAAAAEAAAAL",
        "AAAAAQAAAAAAAAAAAAAADkFsbG93YW5jZVZhbHVlAAAAAAACAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAEWV4cGlyYXRpb25fbGVkZ2VyAAAAAAAABA==",
        "AAAAAAAAADtTWSBzaGFyZXMgYWxyZWFkeSBiYW5rZWQgdG8gdGhlIGhvbGRlciBidXQgbm90IHlldCBjbGFpbWVkLgAAAAANYWNjcnVlZF95aWVsZAAAAAAAAAEAAAAAAAAABmhvbGRlcgAAAAAAEwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAANdHJhbnNmZXJfZnJvbQAAAAAAAAQAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAAAAAAEZnJvbQAAABMAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAfNUb3RhbCBTWSBzaGFyZXMgY2xhaW1hYmxlIGJ5IGBob2xkZXJgIHJpZ2h0IG5vdzogYWxyZWFkeS1iYW5rZWQgeWllbGQKcGx1cyB3aGF0IGEgc2V0dGxlIGF0IHRoZSBjdXJyZW50IFNZIHJhdGUgd291bGQgYWRkLiBUaGUgY29udHJhY3QgcmVhZHMKdGhlIHJhdGUgZnJvbSB0aGUgU1kgY29udHJhY3QgaXRzZWxmLCBzbyBubyBjYWxsZXIgY2FuIHN1cHBseSBhIGZha2Ugb25lLgoKQmVmb3JlIG1hdHVyaXR5IHRoaXMgaXMgYSBwb2ludC1pbi10aW1lIHJlYWQgb2YgdGhlIGxpdmUgcmF0ZSwgc28gdGhlCmV4ZWN1dGVkIGBjbGFpbV95aWVsZGAgYW1vdW50IG1heSBkaWZmZXIgaWYgdGhlIHJhdGUgbW92ZXMgYmV0d2VlbiB0aGlzCnF1b3RlIGFuZCBzdWJtaXNzaW9uLiBBZnRlciBtYXR1cml0eSBpdCB1c2VzIHRoZSB0b2tlbml6ZXIncyBmcm96ZW4KbWF0dXJpdHkgcmF0ZSAoc2VlIGBwcmV2aWV3X3JhdGVgKSwgc28gaXQgbm8gbG9uZ2VyIHRyYWNrcyBsaXZlIGFjY3J1YWwuAAAAABNwcmV2aWV3X2NsYWltX3lpZWxkAAAAAAEAAAAAAAAABmhvbGRlcgAAAAAAEwAAAAEAAAPpAAAACwAAAAM=" ]),
      options
    )
  }
  public readonly fromJSON = {
    burn: this.txFromJSON<null>,
        mint: this.txFromJSON<null>,
        name: this.txFromJSON<string>,
        config: this.txFromJSON<Result<Config>>,
        settle: this.txFromJSON<Result<i128>>,
        symbol: this.txFromJSON<string>,
        approve: this.txFromJSON<null>,
        balance: this.txFromJSON<i128>,
        consume: this.txFromJSON<Result<void>>,
        decimals: this.txFromJSON<u32>,
        maturity: this.txFromJSON<Result<u64>>,
        transfer: this.txFromJSON<null>,
        allowance: this.txFromJSON<i128>,
        burn_from: this.txFromJSON<null>,
        checkpoint: this.txFromJSON<Result<i128>>,
        initialize: this.txFromJSON<Result<void>>,
        burn_settled: this.txFromJSON<Result<void>>,
        total_supply: this.txFromJSON<i128>,
        accrued_yield: this.txFromJSON<Result<i128>>,
        transfer_from: this.txFromJSON<null>,
        preview_claim_yield: this.txFromJSON<Result<i128>>
  }
}