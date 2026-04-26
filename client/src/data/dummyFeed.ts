/**
 * World App feed preview content (illustrative profiles and posts).
 */
export type FeedVoice = 'professional' | 'academic' | 'personal';

export type DummyFeedItem = {
  id: string;
  displayName: string;
  handle: string;
  author: string;
  timeLabel: string;
  publicText: string;
  hasNullifier: boolean;
  entryId: number;
  /** Short form for link label */
  txPreview: string;
  /** Optional full URL for the tx line (e.g. explorer). Omitted = non-navigating visual link. */
  txUrl?: string;
  keystrokeCount: number;
  /** chars/s × 1000 for any future use */
  typingSpeedScaled: number;
  voice: FeedVoice;
  /** Single category pill: FOUNDER, ECOSYSTEM, etc. */
  formatLabel: string;
};

export const FEED_CHANNEL_PROFILE = {
  displayName: 'Human Inkwell',
  handle: 'humaninkwell',
  bio: 'The authorship layer for the post-AI internet. Biometric signatures, anchored onchain. Proof a human wrote it, not ChatGPT.',
  following: 1284,
  followers: 1_000_000,
  location: 'World Chain',
  websiteLabel: 'humanink.wld',
  joined: 'Mar 2025',
};

const HOUR = 60 * 60 * 1000;
const now = () => Date.now();

/**
 * Public feed preview: top posts as inner-circle, ecosystem-aligned examples.
 * Tx URLs are placeholders for presentation unless set.
 */
export const DUMMY_FEED_ITEMS: DummyFeedItem[] = [
  {
    id: 'alex-1',
    displayName: 'Alex Blania',
    handle: 'alexblania',
    author: '0x1a1e…0f01',
    timeLabel: new Date(now() - 9 * 60 * 1000).toISOString(),
    publicText:
      'Digital identity is the missing piece of the AI puzzle. If we cannot verify who is human, the internet becomes a hall of mirrors. HumanInk on World Chain is how we fix the incentive layer for creators. Authenticity is the new premium.',
    hasNullifier: true,
    entryId: 4201,
    txPreview: '0x2c9a…e441',
    txUrl: 'https://worldscan.org',
    keystrokeCount: 245,
    typingSpeedScaled: 2600,
    voice: 'professional',
    formatLabel: 'FOUNDER',
  },
  {
    id: 'jesse-1',
    displayName: 'Jesse Pollak',
    handle: 'jessepollak',
    author: '0x83bb…22cc',
    timeLabel: new Date(now() - 15 * 60 * 1000).toISOString(),
    publicText:
      'We are moving to a world where "onchain" is the default for every meaningful interaction. Writing with a biometric signature is not just about proof. It is about building a global economy that bots cannot spam. Based.',
    hasNullifier: true,
    entryId: 4202,
    txPreview: '0x7b22…8aad',
    txUrl: 'https://worldscan.org',
    keystrokeCount: 198,
    typingSpeedScaled: 2700,
    voice: 'professional',
    formatLabel: 'ECOSYSTEM',
  },
  {
    id: 'mira-1',
    displayName: 'Mira Okonkwo',
    handle: 'miraok_research',
    author: '0x3a1f…c9d2',
    timeLabel: new Date(now() - 2.2 * HOUR).toISOString(),
    publicText:
      'IRB finally cleared our keystroke-pacing study (n=84). Early finding: under deadline, people do not just type faster. Spacebar hold times and backspace patterns tell a different story than WPM alone. Onchain we only commit content hashes and session metadata.',
    hasNullifier: true,
    entryId: 1204,
    txPreview: '0x4f2a…1bbe',
    txUrl: 'https://worldscan.org',
    keystrokeCount: 312,
    typingSpeedScaled: 3100,
    voice: 'academic',
    formatLabel: 'ACADEMIC',
  },
  {
    id: 'james-1',
    displayName: 'James Park',
    handle: 'jamesp_product',
    author: '0x71bb…0e01',
    timeLabel: new Date(now() - 5.5 * HOUR).toISOString(),
    publicText:
      'Shipped the v0 proof flow. Same human. Same session. Zero pasting. The content hash is the receipt. The typing pattern is a signature a bot cannot copy from a template. This is the stack we are betting on for high-trust publishing.',
    hasNullifier: true,
    entryId: 4203,
    txPreview: '0x8c11…6af0',
    txUrl: 'https://worldscan.org',
    keystrokeCount: 210,
    typingSpeedScaled: 3200,
    voice: 'professional',
    formatLabel: 'PRODUCT',
  },
];
