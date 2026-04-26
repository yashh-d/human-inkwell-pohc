import React from 'react';
import PoweredByWorld from './PoweredByWorld';
import AuthButton from './AuthButton';

type BrandHeaderProps = {
  /** Optional extra line under the standard tagline */
  subtitle?: string;
};

const BrandHeader: React.FC<BrandHeaderProps> = ({ subtitle }) => {
  return (
    <header className="hi-app-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div className="hi-app-header__body">
        <PoweredByWorld variant="header" showTagline={false} />
        {subtitle && <p className="hi-app-header__subtitle">{subtitle}</p>}
      </div>
      <div className="hi-app-header__auth">
        <AuthButton />
      </div>
    </header>
  );
};

export default BrandHeader;
