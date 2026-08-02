# Footer animation prototypes

Four candidate animation systems for `extensions/harness-footer.ts`, each
rendered live in all four reckoner themes against one scripted 26-second
session: idle → turn start → streaming → tool → step lands → verify goes red →
tool → step lands → compaction → idle.

## Run them

```bash
cd packages/reckoner
npx tsx prototypes/proto-1-phosphor.ts     # ctrl-c to quit
npx tsx prototypes/proto-2-raster.ts
npx tsx prototypes/proto-3-tape.ts
npx tsx prototypes/proto-4-instrument.ts
```

Watch a full loop of each (26s). The caption line underneath tells you what the
simulated session is doing, so you can tell whether the motion is tracking
something real or just filling time.

`--frames N` renders N frames and exits, for scripted checks.

## The four

| | prototype | the move | best at | worst at |
|---|---|---|---|---|
| 1 | **phosphor decay** | nothing loops; events strike a cell to peak and it decays down the ladder | a genuinely silent idle screen; uses the theme ladder as designed | can't distinguish "working" from "wedged" — both are still |
| 2 | **raster sweep** | a bright cell sweeps the ink once per pass while working; words teletype in | the sweep rhythm reads as "machine is turning over" | a travelling highlight is the loudest thing on screen |
| 3 | **paper tape** | the left field advances one frame per token chunk — speed *is* generation speed | it's telemetry, not decoration: you feel a stall before text stops | irregularity can read as broken rather than alive |
| 4 | **instrument panel** | needles settle, cost digits roll, sediment falls on compaction | makes compaction visible for the first time | loudest of the four; two moving things in one field |

## What they all share (independent of which wins)

These are fixes to the current footer, applied in every prototype so they
don't confound the comparison:

- **Fixed-width slots.** Trail is always 8 cells, well always 6, cost padded to
  6 columns. Today the trail is `Math.min(total, 8)`, so its width changes with
  task size and drags the whole left side.
- **Two-tier separators.** One space inside a group, ` ⠄ ` (3 cols) between
  groups. Today every gap is `  ⠄  ` (5 cols), so nothing reads as grouped.
- **The lead cell is separated by space, not by the fleck.** An idle lamp and a
  separator must never be the same glyph in the same row.
- **A degradation ladder** (`fitRight`) instead of all-or-nothing: cost, then
  model, then session name fall away as the terminal narrows; the well is last
  to go. Today the entire right side vanishes at once.
- **Derived, not accumulated animation state.** Frames are a pure function of
  time-since-event, so a re-render can't advance an animation and the phase
  can't reset. Today `tick` lives inside the footer factory and `refresh()` on
  `turn_end` rebuilds the factory — so the 3s drop cycle restarts every turn.

## Picking

They are not mutually exclusive. A plausible final system is **1 + 4's
compaction settle**: still by default, decay on events, plus the one looping
animation that earns its keep (sediment falling during compaction). 3's tape is
the only one that adds information rather than polish — it's the pick if you
want the footer to tell you something the transcript can't.
