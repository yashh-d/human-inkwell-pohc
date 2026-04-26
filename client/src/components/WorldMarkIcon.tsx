import React from 'react';

const SRC = '/brand/world-icon.png';

export type WorldMarkSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZES: Record<WorldMarkSize, number> = {
  xs: 14,
  sm: 18,
  md: 24,
  lg: 28,
};

/** Worldcoin / World mark — use instead of world/globe emojis */
const WorldMarkIcon: React.FC<{
  size?: WorldMarkSize;
  className?: string;
}> = ({ size = 'md', className = '' }) => {
  const s = SIZES[size];
  return (
    <img
      src={SRC}
      alt=""
      width={s}
      height={s}
      className={`world-mark-img ${className}`.trim()}
      aria-hidden
    />
  );
};

export default WorldMarkIcon;
