# Changelog

All notable changes to this project. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning loosely follows [SemVer](https://semver.org/) — but since this is
an unpacked Chrome extension we bump pragmatically (patch for fixes, minor
for new features, major for breaking UX).

The current shipping version is at the top of [`manifest.json`](./manifest.json)
and echoed in the build stamps at the top of `background.js` and
`content_copy.js`. Both must stay in sync.

---

## [5.4.9] — 2026-04-27

### Fixed
- **Image #2 was the same as image #1, un-normalised.** DOM scrapers sometimes
  emit the same URL from multiple sources (e.g. `#landingImage` AND
  `og:image`). Added `urls = [...new Set(urls)]` at the start of
  `fetchImagesBatched`. SW console now logs `🧹 deduped N duplicate URL(s)
  before fetch` when it kicks in.
- **Gallery images came out distorted.** Hardened `reencodeAsWebP` with
  `imageOrientation: 'from-image'` (honour EXIF rotation),
  `premultiplyAlpha: 'none'` (preserve PNG transparency edges), and a 2000 px
  longest-side cap (avoids `OffscreenCanvas` memory issues on huge source
  photos).

## [5.4.8] — 2026-04-26

### Changed
- Gallery images (#2..N) are now **also re-encoded as WebP**, but at original
  dimensions and framing (no crop, no resize). Previously they passed through
  with the source format. Already-WebP sources still pass through untouched.

## [5.4.7] — 2026-04-26

### Changed
- **Image normalisation now applies only to the cover image (#1).** Gallery
  images preserve their original framing — important for detail shots,
  infographics, and lifestyle photography that shouldn't be auto-cropped.
- Cover-image margin set to 15% per side (≈ 70% product fill).

## [5.4.5] — [5.4.6] — 2026-04-26

### Changed
- Iterated on the cover-image margin while matching the iblackstores brand
  template: 10% → 5% → 15%.

## [5.4.4] — 2026-04-26

### Changed (and reverted in next minor)
- Mistakenly interpreted the brand template's 3×3 alignment grid as a hard
  cage and set padding to 33%. Resulting product was tiny on the canvas.
  Reverted in 5.4.5.

## [5.4.3] — 2026-04-26

### Changed
- Image normaliser now uses **height-fit** scaling (with width-clamp fallback
  for ultra-wide products) so every cover image shares the same top/bottom
  baseline in the listing grid. Previously was longest-side fit, which made
  product heights inconsistent.

## [5.4.2] — 2026-04-26

### Fixed
- **Gemini sometimes returns trailing prose after the JSON object**, breaking
  `JSON.parse(text)`. Added `parseGeminiJson` with a 3-strategy fallback:
  direct parse → brace-balanced extraction (find first complete `{...}`) →
  diagnostic log. Tested against 5 real failure modes (clean, trailing prose,
  concatenated objects, markdown fences, braces-in-strings).

## [5.4.1] — 2026-04-26

### Added
- Per-image normalisation diagnostic logs in the SW console (`🎨 normalised
  image #N: ...`).
- Rewrite outcome surfaced in the final paste status — silent rewrite
  failures can't hide behind a green "paste OK" message.

## [5.4.0] — 2026-04-26

### Added
- **Image normaliser.** Cover image gets auto-cropped (white/transparent
  edges removed), centred on a 1000×1000 white canvas, re-encoded as WebP at
  q=0.92. Implemented with `OffscreenCanvas` + `createImageBitmap` in the
  service worker. Knobs in `IMAGE_NORMALIZE_DEFAULTS` constant.
- Toggle in Options: **🎨 تطبيق نمط الصور (قص + مربع + WebP)** (default ON).

## [5.3.0] — 2026-04-25

### Changed (BREAKING UX)
- **Removed Gemini extraction from the COPY step.** Copy is now always
  DOM-only and instant — no API call burned per copy. AI was unreliable for
  images on Amazon (hallucinated CSS-sprite identifiers as URLs), and the
  user often wants to copy from several stores in a row before deciding
  whether to rewrite.
- **Added rewrite toggle to the PASTE card.** When ON, sends the
  already-extracted title + description (≈ 2 KB) to Gemini with the saved
  rules + examples — ~5x smaller prompt, ~3x faster than the old
  extract+rewrite-in-one-call path.
- New `aiRewrite` background action paired with `buildRewriteOnlyPrompt` in
  `background.js`, separate from the legacy `aiExtract`. Legacy path retained
  for backward compatibility during partial reloads.
- Removed obsolete "تفعيل Gemini عند توفر المفتاح" checkbox from Options.

## [5.2.1] — 2026-04-25

### Fixed
- **Amazon scan returning duplicate or unrelated images.** Scoped the
  whole-HTML scan to Amazon's `#imageBlock_feature_div` (or its variants)
  instead of the whole document, so colour swatches and "frequently bought
  together" tiles no longer leak into the gallery.

## [5.2.0] — 2026-04-25

### Added
- **Amazon whole-HTML scan + thumbnail-ID synthesis.** Amazon's image gallery
  is JS-driven (`#landingImage` mutates on hover, alt-angle thumbs are 40 px,
  ImageBlock data lives inside `<script>` tags with `\/`-escaped slashes).
  The scraper now walks the entire document HTML, regexes out every
  `https://*amazon*/images/I/<ID>` occurrence, and synthesises the bare
  full-size URL for each unique ID (`https://m.media-amazon.com/images/I/<ID>.jpg`).
  Recovers all alt-angle images on amazon.sa without simulating clicks.

## [5.1.0] — 2026-04-23

### Audit fixes from initial review
- Gemini API key sent via `x-goog-api-key` header (was URL query string,
  leaking to network history).
- `embedDescImages` rewrite now scopes to `<img src>` regex callback (no
  more substring collision when URLs share prefixes).
- `extractJSON` replaces the greedy `/\{[\s\S]*\}/` parser with a
  brace-balanced + string-aware walker.
- `isSallaTab` parses `URL.hostname` with strict suffix match — `evil.com/?ref=salla.sa` is now correctly blocked.
- `paste_salla.js` `success` now requires `imagesOk`; walks prototype chain
  for the Stencil descriptor (handles s-input subclasses).

### Universal scraper coverage
- Selectors for Shopify (Debut, Brooklyn, Dawn), WooCommerce, Magento 1+2,
  BigCommerce (Cornerstone), Amazon (`#feature-bullets`, `#aplus`),
  eBay (`#vi-desc-maincntr`).
- `<picture><source srcset>` parsing — picks highest-resolution descriptor.
- `srcset` on `<img>` parsed for highest descriptor (numeric `w`/`x`).
- Lazy-load attributes expanded: `data-large_image` (WC), `data-image-large`,
  `data-hi-res`, `data-thumb`, `data-srcset`. Checked in resolution-priority
  order (high-res → srcset → lazy → src).
- `imgSize` falls back to `width`/`height` attributes when `naturalWidth` is 0
  (lazy-loaded images no longer dropped).
- `pointsToOtherProduct`: universal heuristic that filters images wrapped in
  `<a>` links to other product pages (recommendation tiles).
- `urlQuality`-based dedup-and-upgrade: when two URLs share a dedup base,
  keep the better one (non-proxy wins, larger size wins).
- `decodeUrlEntities`: strips `&amp;`/`&quot;`/`&lt;` from URLs before
  processing (JSON-LD `<script>` content is raw text — JSON.parse won't
  decode entities even though they're almost always wrong inside a URL).
- `<picture>` support, microdata (`itemprop="image"`), `og:image:secure_url`
  / `twitter:image` fallbacks.
- E2E validated against 9 reachable live sites.

## [5.0.0] — 2026-04-23

### Added
- Initial release. Chrome MV3 extension. Copy + paste with optional Gemini
  AI extraction.

---

## Conventions

- **Bump the version in three places** when you ship a change: `manifest.json`
  `version`, the `console.info('[ProductCopier] background.js build X.Y.Z (...)')`
  line at the top of `background.js`, and the matching line at the top of
  `content_copy.js`. The build stamps are how staleness is diagnosed in the
  service-worker console.
- **Patch (5.4.x)** — bug fixes, small UX tweaks, additional site support.
- **Minor (5.x.0)** — new feature surface, breaking UX change behind a flag.
- **Major (x.0.0)** — breaking architectural change.
