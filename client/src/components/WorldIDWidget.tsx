import React from 'react';
import { IDKitWidget, ISuccessResult, IErrorState, VerificationLevel } from '@worldcoin/idkit';

interface WorldIDWidgetProps {
  isVerified: boolean;
  worldIdProof: ISuccessResult | null;
  error: IErrorState | null;
  isLoading: boolean;
  onVerify: (proof: ISuccessResult) => Promise<void>;
  onError: (error: IErrorState) => void;
}

const STAGING_PLACEHOLDER = 'app_staging_12345';

const WorldIDWidget: React.FC<WorldIDWidgetProps> = ({
  isVerified,
  worldIdProof,
  error,
  isLoading,
  onVerify,
  onError,
}) => {
  const rawId = process.env.REACT_APP_WORLD_APP_ID;
  const appId = (rawId as `app_${string}`) || (STAGING_PLACEHOLDER as `app_${string}`);
  const action = process.env.REACT_APP_WORLD_ACTION || 'human-content-verification';
  const verificationLevel = (process.env.REACT_APP_WORLD_VERIFICATION_LEVEL as VerificationLevel) || VerificationLevel.Device;

  const isPlaceholderAppId = !rawId || rawId === STAGING_PLACEHOLDER;
  const origin = typeof window !== 'undefined' ? window.location.origin : '(server)';

  return (
    <div className="world-id-section">
      {isPlaceholderAppId && (
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
      <div className="section-header">
        <h3>🌍 World ID Human Verification</h3>
        <p className="description">
          Verify your humanness with World ID for blockchain-based content authentication
        </p>
      </div>

      <div className="world-id-status">
        {isVerified ? (
          <div className="status-verified">
            <div className="status-badge success">✅ Verified Human</div>
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
          </div>
        ) : (
          <div className="status-unverified">
            <div className="status-badge pending">⏳ Unverified</div>
            <p className="verification-prompt">
              Please verify your humanness with World ID to proceed with content authentication
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="error-message">
          <span className="error-icon">❌</span>
          <span>World ID Error: {error.message || error.code}</span>
        </div>
      )}

      {!isVerified && (
        <div className="world-id-widget">
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
                title={isPlaceholderAppId ? 'Configure REACT_APP_WORLD_APP_ID and Developer Portal URL first' : undefined}
              >
                {isLoading ? (
                  <span className="loading-text">
                    <span className="spinner">⏳</span>
                    Verifying...
                  </span>
                ) : (
                  <span className="button-text">
                    <span className="world-icon">🌍</span>
                    Verify with World ID
                  </span>
                )}
              </button>
            )}
          </IDKitWidget>
        </div>
      )}

      <div className="world-id-info">
        <h4>About World ID Verification</h4>
        <ul>
          <li>🔐 <strong>Privacy-First:</strong> Your biometric data stays on your device</li>
          <li>🌐 <strong>Proof of Personhood:</strong> Cryptographic proof you're a unique human</li>
          <li>🔒 <strong>Zero-Knowledge:</strong> No personal information is shared</li>
          <li>⚡ <strong>Instant:</strong> Verification happens in seconds</li>
        </ul>
      </div>
    </div>
  );
};

export default WorldIDWidget; 