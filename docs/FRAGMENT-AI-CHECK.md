# Fragment-level AI checking

**Goal.** Instead of scoring the finished document once, score *what was added since
last time*: pull the text of each insertion out of Google's changelog, group the
insertions into spans, and run the detector on each span. The report then says
*"this 900-character block, added Aug 12 at 3:41pm with no typing behind it, scores
0.97"* rather than *"this document scores 0.62"*.

The key realisation: **we do not need to store the previous version of the document.**
Google's changelog is already a diff, it is server-side, and it covers edits made
before the extension was installed, on another machine, or with tracking toggled off.

---

## 1. What already exists

| Piece | Where | State |
|---|---|---|
| Per-revision inserted **text** | `human-ink-extension/src/revisions.js:86` — each entry normalises to `{ ts, userIndex, inserted, deleted, text }` | Done |
| Full-document reconstruction + export text | `revisions.js:119`, `revisions.js:163` | Done |
| "Big insert = paste" threshold | `revisions.js:16` — `REV_PASTE_CHARS = 100` | Done, reuse as the span floor |
| Changelog adoption gate | `human-ink-extension/src/popup.js:565` — only adopts `source === 'internal' && editEvents > 0 && !analysisUnavailable` | Done |
| Detector HTTP API | `server/ai-detector/app.py:96` — `DetectRequest { text, contentHash }` | Single text per call |
| Server-side batching + cache | `server/ai-detector/batcher.py` — MicroBatcher collects concurrent calls into `score_batch`, caches by text/contentHash | Done — N concurrent fragment calls batch automatically |
| Client seam + fallback | `client/src/lib/aiDetector.ts` — `detectAi()`, falls back to `computeAiScore()` when the endpoint is down | Done |
| Per-doc storage | `human-ink-extension/src/background.js` — `doc:<id>` rollup cache in `chrome.storage` | Extend with a checkpoint |

**Nothing in the detector or the capture layer needs to be rebuilt.** The work is
assembly, checkpointing, persistence, and presentation.

---

## 2. Data model

### 2.1 Checkpoint (extension, `chrome.storage.local`)

```js
`aicheck:<docId>` = {
  lastRevisionTs: 1755640000000,   // newest changelog ts scored so far
  lastScanAt:     1755640500000,
  fragments: [ /* FragmentScore, newest first, capped at 50 */ ],
}
```

### 2.2 FragmentScore

```js
{
  id:        'sha256(docId|startTs|chars)',  // stable, so a rescan dedupes
  startTs:   1755639000000,   // first insertion in the span (epoch ms)
  endTs:     1755639004000,   // last insertion in the span
  chars:     912,
  arrival:   'burst' | 'single_insert',   // many small inserts vs one big one
  typedCover: 0.02,           // 0..1 — share of these chars we ALSO saw as keystrokes
  ai:        97,              // 0..100 from the detector
  source:    'model' | 'fallback',
  textHash:  'sha256(span text)',
  text:      null,            // see §6 — null unless text retention is turned on
}
```

`typedCover` is the important one and is the reason this lives next to capture, not
in the web app: it cross-references the span against the live keystroke record.

---

## 3. Algorithm

