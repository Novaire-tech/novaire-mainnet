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
    contractId: "CB4LNG5GQEEACNEOYTXX533BVUXJ6ET2MSVHLUO2WZPWFVJ2DSQ52MS6",
  }
} as const

export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"InvalidAmount"},
  5: {message:"InsufficientBalance"},
  6: {message:"MathOverflow"},
  7: {message:"InsufficientAllowance"},
  8: {message:"InvalidExpiration"},
  10: {message:"InvalidBlendReserve"},
  11: {message:"BlendWithdrawalFailed"},
  12: {message:"NotAuthorized"}
}


export interface Config {
  admin: string;
  pool: string;
  reserve_index: u32;
  underlying: string;
}




export interface AllowanceValue {
  amount: i128;
  expiration_ledger: u32;
}



export interface Request {
  address: string;
  amount: i128;
  request_type: u32;
}


export interface Reserve {
  asset: string;
  config: ReserveConfig;
  data: ReserveData;
  scalar: i128;
}


export interface Positions {
  collateral: Map<u32, i128>;
  liabilities: Map<u32, i128>;
  supply: Map<u32, i128>;
}


export interface ReserveData {
  b_rate: i128;
  b_supply: i128;
  backstop_credit: i128;
  d_rate: i128;
  d_supply: i128;
  ir_mod: i128;
  last_time: u64;
}


export interface ReserveConfig {
  c_factor: u32;
  decimals: u32;
  enabled: boolean;
  index: u32;
  l_factor: u32;
  max_util: u32;
  r_base: u32;
  r_one: u32;
  r_three: u32;
  r_two: u32;
  reactivity: u32;
  supply_cap: i128;
  util: u32;
}

