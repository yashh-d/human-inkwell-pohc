/**
 * Simulated World ID style feed (demo / UI only; not from Supabase).
 */
export type FeedVoice = 'professional' | 'academic' | 'personal';

export type DummyFeedItem = {
  id: string;
  /** Shown in the post header (X-style) */
  displayName: string;
  /** Without @; rendered as @handle */
  handle: string;
  /** Used for avatar color + full address tooltip */
  author: string;
  timeLabel: string;
  publicText: string;
  hasNullifier: boolean;
  entryId: number;
  /** Shown in footer; not a real onchain id for this demo. */
  txPreview: string;
  keystrokeCount: number;
  /** chars/s × 1000 for display helper */
  typingSpeedScaled: number;
  voice: FeedVoice;
  /** e.g. Thread, Article excerpt, Note */
  formatLabel: string;
};

export const FEED_CHANNEL_PROFILE = {
  displayName: 'Human Inkwell',
  handle: 'humaninkwell',
  bio: 'A public window into World ID verified writing: research memos (including AI systems work), school and college policy takes, and personal brand posts: hashes and typing proofs on World Chain, not raw keylogs on a server.',
  following: 1284,
  followers: 4102,
  location: 'World Chain',
  websiteLabel: 'humanink.wld',
  joined: 'Mar 2025',
};

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const now = () => Date.now();

