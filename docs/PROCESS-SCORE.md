# The Process Score — how it is derived

A single number, 0–100, describing how a piece of writing came to exist. It is not
a plagiarism score and not an AI-detection score. It reads the *process*: how fast
text appeared, how much it was reworked, over how long, and how much of it we
actually witnessed.

Source of truth: `client/src/lib/authorship.ts`. Band thresholds are server-tunable
via `/api/scoring-config`.

---

## The formula

Three independent 0–100 measures, weighted and averaged. **Not** points deducted
from a starting score.

```
Process Score = 0.50 × Revision density
              + 0.30 × Generative velocity
              + 0.20 × Temporal distribution
```

| Band | Range | Meaning |
|---|---|---|
| 🟢 Green | > 70 | The process accounts for the work |
| 🟡 Yellow | 60–70 | Worth a glance — not an accusation |
| 🔴 Red | < 60 | The process does not account for the work |

Honest work lands **above 70**. A false red is a wrongful accusation, so red is
reserved for scores well clear of the middle band.

The table above is for reading this document. **The product itself shows only the
number and the colour** — no wording is printed beside a score anywhere. A word
like "Authentic" or "Investigate" next to a student's name is a conclusion drawn
on the reader's behalf, and it is the one part of a report that gets quoted back
in a misconduct hearing. The evidence is spelled out underneath; the judgment
stays with the instructor.

> **Note on the old scale.** An earlier version was subtractive — it started high
> and deducted. That model produced scores like 52 for ordinary work, which read as
> a failing grade on a 100-point scale. It has been replaced entirely.

