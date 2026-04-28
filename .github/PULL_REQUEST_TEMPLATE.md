## Summary
<!-- 1–3 bullets describing what this PR changes and why -->

## Test plan
<!-- Verify before merging -->
- [ ] All 5 JS files pass `node --check` (`for f in background.js content_copy.js popup.js options.js paste_salla.js; do node --check "$f"; done`)
- [ ] Loaded the extension from this folder in `chrome://extensions` (Developer mode → Load unpacked)
- [ ] `chrome://extensions` shows the new version under the extension name
- [ ] Service-worker console (Inspect views: service worker) shows the matching `[ProductCopier] background.js build X.Y.Z (...)` build stamp
- [ ] If `content_copy.js` was changed: page console on a real product page shows the matching `[ProductCopier] content_copy.js build X.Y.Z (...)` line
- [ ] Manual COPY on at least one of the live-tested sites in `HANDOFF.md` § 8 produces a clean `window.__copiedProduct` (title, ≥ 1 image, non-empty description)
- [ ] Manual PASTE into a Salla product form fills title, description, and at least one image

## Version bump
<!-- Bumped manifest.json + both build stamps. Confirm the three are identical: -->
- [ ] `manifest.json` `version`
- [ ] `background.js` build stamp
- [ ] `content_copy.js` build stamp

## Docs
- [ ] Added a `CHANGELOG.md` entry under the new version
- [ ] If invariants in `CLAUDE.md` changed, updated that section
- [ ] If file layout / cross-file conventions changed, updated `HANDOFF.md`
