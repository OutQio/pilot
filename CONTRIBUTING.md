# Contributing

These rules are **enforced** — by GitHub branch protection on `main`, by the
CI pipeline, and by code review. Read them once and follow them every time.

> If you're using [Claude Code](https://claude.com/claude-code), the
> repo's [`CLAUDE.md`](./CLAUDE.md) auto-loads as project memory and
> includes a condensed version of these rules.

---

## 1. Branching model

| Branch | Purpose | Who can push |
|---|---|---|
| `main` | Stable. What gets loaded in Chrome by the data-entry team. | **Nobody directly.** PRs only. |
| `staging` | Pre-merge integration. Mirrors what's about to land on main. | PR-only as well. |
| `feat/*`, `fix/*`, `docs/*`, `chore/*` | Topic branches for any work | Whoever's doing the work |

### Rules
- **Never `git push origin main` directly.** Branch protection blocks it; if
  you somehow get past, you're rewriting other people's work.
- **Never `git push --force` to `main` or `staging`.** Same reason. If you
  need to amend something already pushed, open a new PR with the fix.
- **Never `git rebase` or `git commit --amend` on commits already pushed
  to a shared branch.** Same reason.
- **One topic per PR.** Don't bundle "fix Amazon scraping" with "rewrite the
  README" — review-ability matters.

### Branch naming
| Prefix | When to use |
|---|---|
| `feat/<thing>` | New feature surface (e.g. `feat/aliexpress-scraper`) |
| `fix/<thing>` | Bug fix (e.g. `fix/exif-orientation`) |
| `docs/<thing>` | Documentation only |
| `chore/<thing>` | Dependency bumps, repo plumbing |
| `refactor/<thing>` | Code shape change with no behaviour change |

---

## 2. Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/) style.
The first line is the **summary** (under 72 chars). Body is optional but
expected for non-trivial commits — explains the *why*, not the *what*.

```
<type>: <short summary in present tense, no trailing period>

<one or more paragraphs explaining motivation, alternatives considered,
and any non-obvious decisions. Reference issues with #123.>
```

| Type | When |
|---|---|
| `feat` | New user-facing capability |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code shape change with no behaviour change |
| `chore` | Dependency / repo plumbing |
| `test` | Test-only changes |
| `perf` | Performance improvement |

Don't write commits like `wip`, `update`, `stuff`, or `final`. Each commit
in `main` is part of the project's permanent record.

---

## 3. Required pre-merge checks

CI runs these on every PR. They must all pass:

1. **Syntax** — `node --check` on every JS file
2. **Lint** — `eslint .` against the flat config in `eslint.config.js`
3. **Version-stamp sync** — `manifest.json` `version` must match both
   `console.info('[ProductCopier] background.js build X.Y.Z (...)')`
   and `[ProductCopier] content_copy.js build X.Y.Z (...)`. Drift is the
   #1 cause of "the user sees a stale build" reports — keep them in sync.
4. **Manifest validity** — `manifest.json` must parse as JSON.

You can run the full battery locally with `npm run check`.

---

## 4. Version bumping (the one rule everyone forgets)

When your PR ships a user-facing change, bump the version in **three** places
in the same commit:

| File | Where |
|---|---|
| `manifest.json` | `"version": "X.Y.Z"` |
| `background.js` | The `console.info('[ProductCopier] background.js build X.Y.Z (...)')` line near the top |
| `content_copy.js` | The `console.info('[ProductCopier] content_copy.js build X.Y.Z (...)')` line near the top |

The CI's `versions` job will fail the PR if any of the three drifts.

### Choosing the bump
- `5.4.9 → 5.4.10` — fixes, small UX tweaks, additional site support
- `5.4.x → 5.5.0` — new feature surface, breaking UX change behind a flag
- `5.x.x → 6.0.0` — breaking architectural change

Add a matching entry to [`CHANGELOG.md`](./CHANGELOG.md) in the same commit.

---

## 5. Local development

```bash
git clone https://github.com/OutQio/pilot.git
cd pilot
npm install                   # installs eslint + globals as dev deps
npm run check                 # syntax + lint + version-stamp sync
```

Then load the unpacked extension at `chrome://extensions` (Developer mode).
Code → reload extension card → verify the new build stamp appears in the
service-worker console.

### Testing your changes
There's no formal test suite. Three live workflows:

1. **DOM scraper smoke test** — visit a real product page from one of the
   sites in [`HANDOFF.md` § 8](./HANDOFF.md#8-site-specific-notes-from-live-testing)
   and verify `window.__copiedProduct` after running `content_copy.js`.
2. **Rewrite quality test** — save iblackstores rules in Options, copy a
   product, paste with rewrite toggle on, verify the resulting Salla form.
3. **Image normalisation visual test** — after paste, download the WebP
   files and visually verify the cover is centred / sized correctly and
   gallery images aren't distorted.

---

## 6. PR opening checklist

Use the template at `.github/PULL_REQUEST_TEMPLATE.md` (auto-populates when
you open a PR). Before requesting review, confirm:

- [ ] CI is green (all four jobs)
- [ ] You ran the relevant manual smoke test from § 5
- [ ] You bumped the version in three places + added a `CHANGELOG.md` entry
- [ ] If invariants in `CLAUDE.md` changed, you updated that section
- [ ] If file layout / cross-file conventions changed, you updated `HANDOFF.md`
- [ ] Sensitive material (API keys, tokens) is NOT in any commit

---

## 7. Sensitive material

- The Gemini API key (`AIza...`) belongs in `chrome.storage.local` at runtime
  and the `x-goog-api-key` HTTP header on the wire — **never** hardcoded,
  logged, or committed.
- `.claude/` (Claude Code worktree state) is `.gitignore`d. Never `git add` it.
- See [`SECURITY.md`](./SECURITY.md) for vulnerability reporting.

---

## 8. What "well-documented change" looks like

Three small things that make a PR pleasant to review and easy to revert:

1. **Comments explain the WHY.** Don't add `// add 1 to x`. Add a comment
   only when a future reader would otherwise be confused (Stencil
   descriptor walks, JSON-LD edge cases, EXIF rotation handling). Lead with
   the question the comment answers ("Why a separate function from X?"),
   then answer it.
2. **CHANGELOG entry.** One sentence is enough for fixes. Three for
   features. Anchor it to the version you're shipping.
3. **PR description.** Copy the template. Include the manual test you ran
   so reviewers can re-run it.

Match the existing tone — see `paste_salla.js` and `background.js` for the
standard.
