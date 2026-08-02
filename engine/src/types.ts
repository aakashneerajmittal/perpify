/**
 * Perpify engine — core domain types.
 *
 * DESIGN RULE (do not violate): the engine core is a pure deterministic state machine.
 *   apply(state, command) -> events
 * All external inputs (orders, oracle ticks, risk readings, time) enter as sequenced
 * Commands. The core never reads the clock, never touches I/O, never uses randomness.
 * This is what makes the venue replayable — and replayability is a product feature
 * (fairness artifact + the March 2020 reopen demo).
 */

// ---------- primitives ----------

/** All money/price values are integer bigints in fixed-point (1e6 = USDC, 1e8 = price/qty). */
export type Usd6 = bigint;
export type Px8 = bigint;
export type Qty8 = bigint;

export type Address = string; // 0x… lowercased at intake
export type Hex = string;

// Perpify testnet markets: the S&P 500 index perp (flagship) + the five largest US
// companies by market cap as single-stock perps. All share one collateral balance;
// each is an independent order book / oracle / position (isolated margin per market).
export type MarketId =
  | "SPX-PERP"
  | "NVDA-PERP"
  | "AAPL-PERP"
  | "MSFT-PERP"
  | "GOOGL-PERP"
  | "AMZN-PERP";

export type Side = "buy" | "sell";
export type Tif = "GTC" | "IOC" | "POST_ONLY";

// ---------- risk inputs (signed readings from risk/ services) ----------

export type TierCode = "A" | "B" | "C" | "D" | "E";

export interface TierReading {
  wallet: Address;
  tier: TierCode;
  /** multiplier applied to base IM/MM; A < 1.0 < E (fixed 1e6 in engine after ingestion) */
  tierMult: number;
  /** named contributing inputs — explainability is the feature */
  factors: { name: string; contribution: number }[];
  modelVersion: string;
  signature: Hex;
}

export interface GapReading {
  kind: "gap";
  market: MarketId;
  /** margin coefficient >= 1.0; rises as dark period lengthens / anchors weaken */
  gapCoefficient: number;
  session: "open" | "weeknight" | "weekend" | "holiday";
  hoursDark: number;
  expectedGapStd: number;
  modelVersion: string;
  signature: Hex;
}

export interface ConfidenceReading {
  kind: "confidence";
  market: MarketId;
  confidence: number; // 0..1
  dispersionBps: number;
  stalenessMs: number;
  reduceOnly: boolean; // confidence < published threshold
  signature: Hex;
}

// ---------- engine parameters ----------

export interface EngineParams {
  market: MarketId;
  baseImBps: number; // e.g. 3333 ≈ 3x
  baseMmBps: number; // e.g. 1667
  mmFloorBps: number; // MM never below this, regardless of tier discount
  takerFeeBps: number; // to fee pool
  liqPenaltyBps: number; // liquidation penalty on notional → insurance fund
  fundingClampBps: number; // per-hour funding rate clamp
  maxLeverageByTier: Record<TierCode, number>;
  oiCapUsd6: Usd6;
}

// ---------- orders & fills ----------

export interface Order {
  id: string;
  market: MarketId;
  owner: Address;
  side: Side;
  price: Px8; // limit price (market orders express as aggressive limit)
  qty: Qty8;
  remaining: Qty8;
  tif: Tif;
  reduceOnly: boolean;
  nonce: number;
  /** engine sequence-time after which the order is invalid (0 = no expiry) */
  expiry: number;
  signature: Hex; // EIP-712 — stored for the fairness log
  seq: number; // global sequence number assigned at intake = time priority
}

export interface Trade {
  id: string;
  market: MarketId;
  price: Px8;
  qty: Qty8;
  makerOrderId: string;
  takerOrderId: string;
  maker: Address;
  taker: Address;
  takerSide: Side;
  seq: number;
}

// ---------- accounts & positions (isolated margin only in V1) ----------

export interface Position {
  market: MarketId;
  owner: Address;
  side: Side;
  qty: Qty8;
  entryPx: Px8;
  isolatedCollateral: Usd6;
  openedSeq: number;
}

export interface Account {
  owner: Address;
  /** withdrawable collateral (off-chain mirror of vault balance; reconciled at epoch).
   *  ONE balance cross-collateralizes every market's isolated positions. */
  free: Usd6;
  /** collateral reserved for resting orders; released on cancel, moved to isolated on fill */
  reserved: Usd6;
  /** at most one isolated position per market, keyed by MarketId (multi-market V2) */
  positions: Map<MarketId, Position>;
  tier: (TierReading & { tierMult6: bigint }) | null;
  lastNonce: number;
}

