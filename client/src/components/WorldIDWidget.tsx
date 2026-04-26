import React, { useState, useCallback, useMemo } from 'react';
import {
  IDKitRequestWidget,
  CredentialRequest,
  any as anyCredential,
  type RpContext,
  type IDKitResult,
  type IDKitErrorCodes,
} from '@worldcoin/idkit';
import { idKitResultToAppProof } from '../worldid/idKitAdapter';
import type { AppWorldProof, WorldIdUiError } from '../worldid/types';

const STAGING_PLACEHOLDER = 'app_staging_12345';

interface WorldIDWidgetProps {
  isVerified: boolean;
  worldIdProof: AppWorldProof | null;
  error: WorldIdUiError | null;
  isLoading: boolean;
  onVerify: (proof: AppWorldProof) => Promise<void>;
  onError: (error: WorldIdUiError) => void;
}

function apiUrl(path: string): string {
  const base = (process.env.REACT_APP_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}${path}` : path;
}

const WorldIDWidget: React.FC<WorldIDWidgetProps> = ({
  isVerified,
  worldIdProof,
  error,
  isLoading: parentLoading,
  onVerify,
  onError,
}) => {
  const rawId = process.env.REACT_APP_WORLD_APP_ID;
  const rawRp = process.env.REACT_APP_WORLD_RP_ID;
  const appId = (rawId as `app_${string}`) || (STAGING_PLACEHOLDER as `app_${string}`);
  const action = process.env.REACT_APP_WORLD_ACTION || 'verify_human_content';
  const worldSignal = process.env.REACT_APP_WORLD_SIGNAL || 'human-inkwell';
  const rpId = (rawRp as `rp_${string}`) || ('' as `rp_${string}`);

  const isPlaceholder = !rawId || rawId === STAGING_PLACEHOLDER || !rawRp || !rawRp.startsWith('rp_');
  const origin = typeof window !== 'undefined' ? window.location.origin : '(server)';

  const [open, setOpen] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const envTier =
    process.env.REACT_APP_WORLD_ENABLE_STAGING === 'true' ? 'staging' : 'production';

  const constraints = useMemo(
    () => anyCredential(CredentialRequest('mnc', { signal: worldSignal })),
    [worldSignal]
  );

  const startFlow = useCallback(async () => {
    setConfigError(null);
    if (isPlaceholder) {
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(apiUrl('/api/rp-signature'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(body.error || r.statusText || 'Could not get RP signature. Is RP_SIGNING_KEY set on the server?');
      }
      const { sig, nonce, created_at, expires_at: expiresAt } = body;
      setRpContext({
        rp_id: rpId,
        nonce,
        created_at: created_at,
        expires_at: expiresAt,
        signature: sig,
      });
      setOpen(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setConfigError(message);
      onError({ code: 'rp_sig', message });
    } finally {
      setBusy(false);
    }
  }, [action, isPlaceholder, onError, rpId]);

  const handleWidgetError = useCallback(
    (code: IDKitErrorCodes) => {
      onError({ code: String(code), message: String(code) });
      setOpen(false);
      setRpContext(null);
    },
    [onError]
  );

  const handleVerify = useCallback(
    async (result: IDKitResult) => {
      if (!rawRp) throw new Error('REACT_APP_WORLD_RP_ID is not set');
      const vr = await fetch(apiUrl('/api/verify-worldid'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rp_id: rawRp, idkitResponse: result }),
      });
      if (!vr.ok) {
        const t = await vr.text();
        let msg = t;
        try {
          const j = JSON.parse(t) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* use raw */
        }
        throw new Error(msg || 'World ID server verification failed');
      }
    },
    [rawRp]
  );

  const handleSuccess = useCallback(
    async (result: IDKitResult) => {
      const shaped = idKitResultToAppProof(result);
      await onVerify(shaped);
      setOpen(false);
      setRpContext(null);
    },
    [onVerify]
  );

  const loading = parentLoading || busy;
  const showV4Help =
    isPlaceholder && (
      <div
        role="alert"
        style={{
          marginBottom: 16,
          padding: 12,
          backgroundColor: '#fff3cd',
          border: '1px solid #ffc107',
          borderRadius: 8,
          color: '#856404',
          fontSize: 14,
          lineHeight: 1.45,
        }}
      >
        <strong>World ID 4.0 is not fully configured for this host.</strong> In{' '}
        <a href="https://developer.world.org" target="_blank" rel="noopener noreferrer">
          World Developer Portal
        </a>
        , complete <strong>World ID 4.0 / RP</strong> setup, then in Vercel set:
        <ul style={{ margin: '8px 0 0 18px' }}>
          <li>
            <code>REACT_APP_WORLD_APP_ID</code> (e.g. <code>app_…</code>)
          </li>
          <li>
            <code>REACT_APP_WORLD_RP_ID</code> (e.g. <code>rp_…</code>)
          </li>
          <li>
            <code>RP_SIGNING_KEY</code> (server-only, from the portal &mdash; not a{' '}
            <code>REACT_APP_</code> var)
          </li>
        </ul>
        Add <strong>this origin</strong> to the app&rsquo;s allowed URLs: <code>{origin}</code>. For local
        dev, run <code>vercel dev</code> in <code>client</code> so <code>/api</code> routes work. Redeploy
        after changing env.
      </div>
    );

  return (
    <div className="world-id-section">
      {showV4Help}

      {configError && !isPlaceholder && (
        <div
          role="status"
          style={{
            marginBottom: 12,
            padding: 10,
            background: '#f8d7da',
            border: '1px solid #f5c6cb',
            borderRadius: 8,
            color: '#721c24',
            fontSize: 14,
          }}
        >
          {configError}
        </div>
      )}

      <div className="section-header">
        <h3>🌍 World ID Human Verification</h3>
        <p className="description">
          Verify with World ID (4.0). Uses device (MNC) proof — no Orb on this path.
        </p>
      </div>

      <div className="world-id-status">
        {isVerified && worldIdProof ? (
          <div className="status-verified">
            <div className="status-badge success">✅ Verified Human</div>
            <div className="world-id-details">
              <div className="detail-item">
                <span className="label">Credential:</span>
                <span className="value">{worldIdProof.verification_level}</span>
              </div>
              <div className="detail-item">
                <span className="label">Nullifier Hash:</span>
                <span className="value hash">{worldIdProof.nullifier_hash}</span>
              </div>
              <div className="detail-item">
                <span className="label">Merkle / root:</span>
                <span className="value hash">{worldIdProof.merkle_root}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="status-unverified">
            <div className="status-badge pending">⏳ Unverified</div>
            <p className="verification-prompt">Verify with World ID to bind proof-of-personhood to this session.</p>
          </div>
        )}
      </div>

      {error?.message && (
        <div className="error-message">
          <span className="error-icon">❌</span>
          <span>World ID: {error.message}</span>
        </div>
      )}

      {!isVerified && (
        <div className="world-id-widget">
          <button
            type="button"
            onClick={startFlow}
            disabled={loading || isPlaceholder}
            className="world-id-button"
            title={isPlaceholder ? 'Configure app id, rp id, and RP signing key' : 'Start World ID 4.0 flow'}
          >
            {loading ? (
              <span className="loading-text">
                <span className="spinner">⏳</span>
                {busy ? 'Preparing…' : 'Verifying...'}
              </span>
            ) : (
              <span className="button-text">
                <span className="world-icon">🌍</span>
                Verify with World ID
              </span>
            )}
          </button>
        </div>
      )}

      {rpContext && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) setRpContext(null);
          }}
          app_id={appId}
          action={action}
          rp_context={rpContext}
          allow_legacy_proofs={true}
          environment={envTier}
          constraints={constraints}
          handleVerify={handleVerify}
          onSuccess={handleSuccess}
          onError={handleWidgetError}
        />
      )}

      <div className="world-id-info">
        <h4>World ID 4.0 on Vercel</h4>
        <ul>
          <li>
            This flow needs <strong>serverless</strong> <code>/api</code> routes; use the deployed Vercel URL
            or <code>vercel dev</code> locally (plain <code>npm start</code> has no RP signer).
          </li>
          <li>
            <strong>Device</strong> path uses the <code>mnc</code> (phone) credential per IDKit 4.0, not the Orb
            path.
          </li>
        </ul>
      </div>
    </div>
  );
};

export default WorldIDWidget;
