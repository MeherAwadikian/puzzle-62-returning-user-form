# Puzzle #62 — Returning-user profile form

A multi-section profile form that **recognises returning users**. On a first
visit it is empty with no banner. Once you save a profile, the form remembers
you on this device (via `localStorage`) and on your next visit greets you by
name, tells you when you were last here and how many times you have visited,
pre-fills every field, and lets you continue, start a fresh form, or forget
your saved data entirely.

Live: https://meherawadikian.github.io/puzzle-62-returning-user-form/

## How it works

State lives in a single **versioned, structured** `localStorage` record under
`forge_profile_v2`:

```jsonc
{
  "schemaVersion": 2,
  "profile": { "name": "", "email": "", "company": "", "role": "",
               "contactTime": "", "interests": [], "newsletter": false },
  "meta":    { "firstVisit": 0, "lastVisit": 0, "visitCount": 0, "lastStep": 1 }
}
```

- **Recognition** is driven by `meta` (not just the presence of a value): a user
  is "returning" only if the record carries an identity (name or email) *and* a
  recorded visit. On a return visit the count is incremented and `lastVisit` is
  re-stamped, while the banner shows the *previous* visit time as "last here".
- **Continue vs start fresh**: "Continue" restores the saved values and jumps to
  the step you left on (`meta.lastStep`); "Start fresh" blanks the visible fields
  for this session **without** touching the saved record.
- **Forget**: both the banner's "Not you? Clear my info" and the footer's "Clear
  my saved data" hard-remove the key and return the page to first-visit state.

## Defensive storage

Every read is guarded. Corrupt JSON is caught, wiped, and reported ("we started
you fresh") rather than crashing the page. An older flat `forge_profile_v1` blob
(the puzzle #5 shape) is migrated forward into the v2 record and the old key is
removed, with an "we upgraded your saved details" notice. If `localStorage` is
unavailable entirely (private mode), the page behaves as a plain first visit.

## How this differs from puzzle #5 (cache-prefill)

Puzzle #5 stored a flat `{name, email, message}` blob and silently restored it on
reload. This build stores a structured, versioned record and uses its metadata to
**actively recognise** the user: a welcome-back banner with name, last-visit time
and visit count, a continue-vs-start-fresh choice, a working forget control, and
graceful migration/reset of old or corrupt data.

## Files

- `index.html` — markup (banner, 2-step form, footer privacy control)
- `styles.css` — styling
- `app.js` — the storage layer, recognition logic, and event wiring

No build step. Open `index.html` or serve the folder statically.
