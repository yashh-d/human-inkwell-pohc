# Feature Roadmap

Track in-progress and upcoming features. Check off as completed.

> **Status (2026-05-19):** Audit found that `ledger_submissions` table, `/api/my-ledger`, `/api/feed`, and the public checkmark already exist. Most of the remaining work is UI wiring, not new DB design.

---

## 1. World Mini App — Workspace UI

- [x] Idle CTA card replaces the inline composer in the World mini app — "What are you typing today?" tap target.
- [x] Tap opens a fullscreen modal overlay (`hi-workspace--world`) with the full composer + tracking + publish flow inside.
- [x] **Hybrid styling**: short-form uses Twitter/X chrome (dark, compact, char count); long-form switches to Google Docs paper feel (off-white, wider margins, larger title input).
- [x] All existing tracking behavior preserved (paste/copy blocks, biometric capture, sign + publish handlers all run inside the modal).
- [x] Exit affordance — × button top-right; draft state preserved on close.
- [x] Body scroll-locked while open; safe-area insets respected.
- [x] When `?focusWriting` lands on /write inside the World app, the modal auto-opens.
- [ ] Verify on real World App webview (only desktop-tested so far).
- [ ] Optional: add Esc-to-close keyboard shortcut.

---

## 2. Per-User Content Database (My Content tab)

- [x] **Supabase schema** — `ledger_submissions` already exists with `author_address`, `content_hash`, `keystroke_count`, etc. RLS allows anon select/insert (writes still application-guarded).
- [x] **API route** — `/api/my-ledger` returns wallet-signed list of rows for an `author_address`.
- [x] **Push `title` + `content_type` migration** — applied 2026-05-19 (`title` nullable, `content_type` short/long with CHECK constraints).
- [ ] **Wire MyContentPage** — replace `MY_CONTENT_DEMO_ROWS` with `fetchMyLedgerRows(signer)` from Privy embedded wallet.
- [ ] **Handle empty / loading / error states** in MyContentPage.

---

## 3. Public Feed Database

- [x] **Schema** — `is_verified` + `public_text` already exist; the publish-to-feed checkmark on [HomePage.tsx:671](client/src/pages/HomePage.tsx#L671) writes `public_text` via `pushLedgerIndexAfterOnChainSuccess`.
- [x] **API route** — `/api/feed` returns `is_verified = true` rows newest-first.
- [x] **`title` column** for long-form (migration applied 2026-05-19).
- [ ] **Wire FeedPage** — replace `DUMMY_FEED_ITEMS` with `fetchPublicFeed()`.
- [ ] **Render `title` on long-form feed cards** (above the body); hide title field for short-form.
- [ ] **HomePage composer** — add a "Short / Long" toggle and a title input visible only when `content_type === 'long'`. Pass through to `/api/ledger-onchain`.
- [ ] **`/api/ledger-onchain`** — accept + validate `title` (≤ 200 chars, only when `content_type='long'`) and `content_type` (`'short' | 'long'`), insert into row.

---

## Operational

- [x] **Supabase CLI installed + linked** to project `cgqntxwubwzfvwiyeuws` (HI + AF).
- [x] **All 4 migrations applied** to remote DB.
- [ ] **Vercel env vars** — confirm `REACT_APP_SUPABASE_URL` + `REACT_APP_SUPABASE_ANON_KEY` point at the new project, redeploy.
- [ ] **Rotate PAT** that was pasted in conversation (https://supabase.com/dashboard/account/tokens).

---

## Open Questions

- Sort the feed by pure recency, or factor in a human-authenticity score from tracking metadata?
- For long-form titles: should we allow Markdown / emoji, or strict plain text?
- Drafts (unsaved/unpublished) — same table with a `status` column, or a separate `drafts` table?
