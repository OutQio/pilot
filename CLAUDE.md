# CLAUDE.md

Project memory for Claude Code. **Read this first.**

For deep architectural detail, defer to [`HANDOFF.md`](./HANDOFF.md). This file is the
fast-loading summary of what to know before touching code.

---

## What this is

Chrome MV3 extension `Product Copier → Salla (AI)`. Scrapes a product from any
e-commerce page → optionally rewrites the title + description in Arabic via
Gemini → pastes into Salla's `Add Product` form (handles Stencil custom
elements, Quill editor, FilePond uploader). Cover image is auto-formatted to
the store's brand template (square, white, centred, WebP); gallery images
keep their original framing but are also re-encoded as WebP.

---

## File map (everything is at the repo root — flat layout)

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest; **`version` is the source of truth — bump when you ship** |
| `background.js` | Service worker. Message router (`fetchImages`, `aiExtract`, `aiRewrite`, `fetchDescriptionImages`), Gemini calls, image normaliser + WebP re-encoder (OffscreenCanvas), tolerant Gemini JSON parser. |
| `content_copy.js` | In-page DOM scraper, runs on the source product page. Has site-specific paths for Salla, Shopify, WooCommerce, Magento, BigCommerce, Amazon (incl. amazon.sa via `#imageBlock` whole-HTML scan + thumbnail-ID synthesis), eBay, plus a generic 5-layer fallback chain. |
| `paste_salla.js` | In-page Salla form filler. Three custom elements to handle: `<s-input>` (Stencil descriptor walk), `<s-editor>` (Quill via `ClipboardEvent`), `<s-uploader>` (shadow-DOM pierce + DataTransfer). |
| `popup.{html,js,css}` | Popup UI. Step 1 COPY (DOM only) + Step 2 PASTE (with optional rewrite toggle). |
| `options.{html,js,css}` | Settings page. Gemini key, rewrite rules + examples, performance toggles. |
| `icons/` | 48 + 128 px PNGs for the toolbar / chrome://extensions card. |
| `HANDOFF.md` | Long-form architectural doc — pick this up cold. |
| `CHANGELOG.md` | Version-by-version changes. |
| `README.md` | User-facing landing page (install + usage). |

---

## Invariants — preserve these unless explicitly asked to change them

1. **`manifest.json` version, `background.js` build stamp, and `content_copy.js`
   build stamp must stay in sync.** Bump all three together when shipping a change.
   The build stamps are `console.info('[ProductCopier] <file> build X.Y.Z (...)')`
   lines at the top of each file. They're how the user diagnoses
   service-worker staleness in the SW console.
2. **`GEMINI_MODEL` constant lives in TWO files** (`background.js` and
   `options.js`) and **must stay identical**. The comment above each occurrence
   says so. If you change the model, change both.