> **Note on the fourth dimension.** There used to be a *Capture coverage* measure
> at 10%, scoring how much of the finished piece we watched arrive. It scored
> 100/100 on 22 of the 25 calibration cases, so in practice it was a flat bonus
> that compressed the three measures that actually discriminate. It was removed and
> its weight went to revision density. Unobserved text still registers — see
> [Text we never saw](#text-we-never-saw), below.

---

## 1. Revision density — 50%

*Is there evidence of composing, rather than text arriving finished?*

Weighted highest because it is the hardest thing to fake. Composing in a word
processor is messy; transcribing something that already exists is not.

### (a) Backspace ratio — 55% of the dimension

Deletions ÷ printable characters typed.

| Ratio | Score |
|---|---|
| 0% | 0 |
| 0.5% | 25 |
| 9%+ | 100 |

Requires 300+ typed characters to mean anything; below that it scores a neutral 60
rather than penalizing a short piece.

### (b) Burst depth — 45% of the dimension

A *burst* is a run of typing ended by a pause of 2 seconds or more — one
stop-think-type cycle.

```
expected  = max(6, words ÷ 50)
depth     = burst count + 2 × (Google Docs saved revisions)
score     = 40 + 60 × min(1, depth ÷ expected)
```

Measured **against the length of the piece**, so a long document earns nothing for
being long. Google's saved revisions count double: that log is written by Google,
not by the writer.

If no burst data was captured at all (an older hand-off), this scores 70 —
*unknown*, not *absent*. A missing record is not evidence.

### (c) Non-linear editing — up to +12, credit only

Share of typing bursts that resumed somewhere the writer had gone **back** to,
rather than carrying on from the end. Full credit at 25%.

Writers rarely compose start to finish; they draft, return to an earlier paragraph,
rework it, and carry on. A pasted or transcribed draft only ever grows at the end.

**Credit only, deliberately.** Its absence is not evidence — some people genuinely
do write in order, and a writer who navigates by mouse-wheel would score zero here
while doing honest work. Earning it lifts the score; not earning it costs nothing.

### Observation factor

The whole dimension scales down if less than 25% of the finished document was typed
in front of us. This is **not** a paste penalty — it is the honest observation that
revision behaviour cannot be read from text that was never typed where we could see
it.

---

## 2. Generative velocity — 30%

*How fast did the text appear?*

Words per **active** minute. Active time excludes idle gaps and hidden-tab time,
with any single visible pause capped at 3 minutes.

| Pace (words/active min) | Score |
|---|---|
| ≤ 40 | 100 |
| 70 | 80 |
| 100 | 45 |
| 160 | 15 |
| 300+ | 0 |

Students average roughly **13 words per active minute** on academic writing under
exam conditions. Everything up to 40 is free.

### Burst rhythm — 25% of the dimension

The *variance* of pause lengths and burst sizes, when a timeline was captured:

```
score = 30 + 40 × min(1, gapVariation ÷ 0.7)
           + 30 × min(1, sizeVariation ÷ 0.55)
```

A human types a clause, stops to read it back, types a longer run. That unevenness
is what composing looks like. A steady, uniform stream is what transcribing looks
like — which is how a patient retyper working from an AI draft is caught despite
typing every character by hand.

Variance is used rather than pause-detection because each burst timestamp marks its
*start*, so the interval between bursts bundles typing time together with the pause
after it. The two cannot be separated without knowing the writer's true in-burst
speed. Variance needs no such assumption.

### Short-piece exemption

Pieces under 150 words are exempt from pace judgement entirely; the exemption phases
out by 400 words. Nobody spreads a discussion post across three days.

---

## 3. Temporal distribution — 20%

*Over what shape of time?*

```
spread = 60
       + 25 × (short-piece allowance)
       + 12 × min(2, sessions − 1)
       + 14 × min(2, edit days − 1)
```

A single sitting starts at 60. That is normal and is **not** an accusation — it
simply shows less of the process than work picked back up later.

### Active-vs-total ratio — 35% of the dimension

| Active ÷ total time | Score |
|---|---|
| ≤ 70% | 100 |
| 95% | 70 |
| 100% | 60 |

A student might have a document open for 3 hours but only be actively writing for
45 minutes. That gap is the *human* pattern — reading, thinking, staring. A session
where every recorded second was spent typing scores **worse**, not better. Only
applied when total time is at least 10 minutes.

---

## Text we never saw

*Not a dimension. It registers where it belongs.*

Some documents were already partly written before Human Ink started watching. That
is a gap in the record, not a finding — and it used to get its own 10% dimension,
which was the wrong shape for it: a document either has that gap or it doesn't, so
the measure sat at 100 for nearly everyone and quietly handed out a flat bonus.

Unobserved text now acts on the two dimensions it actually bears on:

- **Revision density scales down** when less than 25% of the finished document was
  typed in front of us. Revision behaviour genuinely cannot be read from text we
  never watched being typed. (This is the *observation factor* above — and note it
  is not a paste penalty; pasted text counts as observed, because we saw it arrive.)
- **Pace is measured over the observed words only** when Google's changelog
  independently accounts for the rest.

Coverage is still computed, still disclosed beside the score, and still never
judged on its own.

### The Google Docs allowance

Where Google's own revision history shows the document being built across days we
never saw, **and** shows no single insertion large enough to be a finished draft,
the unobserved text is accounted for by a log the writer does not control. Pace is
then measured only over the words that appeared in our window.

Both conditions are required. A student who pastes an essay before installing the
extension and then edits it for days still leaves Google's fingerprint on the
insertion, and the allowance is refused.

---

## The velocity ceiling

```
if velocity < 60:  score ≤ 50 + velocity ÷ 2
```

A strong revision record cannot outvote a composition pace no person could produce.
Without this, "paste the essay, then revise for twenty minutes" would pass.

---

## Pasting is tracked in full, and never penalized

**Not at all, in any amount.** There are too many honest reasons to paste: quoting a
source, pulling in your own notes, moving a paragraph, recovering a draft off your
phone. Penalizing the paste itself punished ordinary research writing and taught
students to retype quotations by hand.

Every pasted character is still counted, disclosed beside the score, and broken down
by origin — moved within the document, quoted from a cited source, or pasted from
outside — because a professor should see it.

It just never subtracts. And it cannot hide anything either: pasted text arrives
instantly, so it adds length without adding writing time, revision, or bursts. An
essay that arrived whole has no process to show, which the first three dimensions
register on their own.

> A student who pastes three quotations into an essay they spent an hour on still
> has an hour of writing time, an hour of revision, and loses nothing at all for the
> pasting.

---

## Length is not quality

Every length-sensitive measure is normalised against the finished word count rather
than rewarding raw volume. Slightly shorter essays tend to score better than very
long ones, and a big word count is not itself evidence of anything.

---

## Calibration

25 named scenarios, scored end to end. Green ≥ 80, red < 70.

| Score | Band | Rev | Vel | Tmp | Case |
|---:|:--|---:|---:|---:|:--|
| 93 | 🟢 | 100 | 96 | 71 | Honest 1,000-word essay, one focused afternoon (22 w/min) |
| 93 | 🟢 | 100 | 96 | 70 | Fast, fluent writer — same essay in 25 min (40 w/min) |
| 90 | 🟢 | 100 | 85 | 73 | Very fast writer, knew exactly what to say (63 w/min) |
| 93 | 🟢 | 100 | 96 | 72 | 1,000 words + 300 words of pasted block quotes |
| 99 | 🟢 | 100 | 96 | 99 | Research paper: half of it pasted in from own notes |
| 99 | 🟢 | 100 | 96 | 100 | 3,000-word paper across 4 days, heavy revising |
| 94 | 🟢 | 100 | 97 | 77 | Short 300-word reading response, 11 minutes |
| 94 | 🟢 | 93 | 100 | 85 | Very short 120-word discussion post, 4 minutes |
| 85 | 🟢 | 100 | 68 | 74 | Researcher: 1,500 words, 18 min active but 2.5 hrs in the doc |
| 96 | 🟢 | 100 | 87 | 100 | Thinker: short bursts, 2,000 words, 35 active / 3 hrs, 4 days |
| 92 | 🟢 | 100 | 94 | 71 | Lab report, 700 words, mostly pasted data tables, 25 min |
| 81 | 🟢 | 77 | 100 | 60 | Legacy payload: no text, no length, 35 min recorded |
| 77 | 🟡 | 69 | 96 | 68 | Clean typist: 1,000 words, 30 min, barely any deletions |
| 77 | 🟡 | 100 | 55 | 73 | 1,000 words in 10 active minutes (100 w/min) |
| 73 | 🟡 | 100 | 45 | 99 | 1,000 words in 8 min, across 3 sittings on 2 days |
| 72 | 🟡 | 49 | 100 | 90 | Installed late — Google history shows 4 edit days |
| 62 | 🔴 | 47 | 83 | 67 | Patient retyper: AI draft copied by hand over 50 min |
| 51 | 🔴 | 49 | 28 | 90 | Pasted AI off-camera, then edited over 4 days |
| 50 | 🔴 | 18 | 90 | 71 | AI essay pasted, then 20 min of aggressive fiddling |
| 44 | 🔴 | 41 | 28 | 72 | 1,060-word draft pasted in, 140 words typed around it |
| 42 | 🔴 | 39 | 28 | 72 | Installed late, no Google history available |
| 41 | 🔴 | 47 | 20 | 60 | Retyped from an AI draft: no deletions, 166 w/min |
| 29 | 🔴 | 12 | 30 | 70 | 2,500-word paper produced in 15 active minutes |
| 26 | 🔴 | 8 | 28 | 68 | AI essay pasted as 6 chunks over 9 min |
| 14 | 🔴 | 5 | 0 | 60 | ChatGPT essay pasted in whole, published 3 min later |

Two rows are worth reading together:

- **"Pasted AI off-camera, then edited over 4 days" — 51.** The student pasted the
  essay before installing, then edited for days so the changelog would show
  multi-day work. Google's record of the 6,700-character insertion refuses the
  allowance. The otherwise identical honest case scores **72**.
- **"AI essay pasted, then 20 min of aggressive fiddling" — 50.** Clicking around
  as hard as a real reviser does not rescue it, because there is no typing to read.

The one known false flag is the **clean typist** at 77 — a 1,000-word essay with
roughly twenty deletions in it. Nothing about the piece is wrong; the writer simply
leaves almost no trace of composing, and 55% of the heaviest dimension reads exactly
that trace. It lands in yellow, which is a second look rather than an accusation.
That is the direct price of putting half the weight on revision density, and it is
the deliberate trade: the same floor is what catches both retypers below.

---

## What is measured, and what is never recorded

Captured, shipped, and scored: keystroke and backspace counts, active/total time,
distinct days and sessions, typing bursts and their timestamps, paste counts and
sizes, word count, content hash.

Captured, shown, **not** scored: paste provenance, tracking-off windows, per-day
activity.

Captured but **never leaves the browser**: individual key identities, keystroke
timing biometrics, hidden-tab intervals, mouse and scroll heartbeats.

**Never captured**: cursor position, caret offsets, selection contents, what was
typed, which application the writer switched to. The non-linear-editing signal
records only *that* the caret moved before a burst — never where.
