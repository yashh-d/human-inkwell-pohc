import React from 'react';

const LOGO_HUMANINK = '/brand/humanink-logo.jpeg';
/** World product mark: official orb asset + “world” word in UI (lowercase) */
const LOGO_WORLD_ICON = '/brand/world-icon.png';

type PoweredByWorldProps = {
  /** 'header' larger logo; 'footer' compact */
  variant?: 'header' | 'footer';
  className?: string;
  /** e.g. onboarding dialog `aria-labelledby` */
  rootId?: string;
  /** Set false when a parent (e.g. BrandHeader) provides the subtitle */
  showTagline?: boolean;
};

/**
 * Humanink wordmark + “powered by” + World mark. Tagline optional.
 */
const PoweredByWorld: React.FC<PoweredByWorldProps> = ({
  variant = 'header',
  className = '',
  rootId,
  showTagline = true,
}) => {
  const isHeader = variant === 'header';
  return (
    <div
      id={rootId}
      className={`hi-brand ${isHeader ? 'hi-brand--header' : 'hi-brand--footer'} ${className}`.trim()}
    >
      <div className="hi-brand__row">
        <img
          src={LOGO_HUMANINK}
          alt="Humanink"
          className="hi-brand__humanink-logo"
        />
      </div>
      {showTagline && <p className="hi-brand__tagline">Biometric typing &amp; onchain attestation</p>}
      <div className="hi-brand__powered">
        <span className="hi-brand__humanink-name">Humanink</span>
        <span className="hi-brand__dot" aria-hidden>
          ·
        </span>
        <span className="hi-brand__powered-text">powered by</span>
        <a
          href="https://world.org"
          target="_blank"
          rel="noopener noreferrer"
          className="hi-brand__world-link"
          aria-label="World — visit world.org"
        >
          <img src={LOGO_WORLD_ICON} alt="" className="hi-brand__world-icon" width={32} height={32} />
          <span className="hi-brand__world-word">world</span>
        </a>
      </div>
    </div>
  );
};

export default PoweredByWorld;
