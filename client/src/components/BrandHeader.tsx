import React from 'react';
import PoweredByWorld from './PoweredByWorld';

type BrandHeaderProps = {
  /** Optional extra line under the standard tagline */
  subtitle?: string;
};

const BrandHeader: React.FC<BrandHeaderProps> = ({ subtitle }) => {
  return (
    <header className="hi-app-header">
      <div className="hi-app-header__body">
        <PoweredByWorld variant="header" showTagline={false} />
        {subtitle && <p className="hi-app-header__subtitle">{subtitle}</p>}
      </div>
    </header>
  );
};

export default BrandHeader;