// ---------- commands (the ONLY way anything enters the core) ----------

export interface SequencerPlanEntry {
  owner: Address;
  scoreTier: number;
  scoreContagion: number;
  scoreDepth: number;
  queueRank: number;
  action: "liquidate" | "defer";
}

export interface SequencerPlan {
  market: MarketId;
  scenarioRange: { lowPx: Px8; highPx: Px8 };
  entries: SequencerPlanEntry[];
  windowSeconds: number; // 900 at reopen; 60–180 in-session
  modelVersion: string;
  publishedHash: Hex; // posted on-chain before execution
}

export type Command =
  | { kind: "PlaceOrder"; order: Omit<Order, "remaining" | "seq"> }
  | { kind: "CancelOrder"; market: MarketId; orderId: string; owner: Address }
  | { kind: "OracleTick"; market: MarketId; indexPx: Px8; source: "pyth" | "chainlink" | "testnet-feed" }
  | { kind: "RiskReading"; reading: GapReading | ConfidenceReading }
  | { kind: "TierUpdate"; reading: TierReading }
  | { kind: "FundingTick"; market: MarketId }
  | { kind: "Deposit"; owner: Address; amount: Usd6; l1TxHash: Hex }
  | { kind: "Withdraw"; owner: Address; amount: Usd6 }
  | { kind: "LiquidationPlan"; market: MarketId; plan: SequencerPlan }
  | { kind: "EpochClose"; epochId: number };

// ---------- events (append-only, hash-chained; the venue's public memory) ----------

/** Signed and posted on-chain with every liquidation — Playbook §2.5. */
export interface LiquidationExplainer {
  owner: Address;
  market: MarketId;
  avgFillPx: Px8;
  qty: Qty8;
  side: Side; // side that was liquidated
  tierAtLiquidation: TierCode;
  confidenceAtLiquidation: number;
  gapCoefficientAtLiquidation: number;
  equityAtTrigger: Usd6;
  mmRequiredAtTrigger: Usd6;
  queueRank: number | null; // null = normal-mode liquidation, not sequenced
  modelVersions: { tier: string; gap: string };
  inputsHash: Hex; // replay: inputs → model version → same decision
  seq: number;
}

export type EngineEvent =
  | { kind: "CommandRejected"; command: string; owner?: Address; reason: string; seq: number }
  | { kind: "DepositApplied"; owner: Address; amount: Usd6; l1TxHash: Hex; seq: number }
  | { kind: "WithdrawApplied"; owner: Address; amount: Usd6; seq: number }
  | { kind: "OrderAccepted"; order: Order }
  | { kind: "OrderRejected"; orderId: string; owner: Address; market: MarketId; reason: string; seq: number }
  | { kind: "OrderCanceled"; orderId: string; owner: Address; reason: "user" | "self-trade-prevention" | "liquidation" | "expired"; seq: number }
  | { kind: "TradeExecuted"; trade: Trade }
  | {
      kind: "MarginCheck";
      owner: Address;
      orderId: string;
      imRequired: Usd6;
      collateralReserved: Usd6;
      inputs: {
        baseImBps: number;
        gapCoefficient6: string;
        tierMult6: string;
        tier: TierCode;
        maxLeverage: number;
        gapModelVersion: string;
        tierModelVersion: string;
      };
      seq: number;
    }
  | { kind: "FundingApplied"; market: MarketId; rateBps: number; markPx: Px8; indexPx: Px8; seq: number }
  | { kind: "PositionLiquidated"; explainer: LiquidationExplainer }
  | { kind: "BackstopFill"; owner: Address; qty: Qty8; px: Px8; note: "insurance-fund-counterparty"; seq: number }
  | { kind: "BadDebt"; owner: Address; amount: Usd6; coveredByInsurance: boolean; seq: number }
  | { kind: "ReduceOnlyChanged"; market: MarketId; active: boolean; cause: string; seq: number }
  | { kind: "LiquidationPlanAccepted"; market: MarketId; publishedHash: Hex; entries: number; seq: number }
  | { kind: "EpochSettled"; epochId: number; stateRoot: Hex; seq: number };
