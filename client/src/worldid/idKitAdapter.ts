import type { IDKitResult } from '@worldcoin/idkit';
import type { AppWorldProof } from './types';

export function idKitResultToAppProof(result: IDKitResult): AppWorldProof {
  if (result.protocol_version === '3.0') {
    const r0 = result.responses[0];
    return {
      nullifier_hash: r0.nullifier,
      merkle_root: r0.merkle_root,
      verification_level: r0.identifier,
      raw: result,
    };
  }
  if (result.protocol_version === '4.0' && 'action' in result) {
    const u = result as { responses: Array<{ nullifier: string; proof: string[]; identifier?: string }> };
    const r0 = u.responses[0];
    const merkle = r0?.proof && r0.proof.length >= 5 ? r0.proof[4] : '0x0';
    return {
      nullifier_hash: r0.nullifier,
      merkle_root: merkle,
      verification_level: r0.identifier || 'mnc',
      raw: result,
    };
  }
  return {
    nullifier_hash: '0x0',
    merkle_root: '0x0',
    verification_level: 'unknown',
    raw: result,
  };
}
