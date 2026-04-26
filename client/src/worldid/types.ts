import type { IDKitResult } from '@worldcoin/idkit';

/** UI + App expect the old ISuccessResult shape; IDKit 4 returns protocol-versioned results. */
export type AppWorldProof = {
  nullifier_hash: string;
  merkle_root: string;
  verification_level: string;
  raw: IDKitResult;
};

export type WorldIdUiError = { code?: string; message: string };