export const DUMMY_FEED_ITEMS: DummyFeedItem[] = [
  {
    id: '7',
    displayName: 'Dr. Priya Nandakumar',
    handle: 'priya_moe_nlp',
    author: '0x55aa…3e1f',
    timeLabel: new Date(now() - 7 * 60 * 1000).toISOString(),
    publicText:
      'Excerpt from our working paper on “sparse language routing” (arXiv draft; stats peer-review next). Main claim: a Mixture-of-Experts (MoE) stack and a “single dense” transformer are not just different sizes, they imply different failure surfaces. MoE routes each token to a subset of expert MLPs via a learned gating function; the rest of the parameters are literally inactive, which is why you can match larger dense models on benchmarks with a fraction of active FLOPs. We walk through the standard transformer block (self-attention + feed-forward) and then contrast it with Switch- / GLaM-style sparsity: gating noise, load-balancing aux losses, and the trade-off between expressivity and stability when you scale width vs depth. In industry, “mixture of models” often just means ensembling separate checkpoints; we reserve that label for runtime composition, and we keep MoE for routed sub-networks inside one forward pass. If you are picking between MoE and dense for long-context or safety-sensitive pipelines, the appendix has a decision rubric. Full equations are not onchain; this attestation is only: I wrote this section myself.',
    hasNullifier: true,
    entryId: 1206,
    txPreview: '0x6aa1…c9fe',
    keystrokeCount: 1240,
    typingSpeedScaled: 2550,
    voice: 'academic',
    formatLabel: 'Report / preprint excerpt',
  },
  {
    id: '8',
    displayName: 'Dr. Aisha Cole',
    handle: 'aisha_teach_ready',
    author: '0x3ff2…0bc7',
    timeLabel: new Date(now() - 19 * 60 * 1000).toISOString(),
    publicText:
      "Quick brief for school and college leaders piloting an AI-literate policy next term (we're sharing the prose CC-BY for the demo). (1) K-12: separate home practice (typing tutors, language help) from assessed work, and require a short provenance line for longer essays (draft history or teacher-supervised on-device capture) rather than a flat ban on all model use. (2) Higher ed: align syllabi to your honor code: disclosure when models assist ideation versus drafting; lab write-ups may still be model-free by policy. (3) Cross-cutting: FERPA still governs student records; anything involving minors' writing should be vetted with district or campus counsel. Human-ink style attestation (proof of human + on-device biometrics) is one tool, not a substitute for teaching, access, or equity. Happy to run a 30-min Q&A for faculty senates. Full PDF memo is offchain; this post is a verified human abstract only.",
    hasNullifier: true,
    entryId: 1205,
    txPreview: '0x4bb8…2a1d',
    keystrokeCount: 842,
    typingSpeedScaled: 2700,
    voice: 'professional',
    formatLabel: 'K-12 & higher-ed brief',
  },
  {
    id: '1',
    displayName: 'Mira Okonkwo',
    handle: 'miraok_research',
    author: '0x3a1f…c9d2',
    timeLabel: new Date(now() - 18 * 60 * 1000).toISOString(),
    publicText:
      'IRB finally cleared our keystroke-pacing study (n=84). Early finding: under deadline, people don’t just type faster, hold times on the spacebar and backspace tell a different story than WPM alone. Preprint next week; onchain we only commit content hashes and session metadata.',
    hasNullifier: true,
    entryId: 1204,
    txPreview: '0x4f2a…1bbe',
    keystrokeCount: 312,
    typingSpeedScaled: 3100,
    voice: 'academic',
    formatLabel: 'Research update',
  },
  {
    id: '2',
    displayName: 'James Park',
    handle: 'jamesp_product',
    author: '0x71bb…0e01',
    timeLabel: new Date(now() - 2.2 * HOUR).toISOString(),
    publicText:
      'Shipped the v0 proof flow: same human, same session, no paste. The content hash is the receipt; the typing pattern is a signature a bot can’t copy from a template. If you’re building trust with publishers or compliance, this is the shape of the stack we’re betting on.',
    hasNullifier: true,
    entryId: 1203,
    txPreview: '0x8c11…6af0',
    keystrokeCount: 198,
    typingSpeedScaled: 3350,
    voice: 'professional',
    formatLabel: 'Product note',
  },
  {
    id: '3',
    displayName: 'A. Voss',
    handle: 'a_voss_notes',
    author: '0xda04…2f7a',
    timeLabel: new Date(now() - 6.5 * HOUR).toISOString(),
    publicText:
      'Long-form method dump (for reviewers + anyone expanding the “…” UI). We compared keystroke-level timing across two drafts of the same lit-review paragraph: first pass vs second pass after sleep. Hypothesis: down-to-down variance on function keys drops after rest even when WPM is flat, suggesting motor “settling” that simple speed metrics miss. ' +
        'We bind each draft to a distinct content hash; World ID ties a single human to each run without ever uploading keylogs. ' +
        "If you expanded this block, the collapse control is working. This section is intentionally verbose. All addresses and txs here are simulated for the shell, not onchain testnet reality.",
    hasNullifier: true,
    entryId: 1202,
    txPreview: '0x0bb3…4ee2',
    keystrokeCount: 712,
    typingSpeedScaled: 2620,
    voice: 'academic',
    formatLabel: 'Article / lab note',
  },
  {
    id: '4',
    displayName: 'Elena Ruiz',
    handle: 'elena_onchain',
    author: '0xef90…5aa3',
    timeLabel: new Date(now() - 1.1 * DAY).toISOString(),
    publicText:
      'Thesis in one line: onchain attestation without the essay in plaintext is the right default. The feed is signal; the contract is proof. Everything else is UX.',
    hasNullifier: false,
    entryId: 1201,
    txPreview: '0x1d44…9c01',
    keystrokeCount: 52,
    typingSpeedScaled: 4200,
    voice: 'professional',
    formatLabel: 'Hot take',
  },
  {
    id: '5',
    displayName: 'Lina M.',
    handle: 'lina_mornings',
    author: '0x42ac…8f01',
    timeLabel: new Date(now() - 1.85 * DAY).toISOString(),
    publicText:
      "Coffee, then 500 words before Slack wins. I’m not shipping a company today, I’m building a public writing habit and letting the attestation be my 'I actually typed this' receipt. If it helps one person stop doomscrolling and publish: worth it. ☕",
    hasNullifier: true,
    entryId: 1200,
    txPreview: '0x2c91…a0dd',
    keystrokeCount: 240,
    typingSpeedScaled: 3000,
    voice: 'personal',
    formatLabel: 'Personal brand',
  },
  {
    id: '6',
    displayName: 'Prof. D. Saito',
    handle: 'saito_econeth',
    author: '0x9e33…1c4b',
    timeLabel: new Date(now() - 3.2 * DAY).toISOString(),
    publicText:
      "Conference panel recap. Three provable-identity ideas that stuck: (1) separation of *who wrote* from *what was written*; (2) why journals should care more than social platforms; (3) the boring truth that most fraud is copy-paste, not stylometry. " +
        'Citations in the paper; onchain I’m only attesting I authored this thread myself.',
    hasNullifier: true,
    entryId: 1199,
    txPreview: '0x5ee0…77ab',
    keystrokeCount: 380,
    typingSpeedScaled: 2900,
    voice: 'academic',
    formatLabel: 'Thread / recap',
  },
];