Run at **publish** (mandatory) and optionally on **popup open** (cheap because of the
detector's cache).

1. **Scan.** `SCAN_REVISIONS` → entries `{ ts, userIndex, inserted, deleted, text }`.
   If `analysisUnavailable`, go to §5.
2. **Filter to new.** Keep entries with `ts > checkpoint.lastRevisionTs`. On a first
   run, everything is new — that is correct, the whole document gets fragmented.
3. **Assemble spans.** Merge consecutive insertions when *all* hold:
   - same `userIndex`,
   - gap between them `< 30_000` ms,
   - both are insertions (a delete-heavy entry ends the span — that is revision, not arrival).
4. **Filter spans.** Drop spans under `REV_PASTE_CHARS` (100). Short spans score badly
   and are the main source of false positives. Cap at **12 spans per scan**, largest
   first; log what was dropped rather than silently truncating.
5. **Cross-reference typing.** For each span, compute `typedCover` from the session
   timeline: what share of those characters appeared as keystroke bursts in the same
   time window. A span typed live has `typedCover` near 1.
6. **Score.** POST each span to `/api/ai-detect` concurrently (the MicroBatcher merges
   them; the cache makes rescans free). Pass `contentHash = textHash` so the cache key
   is stable. Timeout per span 30s; a failed span records `source: 'fallback'` and is
   shown as unscored, never as 0 or 100.
7. **Persist.** Write fragments to the checkpoint and onto the session row / proof
   payload. Advance `lastRevisionTs`.

---

## 4. How results are presented — and the rule that matters

**AI score alone never accuses.** The product signal is the *pair*:

| `typedCover` | AI score | Reading |
|---|---|---|
| ~1 (typed live) | high | Detector artifact. Show the score, do not flag it. Non-native and formulaic writers land here constantly. |
| ~0 (arrived whole) | high | The real signal. Text appeared with no process behind it and reads as generated. |
| ~0 | low | Pasted from a source — the existing paste provenance (external / internal / cited) already covers this. |
| ~1 | low | Ordinary writing. |

This must stay **mathematically decoupled from the Process Score** (an existing product
decision — see `PROCESS-SCORE.md` and `client/src/lib/authorship.ts:389`). Fragment
scores are displayed evidence, never a term in the score. Bias the bands yellow: a
false red is a wrongful accusation against a student.

---

## 5. Fallback when Google restricts the changelog

`analysisUnavailable` is common — Google has been restricting the internal endpoint.
In that case there is no per-edit text, only the full export. Fallback:

1. On each scan, split the export text into paragraph chunks; store `sha256` per chunk
   in the checkpoint (hashes only, cheap and privacy-safe).
2. Next scan, chunks whose hash is new are the added text.
3. Score those chunks with the same pipeline. `typedCover` still works — it comes from
   our own capture, not from Google.

This is strictly worse (paragraph granularity, no timestamps, no author index) but it
degrades rather than disappearing.

---

## 6. Privacy / FERPA decision required

Scoring a fragment means **sending student prose to the detector**. Precedent exists:
the full document text is already POSTed at publish and never stored (`popup.js:51`).

Two options, and this is a founder call, not an implementation detail:

- **(A) Scores only.** Store `textHash` + metrics, never the text. The professor sees
  *"912 chars added Aug 12, no typing, 0.97"* but not the words. Lowest risk.
- **(B) Scores + text.** Store the span text so the professor can read what was
  inserted. This is what `paste_events` already does for pasted text, so it is a
  consistent choice — but it widens the amount of retained student writing, and it
  needs to be covered by the assignment-scoped delete/expiry path in `PRODUCT-DIRECTION.md`.

Default to **(A)** unless the professor workflow demonstrably needs the text.

---

## 7. Failure modes to handle explicitly

- **Short spans** — floor at 100 chars; below that the detector is close to noise.
- **Quoted material** — a pasted quotation from a cited source scores as non-human because
  it *is* non-student text. Use the existing `cited_source` provenance to label these
  rather than flagging them.
- **Translated text** — non-native writers who draft in another language and translate
  score high with legitimate process. `typedCover` is the guard.
- **Detector down** — spans record `source: 'fallback'` and render as "not scored".
  Never render an unscored span as a low or high number.
- **Rescan drift** — Google occasionally renumbers revisions; dedupe on `id`
  (`docId|startTs|chars`), not on array position.

---

## 8. Test plan

1. Type a paragraph live → one span, `typedCover ≈ 1`, low AI. Must not flag.
2. Paste 900 chars of ChatGPT output → one span, `typedCover ≈ 0`, high AI. Must flag.
3. Paste a 900-char quotation from a cited source → high AI, but labelled cited, not flagged.
4. Toggle tracking OFF, paste, toggle on, publish → span still detected (changelog is
   toggle-independent) and the pause is disclosed alongside it.
5. Publish twice with no edits between → second scan produces zero new spans and costs
   zero inference (cache hit).
6. Doc where `analysisUnavailable` fires → §5 path produces paragraph-level spans.

---

## 9. Build order

1. Checkpoint storage + span assembly in the extension (no scoring yet) — verifiable
   against a real doc by logging spans.
2. `typedCover` cross-reference against the session timeline.
3. Wire scoring through `/api/ai-detect`; add a `texts[]` batch endpoint only if the
   per-span call count proves to be a problem.
4. Persist onto the proof payload + session row (migration for the new column).
5. Report UI: fragment list with time, size, arrival, typedCover, score.
6. Professor view.