export interface Client {
  /**
   * Construct and simulate a name transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  name: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<Config>>>

  /**
   * Construct and simulate a redeem transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  redeem: ({from, sy_amount}: {from: string, sy_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

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
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposit: ({from, amount}: {from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a decimals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  decimals: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer: ({from, to, amount}: {from: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a allowance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  allowance: ({from, spender}: {from: string, spender: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a underlying transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  underlying: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a total_shares transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  total_shares: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a total_supply transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  total_supply: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a accrued_yield transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  accrued_yield: ({holder}: {holder: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a exchange_rate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  exchange_rate: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a share_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  share_balance: ({holder}: {holder: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a transfer_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer_from: ({spender, from, to, amount}: {spender: string, from: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a initialize_blend transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initializes a production wrapper whose custody and exchange rate are
   * backed by a Blend v2 plain-supply position.
   */
  initialize_blend: ({admin, underlying, pool}: {admin: string, underlying: string, pool: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a migrate_reserve_index transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Recovers from a Blend reserve reindex.
   * 
   * `config.reserve_index` is fixed at init and the rate path traps with
   * `InvalidBlendReserve` whenever Blend has since moved the underlying to a
   * different reserve slot. That fail-closed trap is correct (pricing the
   * wrong reserve would be worse), but on its own it is unrecoverable: every
   * rate read, and therefore every deposit/redeem/split/recombine, stays
   * bricked for the life of the market. This admin entrypoint re-syncs the
   * stored index to wherever the pool now keeps this wrapper's underlying.
   * 
   * It does NOT trust a caller-supplied index. It re-derives the index the
   * same way `initialize_blend` does: it finds the underlying's position in
   * the pool's reserve list and cross-checks that against the pool's own
   * `get_reserve(underlying).config.index`, and requires the reserve decimals
   * to still match. The new index is accepted only if the asset actually
   * sitting there is `config.underlying`. So the strongest thing an admin can
   * do here is re-point the wrapper at the same underlying und
   */
  migrate_reserve_index: ({admin}: {admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACgAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAAMAAAAAAAAAE0luc3VmZmljaWVudEJhbGFuY2UAAAAABQAAAAAAAAAMTWF0aE92ZXJmbG93AAAABgAAAAAAAAAVSW5zdWZmaWNpZW50QWxsb3dhbmNlAAAAAAAABwAAAAAAAAARSW52YWxpZEV4cGlyYXRpb24AAAAAAAAIAAAAAAAAABNJbnZhbGlkQmxlbmRSZXNlcnZlAAAAAAoAAAAAAAAAFUJsZW5kV2l0aGRyYXdhbEZhaWxlZAAAAAAAAAsAAAAAAAAADU5vdEF1dGhvcml6ZWQAAAAAAAAM",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAABAAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAARwb29sAAAAEwAAAAAAAAANcmVzZXJ2ZV9pbmRleAAAAAAAAAQAAAAAAAAACnVuZGVybHlpbmcAAAAAABM=",
        "AAAABQAAADNFbWl0dGVkIHdoZW4gU1kgc2hhcmVzIGFyZSByZWRlZW1lZCBmb3IgdW5kZXJseWluZy4AAAAAAAAAAAZSZWRlZW0AAAAAAAEAAAAGcmVkZWVtAAAAAAADAAAAAAAAAAZob2xkZXIAAAAAABMAAAABAAAAAAAAAA1zaGFyZXNfYnVybmVkAAAAAAAACwAAAAAAAAAAAAAAEXVuZGVybHlpbmdfYW1vdW50AAAAAAAACwAAAAAAAAAC",
        "AAAAAAAAAAAAAAAEbmFtZQAAAAAAAAABAAAAEA==",
        "AAAABQAAAD5FbWl0dGVkIHdoZW4gdW5kZXJseWluZyBpcyBkZXBvc2l0ZWQgYW5kIFNZIHNoYXJlcyBhcmUgbWludGVkLgAAAAAAAAAAAAdEZXBvc2l0AAAAAAEAAAAHZGVwb3NpdAAAAAADAAAAAAAAAAZob2xkZXIAAAAAABMAAAABAAAAAAAAABF1bmRlcmx5aW5nX2Ftb3VudAAAAAAAAAsAAAAAAAAAAAAAAA1zaGFyZXNfbWludGVkAAAAAAAACwAAAAAAAAAC",
        "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAAAAAAAAQAAA+kAAAfQAAAABkNvbmZpZwAAAAAAAw==",
        "AAAAAAAAAAAAAAAGcmVkZWVtAAAAAAACAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAJc3lfYW1vdW50AAAAAAAACwAAAAEAAAAL",
        "AAAAAAAAAAAAAAAGc3ltYm9sAAAAAAAAAAAAAQAAABA=",
        "AAAAAAAAAAAAAAAHYXBwcm92ZQAAAAAEAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAEWV4cGlyYXRpb25fbGVkZ2VyAAAAAAAABAAAAAA=",
        "AAAAAAAAAAAAAAAHYmFsYW5jZQAAAAABAAAAAAAAAAJpZAAAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAAAAAAAHZGVwb3NpdAAAAAACAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAIZGVjaW1hbHMAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAAIdHJhbnNmZXIAAAADAAAAAAAAAARmcm9tAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAA=",
        "AAAAAAAAAAAAAAAJYWxsb3dhbmNlAAAAAAAAAgAAAAAAAAAEZnJvbQAAABMAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAAAAAAAKdW5kZXJseWluZwAAAAAAAAAAAAEAAAAT",
        "AAAAAQAAAAAAAAAAAAAADkFsbG93YW5jZVZhbHVlAAAAAAACAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAEWV4cGlyYXRpb25fbGVkZ2VyAAAAAAAABA==",
        "AAAAAAAAAAAAAAAMdG90YWxfc2hhcmVzAAAAAAAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAMdG90YWxfc3VwcGx5AAAAAAAAAAEAAAAL",
        "AAAABQAAAKJFbWl0dGVkIHdoZW4gYW4gYWRtaW4gcmUtc3luY3MgdGhlIHN0b3JlZCBCbGVuZCByZXNlcnZlIGluZGV4IGFmdGVyIHRoZSBwb29sCnJlaW5kZXhlZCB0aGUgdW5kZXJseWluZy4gQm90aCBpbmRpY2VzIGFyZSBjYXJyaWVkIHNvIGludGVncmF0b3JzIGNhbiBhdWRpdAp0aGUgbW92ZS4AAAAAAAAAAAAPUmVzZXJ2ZU1pZ3JhdGVkAAAAAAEAAAAQcmVzZXJ2ZV9taWdyYXRlZAAAAAIAAAAAAAAACW9sZF9pbmRleAAAAAAAAAQAAAAAAAAAAAAAAAluZXdfaW5kZXgAAAAAAAAEAAAAAAAAAAI=",
        "AAAAAAAAAAAAAAANYWNjcnVlZF95aWVsZAAAAAAAAAEAAAAAAAAABmhvbGRlcgAAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAAAAAAANZXhjaGFuZ2VfcmF0ZQAAAAAAAAAAAAABAAAACw==",
        "AAAAAAAAAAAAAAANc2hhcmVfYmFsYW5jZQAAAAAAAAEAAAAAAAAABmhvbGRlcgAAAAAAEwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAANdHJhbnNmZXJfZnJvbQAAAAAAAAQAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAAAAAAEZnJvbQAAABMAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAHBJbml0aWFsaXplcyBhIHByb2R1Y3Rpb24gd3JhcHBlciB3aG9zZSBjdXN0b2R5IGFuZCBleGNoYW5nZSByYXRlIGFyZQpiYWNrZWQgYnkgYSBCbGVuZCB2MiBwbGFpbi1zdXBwbHkgcG9zaXRpb24uAAAAEGluaXRpYWxpemVfYmxlbmQAAAADAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACnVuZGVybHlpbmcAAAAAABMAAAAAAAAABHBvb2wAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAABABSZWNvdmVycyBmcm9tIGEgQmxlbmQgcmVzZXJ2ZSByZWluZGV4LgoKYGNvbmZpZy5yZXNlcnZlX2luZGV4YCBpcyBmaXhlZCBhdCBpbml0IGFuZCB0aGUgcmF0ZSBwYXRoIHRyYXBzIHdpdGgKYEludmFsaWRCbGVuZFJlc2VydmVgIHdoZW5ldmVyIEJsZW5kIGhhcyBzaW5jZSBtb3ZlZCB0aGUgdW5kZXJseWluZyB0byBhCmRpZmZlcmVudCByZXNlcnZlIHNsb3QuIFRoYXQgZmFpbC1jbG9zZWQgdHJhcCBpcyBjb3JyZWN0IChwcmljaW5nIHRoZQp3cm9uZyByZXNlcnZlIHdvdWxkIGJlIHdvcnNlKSwgYnV0IG9uIGl0cyBvd24gaXQgaXMgdW5yZWNvdmVyYWJsZTogZXZlcnkKcmF0ZSByZWFkLCBhbmQgdGhlcmVmb3JlIGV2ZXJ5IGRlcG9zaXQvcmVkZWVtL3NwbGl0L3JlY29tYmluZSwgc3RheXMKYnJpY2tlZCBmb3IgdGhlIGxpZmUgb2YgdGhlIG1hcmtldC4gVGhpcyBhZG1pbiBlbnRyeXBvaW50IHJlLXN5bmNzIHRoZQpzdG9yZWQgaW5kZXggdG8gd2hlcmV2ZXIgdGhlIHBvb2wgbm93IGtlZXBzIHRoaXMgd3JhcHBlcidzIHVuZGVybHlpbmcuCgpJdCBkb2VzIE5PVCB0cnVzdCBhIGNhbGxlci1zdXBwbGllZCBpbmRleC4gSXQgcmUtZGVyaXZlcyB0aGUgaW5kZXggdGhlCnNhbWUgd2F5IGBpbml0aWFsaXplX2JsZW5kYCBkb2VzOiBpdCBmaW5kcyB0aGUgdW5kZXJseWluZydzIHBvc2l0aW9uIGluCnRoZSBwb29sJ3MgcmVzZXJ2ZSBsaXN0IGFuZCBjcm9zcy1jaGVja3MgdGhhdCBhZ2FpbnN0IHRoZSBwb29sJ3Mgb3duCmBnZXRfcmVzZXJ2ZSh1bmRlcmx5aW5nKS5jb25maWcuaW5kZXhgLCBhbmQgcmVxdWlyZXMgdGhlIHJlc2VydmUgZGVjaW1hbHMKdG8gc3RpbGwgbWF0Y2guIFRoZSBuZXcgaW5kZXggaXMgYWNjZXB0ZWQgb25seSBpZiB0aGUgYXNzZXQgYWN0dWFsbHkKc2l0dGluZyB0aGVyZSBpcyBgY29uZmlnLnVuZGVybHlpbmdgLiBTbyB0aGUgc3Ryb25nZXN0IHRoaW5nIGFuIGFkbWluIGNhbgpkbyBoZXJlIGlzIHJlLXBvaW50IHRoZSB3cmFwcGVyIGF0IHRoZSBzYW1lIHVuZGVybHlpbmcgdW5kAAAAFW1pZ3JhdGVfcmVzZXJ2ZV9pbmRleAAAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAEAAAPpAAAABAAAAAM=",
        "AAAAAQAAAAAAAAAAAAAAB1JlcXVlc3QAAAAAAwAAAAAAAAAHYWRkcmVzcwAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAADHJlcXVlc3RfdHlwZQAAAAQ=",
        "AAAAAQAAAAAAAAAAAAAAB1Jlc2VydmUAAAAABAAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAAAZjb25maWcAAAAAB9AAAAANUmVzZXJ2ZUNvbmZpZwAAAAAAAAAAAAAEZGF0YQAAB9AAAAALUmVzZXJ2ZURhdGEAAAAAAAAAAAZzY2FsYXIAAAAAAAs=",
        "AAAAAQAAAAAAAAAAAAAACVBvc2l0aW9ucwAAAAAAAAMAAAAAAAAACmNvbGxhdGVyYWwAAAAAA+wAAAAEAAAACwAAAAAAAAALbGlhYmlsaXRpZXMAAAAD7AAAAAQAAAALAAAAAAAAAAZzdXBwbHkAAAAAA+wAAAAEAAAACw==",
        "AAAAAQAAAAAAAAAAAAAAC1Jlc2VydmVEYXRhAAAAAAcAAAAAAAAABmJfcmF0ZQAAAAAACwAAAAAAAAAIYl9zdXBwbHkAAAALAAAAAAAAAA9iYWNrc3RvcF9jcmVkaXQAAAAACwAAAAAAAAAGZF9yYXRlAAAAAAALAAAAAAAAAAhkX3N1cHBseQAAAAsAAAAAAAAABmlyX21vZAAAAAAACwAAAAAAAAAJbGFzdF90aW1lAAAAAAAABg==",
        "AAAAAQAAAAAAAAAAAAAADVJlc2VydmVDb25maWcAAAAAAAANAAAAAAAAAAhjX2ZhY3RvcgAAAAQAAAAAAAAACGRlY2ltYWxzAAAABAAAAAAAAAAHZW5hYmxlZAAAAAABAAAAAAAAAAVpbmRleAAAAAAAAAQAAAAAAAAACGxfZmFjdG9yAAAABAAAAAAAAAAIbWF4X3V0aWwAAAAEAAAAAAAAAAZyX2Jhc2UAAAAAAAQAAAAAAAAABXJfb25lAAAAAAAABAAAAAAAAAAHcl90aHJlZQAAAAAEAAAAAAAAAAVyX3R3bwAAAAAAAAQAAAAAAAAACnJlYWN0aXZpdHkAAAAAAAQAAAAAAAAACnN1cHBseV9jYXAAAAAAAAsAAAAAAAAABHV0aWwAAAAE" ]),
      options
    )
  }
  public readonly fromJSON = {
    name: this.txFromJSON<string>,
        config: this.txFromJSON<Result<Config>>,
        redeem: this.txFromJSON<i128>,
        symbol: this.txFromJSON<string>,
        approve: this.txFromJSON<null>,
        balance: this.txFromJSON<i128>,
        deposit: this.txFromJSON<i128>,
        decimals: this.txFromJSON<u32>,
        transfer: this.txFromJSON<null>,
        allowance: this.txFromJSON<i128>,
        underlying: this.txFromJSON<string>,
        total_shares: this.txFromJSON<Result<i128>>,
        total_supply: this.txFromJSON<i128>,
        accrued_yield: this.txFromJSON<i128>,
        exchange_rate: this.txFromJSON<i128>,
        share_balance: this.txFromJSON<Result<i128>>,
        transfer_from: this.txFromJSON<null>,
        initialize_blend: this.txFromJSON<Result<void>>,
        migrate_reserve_index: this.txFromJSON<Result<u32>>
  }
}