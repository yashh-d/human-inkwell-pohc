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
    <div className={isOnboarding ? 'world-id-section world-id-section--onboarding' : 'world-id-section'}>
      {/* ─── Environment indicator ─── */}
      <div className="world-id-env-badge" role="status">
        <span className={`env-dot ${isInWorldApp ? 'env-dot--worldapp' : 'env-dot--browser'}`} />
        <span className="env-label">
          {isInWorldApp ? 'World App' : 'Browser'}
        </span>
      </div>

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
            <span>World ID Human Verification</span>
          </h3>
        </div>
      )}

      {/* ─── Verified state (same for both paths) ─── */}
      {isVerified && (
        <div className="world-id-status">
          <div className="status-verified">
            <div className="status-badge success">Verified ✓</div>
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
              {isInWorldApp && (
                <div className="detail-item">
                  <span className="label">Verified via:</span>
                  <span className="value">World App (native)</span>
                </div>
              )}
            </div>
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
          World ID links proof of personhood to this session, so your attestations and onchain records are tied to one
          unique human, not a bot or an AI.
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