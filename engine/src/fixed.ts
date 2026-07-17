/** Fixed-point helpers. All engine math is bigint — floats exist only at the boundary. */

export const PX_SCALE = 100_000_000n; // 1e8
export const QTY_SCALE = 100_000_000n; // 1e8
export const USD_SCALE = 1_000_000n; // 1e6 (USDC decimals)
export const COEFF_SCALE = 1_000_000n; // 1e6 coefficients (gapCoeff, tierMult)
export const BPS = 10_000n;

/** qty(1e8) × px(1e8) → USD(1e6) */
export function notionalUsd6(qty: bigint, px: bigint): bigint {
  return (qty * px) / 10_000_000_000n;
}

export function applyBps(v: bigint, bps: number | bigint): bigint {
  return (v * BigInt(bps)) / BPS;
}

export function applyCoeff(v: bigint, coeff6: bigint): bigint {
  return (v * coeff6) / COEFF_SCALE;
}

/** float coefficient → fixed 1e6 at the ingestion boundary (deterministic thereafter) */
export function toCoeff6(x: number): bigint {
  if (!Number.isFinite(x) || x <= 0 || x > 100) throw new Error(`bad coefficient: ${x}`);
  return BigInt(Math.round(x * 1e6));
}

export const px8 = (x: number): bigint => BigInt(Math.round(x * 1e8));
export const qty8 = (x: number): bigint => BigInt(Math.round(x * 1e8));
export const usd6 = (x: number): bigint => BigInt(Math.round(x * 1e6));

export const fmtUsd = (v: bigint): string => `$${(Number(v) / 1e6).toFixed(2)}`;
export const fmtPx = (v: bigint): string => (Number(v) / 1e8).toFixed(2);
export const fmtQty = (v: bigint): string => (Number(v) / 1e8).toFixed(4);

export function bigmax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
export function bigmin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
export function bigabs(a: bigint): bigint {
  return a < 0n ? -a : a;
}
