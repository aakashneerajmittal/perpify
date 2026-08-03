/**
 * PVault runtime — the live, in-process tranche vault the venue service runs alongside the
 * matching engine. It is seeded once, then each "vault-day" it books a modeled fee stream from
 * venue activity through the waterfall (settleEpoch), so the Senior/Junior NAVs and the yield
 * reserve evolve exactly as the audited contract would. Its state is broadcast read-only on
 * /vaultStream; interactive deposits and the catastrophe drill are faithful client-side
 * previews on the PVault page (same math), so no single visitor can wipe the shared demo vault.
 *
 * Fully isolated from the trading ledger (its own pooled6 counter + conservation invariant), so
 * the engine's money-conservation law is untouched.
 */
import { createVault, depositSenior, depositJunior, settleEpoch, snapshot, type VaultSnapshot, type VaultState } from "./tranches.js";
import { usd6 } from "../fixed.js";

const SENIOR_SEED = "0x5e01000000000000000000000000000000000001";
const JUNIOR_SEED = "0x1c02000000000000000000000000000000000002";

export class VaultRuntime {
  readonly v: VaultState;
  private lastActivity = 0;

  constructor(seniorSeedUsd = 600_000, juniorSeedUsd = 200_000) {
    this.v = createVault();
    depositSenior(this.v, SENIOR_SEED, usd6(seniorSeedUsd), 0);
    depositJunior(this.v, JUNIOR_SEED, usd6(juniorSeedUsd), 0);
  }

  /**
   * Book one vault-day of venue fees through the waterfall. `activityCount` is the venue's
   * cumulative event count; the fee scales with the delta since the last accrual (fees follow
   * flow). Sized so Senior tracks its ~12% target and Junior earns the leveraged residual.
   */
  accrue(activityCount: number): void {
    if (this.v.insolvent) return;
    const delta = Math.max(0, activityCount - this.lastActivity);
    this.lastActivity = activityCount;
    const feeUsd = 400 + delta * 0.4; // modeled daily fee stream (testnet)
    settleEpoch(this.v, usd6(Math.round(feeUsd)));
  }

  snapshot(): VaultSnapshot {
    return snapshot(this.v);
  }
}
