import React from 'react';
import { IDKitWidget, ISuccessResult, IErrorState, VerificationLevel } from '@worldcoin/idkit';
import WorldMarkIcon from './WorldMarkIcon';

type WorldIDLayout = 'default' | 'onboarding';

interface WorldIDWidgetProps {
  isVerified: boolean;
  worldIdProof: ISuccessResult | null;
  error: IErrorState | null;
  isLoading: boolean;
  onVerify: (proof: ISuccessResult) => Promise<void>;
  onError: (error: IErrorState) => void;
  /** MiniKit native verify handler (World App path) */
  onVerifyMiniKit?: () => Promise<void>;
  /** Whether we're inside the World App */
  isInWorldApp?: boolean;
  /** Omit default title blurb on onboarding step 4 */
  layout?: WorldIDLayout;
}

const STAGING_PLACEHOLDER = 'app_staging_12345';

const WorldIDWidget: React.FC<WorldIDWidgetProps> = ({
  isVerified,
  worldIdProof,
  error,
  isLoading,
  onVerify,
  onError,
  onVerifyMiniKit,
  isInWorldApp = false,
  layout = 'default',
}) => {
  const isOnboarding = layout === 'onboarding';
  const rawId = process.env.REACT_APP_WORLD_APP_ID;
  const appId = (rawId as `app_${string}`) || (STAGING_PLACEHOLDER as `app_${string}`);
  const action = process.env.REACT_APP_WORLD_ACTION || 'human-content-verification';
  const verificationLevel = (process.env.REACT_APP_WORLD_VERIFICATION_LEVEL as VerificationLevel) || VerificationLevel.Device;

  const isPlaceholderAppId = !rawId || rawId === STAGING_PLACEHOLDER;
  const origin = typeof window !== 'undefined' ? window.location.origin : '(server)';

  return (
    <div
      className={[
        isOnboarding ? 'world-id-section world-id-section--onboarding' : 'world-id-section',
        isInWorldApp && isVerified ? 'world-id-section--worldapp-verified' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* ─── Environment indicator (replaced by verified chip in World App after success) ─── */}
      {!(isInWorldApp && isVerified) && (
        <div className="world-id-env-badge" role="status">
          <span className={`env-dot ${isInWorldApp ? 'env-dot--worldapp' : 'env-dot--browser'}`} />
          <span className="env-label">{isInWorldApp ? 'World App' : 'Browser'}</span>
        </div>
      )}
      {isInWorldApp && isVerified && (
        <div className="world-id-verified-banner" role="status" aria-live="polite">
          <span className="world-id-verified-banner__icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M7 12.5l3 3L17 8" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="9" opacity="0.35" />
            </svg>
          </span>
          <div className="world-id-verified-banner__text">
            <span className="world-id-verified-banner__title">World ID — verified</span>
            <span className="world-id-verified-banner__sub">
              You’re verified as human for this session—your writing can be tied to a real person, not a bot or generic AI
              output.
            </span>
          </div>
        </div>
      )}

      {isPlaceholderAppId && !isInWorldApp && (
        <div role="alert" className="hi-config-alert">
          <strong>World ID is not configured for this deployment.</strong> Set{' '}
          <code>REACT_APP_WORLD_APP_ID</code> in Vercel (Project → Environment Variables) to your
          app ID from the{' '}
          <a href="https://developer.worldcoin.org" target="_blank" rel="noopener noreferrer">
            World Developer Portal
          </a>
          , redeploy, and add this exact site URL under your app&rsquo;s <strong>allowed / application URL</strong> (
          {origin}).
        </div>
      )}
      {!isOnboarding && (
        <div className="section-header">
          <h3 className="world-id-h3">
            <WorldMarkIcon size="md" />
            <span>World ID</span>
          </h3>
        </div>
      )}

      {/* ─── Verified state — compact banner above + optional proof details (World App / mobile) ─── */}
      {isVerified && (
        <div className="world-id-status">
          <div className="status-verified">
            {!(isInWorldApp && isVerified) && <div className="status-badge success">Verified ✓</div>}

            {isInWorldApp ? (
              <details className="world-id-proof-collapse">
                <summary>Verification data</summary>
                <div className="world-id-details world-id-details--in-banner">
                  <div className="detail-item">
                    <span className="label">Level</span>
                    <span className="value">{worldIdProof?.verification_level}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Nullifier</span>
                    <span className="value hash world-id-details__hash--wrap">{worldIdProof?.nullifier_hash}</span>
                  </div>
                  <div className="detail-item">
                    <span className="label">Merkle root</span>
                    <span className="value hash world-id-details__hash--wrap">{worldIdProof?.merkle_root}</span>
                  </div>
                </div>
              </details>
            ) : (
              <div className="world-id-details">
                <div className="detail-item">
                  <span className="label">Verification Level:</span>
                  <span className="value">{worldIdProof?.verification_level}</span>
                </div>
                <div className="detail-item">
                  <span className="label">Nullifier Hash:</span>
                  <span className="value hash">{worldIdProof?.nullifier_hash}</span>
                </div>
                <div className="detail-item">
                  <span className="label">Merkle Root:</span>
                  <span className="value hash">{worldIdProof?.merkle_root}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Error state ─── */}
      {error && (
        <div className="error-message">
          <span className="error-icon">❌</span>
          <span>World ID Error: {error.message || error.code}</span>
        </div>
      )}

      {!isVerified && !isOnboarding && (
        <p className="world-id-why">
          Verify with World ID to prove this writing came from a real person.
        </p>
      )}

      {/* ─── BRANCHED VERIFY FLOW ─── */}
      {!isVerified && (
        <div className="world-id-widget">
          {isInWorldApp ? (
            /* === World App path: native MiniKit verify === */
            <button
              onClick={onVerifyMiniKit}
              disabled={isLoading}
              className="world-id-button world-id-button--minikit"
              id="minikit-verify-btn"
            >
              {isLoading ? (
                <span className="loading-text">
                  <span className="spinner">⏳</span>
                  Verifying via World App…
                </span>
              ) : (
                <span className="button-text">
                  <WorldMarkIcon size="sm" className="world-id-btn__mark" />
                  Verify with World App
                </span>
              )}
            </button>
          ) : (
            /* === Browser path: IDKit widget === */
            <IDKitWidget
              app_id={appId}
              action={action}
              verification_level={verificationLevel}
              onSuccess={onVerify}
              onError={onError}
            >
              {({ open }) => (
                <button
                  onClick={open}
                  disabled={isLoading || isPlaceholderAppId}
                  className="world-id-button"
                  id="idkit-verify-btn"
                  title={isPlaceholderAppId ? 'Configure REACT_APP_WORLD_APP_ID and Developer Portal URL first' : undefined}
                >
                  {isLoading ? (
                    <span className="loading-text">
                      <span className="spinner">⏳</span>
                      Verifying…
                    </span>
                  ) : (
                    <span className="button-text">
                      <WorldMarkIcon size="sm" className="world-id-btn__mark" />
                      Verify with World ID
                    </span>
                  )}
                </button>
              )}
            </IDKitWidget>
          )}
        </div>
      )}
    </div>
  );
};

export default WorldIDWidget; 