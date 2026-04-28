---
description: Cut a new release — bump version in three places, update CHANGELOG, run all checks, commit, push, open PR, merge.
argument-hint: "<patch|minor|major>"
disable-model-invocation: true
---

Cut a new release. Bump type: **$ARGUMENTS** (patch / minor / major)

This is a side-effect command — it commits, pushes, opens a PR, and merges
to main. Confirm with the user before running each git command.

---

## 1. Determine the new version

Read `manifest.json` for the current version. Apply the bump:
- `patch` — `5.4.9` → `5.4.10`
- `minor` — `5.4.9` → `5.5.0`
- `major` — `5.4.9` → `6.0.0`

Tell the user "I'm cutting `<old> → <new>`. Confirm to proceed?" and wait
for their reply.

## 2. Bump the three version locations

The version lives in **three places** that must stay in sync (the
`Version-stamp sync` CI check enforces this):

1. `manifest.json` — `"version": "<new>"`
2. `background.js` — the `console.info('[ProductCopier] background.js
   build <new> (...)')` line near the top. Update the version AND the
   short description in parens to a one-liner about what's new.
3. `content_copy.js` — same shape: `[ProductCopier] content_copy.js
   build <new> (...)`. Update both the version and the description.

## 3. Add a CHANGELOG entry

Open `CHANGELOG.md`. At the top under the placeholder, insert:

```
## [<new>] — <YYYY-MM-DD today's date>

### Added / Changed / Fixed
- <user-facing one-liner per item>
```

Ask the user "What goes in this CHANGELOG entry? Give me 1-3 bullet
points describing what changed." Use their answer.

## 4. Run the full check pipeline

```
npm run check
```

This runs syntax + lint + version-stamp sync. All three MUST pass
locally. If any fails, fix it before continuing.

## 5. Commit + push + PR

If the user is on the `main` branch (most common case in this repo):

```
git add manifest.json background.js content_copy.js CHANGELOG.md
git commit -m "<commit message following Conventional Commits>"
git push origin main:staging
gh pr create --base main --head staging \
  --title "<title>" \
  --body "<body that lists the CHANGELOG bullets>"
```

The commit message should follow Conventional Commits:
- `feat: <one-line summary>` for new features
- `fix: <one-line summary>` for bug fixes
- Body explains the *why*, not the *what*

## 6. Wait for CI green, then merge

```
sleep 15 && gh pr checks <PR#>
```

All four checks (Syntax, Lint, Version-stamp sync, Manifest validity)
must show `pass`. If any fail, the merge will be blocked by branch
protection.

Once green:

```
gh pr merge <PR#> --merge --delete-branch=false
```

## 7. Tell the user

Report:
- The new version on `main`
- The merge commit SHA
- The PR URL for their record
- A reminder to **reload the extension card** in their Chrome so they
  pick up the new build

## Failure modes

- **CI fails on `Version-stamp sync`** — one of the three locations
  drifted. Re-check `manifest.json` vs the two build stamps.
- **CI fails on `Lint`** — run `npm run lint` locally and fix the issues
  before pushing again.
- **PR merge blocked by branch protection** — usually means CI hasn't
  finished. Wait and retry.