3. **Cover image (#1) gets full normalisation. Gallery images (#2..N) get
   only WebP re-encoding (no crop, no resize beyond a 2000 px dim cap).** This
   is enforced in `fetchImagesBatched` via `normalize && (i + j) === 0`. Don't
   regress this — full normalisation on lifestyle / detail shots destroys them.
4. **Copy step must NOT call Gemini.** Copy is DOM-only. Gemini was removed
   from copy in v5.3.0 because it hallucinates Amazon image URLs. Rewrite is
   strictly a paste-time decision via the popup toggle.
5. **API key goes in the `x-goog-api-key` header, never in the URL query
   string.** Same for both the test endpoint (`options.js`) and the live
   call (`background.js`).
6. **Generation config requires both `responseMimeType: "application/json"`
   AND `thinkingConfig.thinkingBudget: 0`** on every Gemini call. Without
   `thinkingBudget: 0`, Gemini 2.5+ Flash silently consumes `maxOutputTokens`
   on hidden chain-of-thought before producing visible text — and the user
   gets `MAX_TOKENS` with empty body.
7. **Gemini JSON parsing always goes through `parseGeminiJson` (never raw
   `JSON.parse`).** It tolerates trailing prose, concatenated objects,
   markdown fences, and braces-in-strings — all real failure modes seen in
   the wild.
8. **`paste_salla.js` is self-contained.** It runs in the page world via
   `chrome.scripting.executeScript({ files: ['paste_salla.js'] })` — no
   imports, no popup-scope references. Don't introduce ES modules here.
9. **`content_copy.js` writes to `window.__copiedProduct`** in the isolated
   world (default for `chrome.scripting.executeScript`). The popup reads it
   back via a separate `executeScript` call. Don't change the global name
   without updating the popup reader too.
10. **Output filenames are `product-N.<ext>`** where `<ext>` comes from
    `mimeToExt(mimeType)`. Salla's uploader doesn't validate extensions
    strictly, but consistency matters for the data-entry team.

---

## Common tasks

### Bump the version
1. Edit `version` in `manifest.json`
2. Update build stamp in `background.js` (line near `console.info('[ProductCopier] background.js build ...`)
3. Update build stamp in `content_copy.js` (line near `console.info('[ProductCopier] content_copy.js build ...`)
4. Run `node --check` on every JS file
5. Tell the user to reload the extension card and verify the build stamp in
   the SW console

### Tune the cover image framing
- All knobs are in `IMAGE_NORMALIZE_DEFAULTS` at the top of `background.js`:
  `size`, `paddingPct`, `bg`, `format`, `quality`, `bgThreshold`, `alphaThreshold`.
- The 2000 px dim cap for gallery images is `REENCODE_MAX_DIM` (separate
  constant near `reencodeAsWebP`).
- Keep the same `quality` (0.92) for cover and gallery so files look
  consistent.

### Add support for a new e-commerce platform
- Add CSS selectors to one or more of: `TITLE_SELECTORS`, `DESCRIPTION_SELECTORS`,
  `GALLERY_SELECTORS` (top of `content_copy.js`).
- If the platform has a unique CDN URL pattern that the existing
  `computeImageBase` doesn't normalise, add a `.replace()` step there.
- If the platform serves images as JS state (like Amazon), consider a
  whole-HTML scan inside an `if (/platform\./i.test(location.hostname))`
  block — see the existing Amazon block (`#imageBlock_feature_div` scope)
  for the pattern.
- Test by running `content_copy.js` on a real product page and inspecting
  `window.__copiedProduct`.

### Change the rewrite prompt
- `buildRewriteOnlyPrompt` in `background.js` builds the paste-time prompt.
- It reads `rules.titleRules`, `rules.descRules`, `rules.examples` from
  storage. Don't break that contract — the options page writes those keys.
- Don't add the `images` field to the requested JSON shape. The DOM scraper
  handles images; Gemini is text-only at paste time.

### Add a new background message action
- Add a `case '<name>':` to the router in `background.js` (around line 35).
- Always `return true` so the channel stays open for async response.
- Always handle `.catch(e => sendResponse({ error: e.message }))`.
- Caller in `popup.js` should defensively guard against `ai === undefined`
  (happens when the SW is stale and silently drops unknown actions).

---

## Testing

There's no formal test suite. Three live workflows:

1. **DOM scraper smoke test.** Visit any product page from the
   `Site-specific notes` section of `HANDOFF.md`. Open DevTools console on
   that page. Run:
   ```js
   await fetch(chrome.runtime.getURL('content_copy.js')).then(r => r.text()).then(s => new Function(s)());
   console.log(window.__copiedProduct);
   ```
   Expect: clean title, ≥ 1 image URL, non-empty description.

2. **Rewrite quality test.** Save iblackstores rules + examples in Options.
   Copy a product, paste with rewrite toggle on. Verify in Salla form:
   title is `<brand-ar> - <type+spec> - <color>`, description has bold-
   title repeat → marketing intro → bullet list under "المميزات الرئيسية:"
   → optional spec list → closing paragraph under "ليش ممكن تشتريه؟", uses
   Khaleeji dialect markers.

3. **Image normalisation visual test.** After paste, download the WebP
   files Salla received. Cover image should be 1000×1000, white bg, product
   centred with ~150 px margin all around (15% of 1000). Gallery images
   should match the source dimensions (capped at 2000 px longest side).

For `node --check` syntax verification:
```bash
for f in background.js content_copy.js popup.js options.js paste_salla.js; do
  node --check "$f" && echo "✓ $f"
done
```

---

## Where things tend to break (symptom → cause → fix)

| Symptom | Cause | Fix |
|---|---|---|
| Paste fails with `Cannot read properties of undefined (reading 'title')` | Stale SW that doesn't know `aiRewrite` | Reload extension card; if no fix, toggle off/on at chrome://extensions |
| Build stamp in SW console shows wrong version after a code change | Chrome's MV3 service worker holding an old copy | Click the 🔄 reload icon on the extension card; if still stale, click "Inspect views: service worker" then click 🔄 in that DevTools window |
| Cover image too tiny / lots of whitespace | `paddingPct` set too high | Lower `IMAGE_NORMALIZE_DEFAULTS.paddingPct` in `background.js` |
| Gallery images sideways | EXIF orientation flag not honoured (regression of 5.4.9 fix) | Ensure `imageOrientation: 'from-image'` is in `createImageBitmap` options inside `reencodeAsWebP` |
| Image #2 is the same as image #1 | DOM scraper emitted same URL from two sources (e.g., `#landingImage` and `og:image`) | Ensure `urls = [...new Set(urls)]` is at the start of `fetchImagesBatched` |
| Amazon: only 1 image extracted | Stale build OR amazon.sa using a layout variant the `#imageBlock` selector list misses | Verify build stamp; otherwise add the missing container ID to the fallback chain in the Amazon extraction block of `content_copy.js` |
| `Gemini لم يُرجع JSON صالحاً` | Model returned an unusual shape `parseGeminiJson` couldn't recover | Check the SW console — `parseGeminiJson` logs the raw response (first 800 chars) for diagnosis. Add a strategy if needed. |

---

## Sensitive material — don't commit

- The user's Gemini API key (`AIza...`). It's stored at runtime in
  `chrome.storage.local.geminiKey` and only sent over the wire as the
  `x-goog-api-key` header. **Never hardcode it. Never log it. Never put it
  in tests, prompts, or commit messages.**
- `.claude/` directory holds Claude Code's per-machine worktree state.
  Already in `.gitignore`. Never `git add` it.

---

## Tone for code comments

This codebase has thoughtful inline comments that explain the WHY of
non-obvious code (Stencil descriptor walks, JSON-LD edge cases, etc.).
**Match this tone when adding code.** Don't add `// add 1 to x` — add
comments only when a future reader would otherwise be confused. Lead with
the question the comment answers ("Why a separate function from X?"),
then answer it. See `paste_salla.js` and `background.js` for the standard.
