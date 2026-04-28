# HANDOFF — Product Copier → Salla (Chrome extension)

Pick this up cold. Everything you need to be productive on day one.

---

## 1. What this is

A Chrome MV3 extension (`Product Copier → Salla (AI)`) used by the Black Stores
(`iblackstores.com`) data-entry team to onboard products to their Salla store
end-to-end:

1. Scrape product data (title, description, images) from any e-commerce page
2. Optionally rewrite the title + description in Arabic, in the store's voice,
   using Gemini + saved style rules
3. Auto-format the cover image to the store's brand template (square, white,
   centred, WebP) and convert all gallery images to WebP
4. Paste everything into Salla's `Add Product` form (handles Stencil custom
   elements, Quill editor, and FilePond uploader)

**Current version:** 5.4.9 (see `manifest.json`).

---

## 2. Repo layout

```
/Users/qasimmohammed/Documents/Vibe/Pilot/      ← live extension folder
├── manifest.json                                  Chrome MV3 manifest, version
├── background.js                                  service worker
│                                                  - message router (fetchImages,
│                                                    aiExtract, aiRewrite,
│                                                    fetchDescriptionImages)
│                                                  - Gemini calls (extract +
│                                                    rewrite prompts)
│                                                  - image normaliser + WebP
│                                                    re-encoder (OffscreenCanvas)
│                                                  - tolerant Gemini JSON parser
├── content_copy.js                                in-page DOM scraper, runs on
│                                                  the source product page.
│                                                  Universal — handles Salla,
│                                                  Shopify, WooCommerce, Magento,
│                                                  BigCommerce, Amazon (incl.
│                                                  amazon.sa via #imageBlock
│                                                  whole-HTML scan + thumbnail-
│                                                  ID synthesis), eBay (s-l size
│                                                  dedup), Allbirds (recommend.
│                                                  carousel filter), Jarir
│                                                  (cdn-cgi proxy), Carrefour
│                                                  KSA, Lulu, Hnak, Jomla
├── paste_salla.js                                 in-page Salla form filler.
│                                                  - <s-input> via Stencil
│                                                    descriptor walk
│                                                  - <s-editor> Quill via
│                                                    ClipboardEvent + RTL
│                                                    pre-injection
│                                                  - <s-uploader> shadow-DOM
│                                                    pierce + DataTransfer
├── popup.html / popup.js / popup.css              extension popup UI:
│                                                  - Step 1 COPY (DOM only)
│                                                  - Step 2 PASTE (optional
│                                                    rewrite toggle)
├── options.html / options.js / options.css        settings page:
│                                                  - Gemini API key + test btn
│                                                  - Rewrite rules (title,
│                                                    description, examples)
│                                                  - Performance toggles
│                                                    (embed desc images,
│                                                    normalise images, image
│                                                    limit slider)
├── icons/icon48.png, icons/icon128.png            extension icons
├── README.md                                      basic project intro
└── HANDOFF.md                                     ← this file
```

The repo is at https://github.com/OutQio/pilot (branch `main`).
Working git history is in this folder; commits land on `main` via PRs from a
`staging` branch.

---

## 3. Setup (any new machine)

1. `chrome://extensions` → enable **Developer mode** (top right)
2. **Load unpacked** → select **`/Users/qasimmohammed/Documents/Vibe/Pilot/`**
   - Loading from anywhere else (e.g. an unzipped older ZIP) means edits won't
     take effect — always load this folder.
3. Click the extension icon → **Options** (gear) → paste a Gemini API key
   (get one at https://aistudio.google.com/app/apikey, starts with `AIza...`)
   → click **اختبار** to verify
4. In Options, paste the rewrite rules + examples (saved style guide for the
   store; iblackstores' specific rules are documented in chat — re-derive
   from product samples on iblackstores.com if missing)
5. Reload the extension in `chrome://extensions` after any code change
   - Service worker may go stale; click **Inspect views: service worker** to
     confirm the latest build stamp prints in console
   - Build stamps look like:
     `[ProductCopier] background.js build 5.4.9 (...)`
     `[ProductCopier] content_copy.js build 5.4.9 (...)`

---

## 4. Day-to-day workflow

### Copy step
1. Open any product page (Amazon, AliExpress, Shopify store, Salla store, etc.)
2. Click extension icon → **نسخ من هذه الصفحة**
3. Popup confirms `✅ تم النسخ` with image count + description status
4. **No Gemini call happens here** — purely DOM extraction. Fast and reliable.

### Paste step
1. Open `https://s.salla.sa/products/new` (must be on a Salla domain)
2. Open extension popup. The PASTE card has a toggle:
   **`✍️ إعادة كتابة بأسلوب متجرك`**
   - Disabled (greyed) if no Gemini key OR no rewrite rules saved.
   - Default-on when both exist (and `rewriteRules.enabled !== false`).
3. Click **لصق البيانات في سلة**
4. Flow:
   1. (If toggle on) Send title+description to Gemini with rewrite rules
      → ~3-4s call, returns Arabic version in store's voice
   2. Fetch each image URL → normalise cover to brand template +
      re-encode gallery as WebP → batch into base64
   3. Inject `paste_salla.js` and call `pasteIntoSalla(title, desc, images)`
5. Status surface always shows the rewrite outcome (`✍️ تم تطبيق إعادة الكتابة`,
   `⚠️ لم تتم إعادة الكتابة: <reason>`, or omitted if skipped) so silent
   failures can't hide.

### Console diagnostics
Filter the **service worker console** by `ProductCopier` to see (per paste):
```
[ProductCopier] rewrite request: {hasKey: true, rulesEnabled: true, ...}
[ProductCopier] rewrite OK — new title: "بيلكن - شاحن لاسلكي ..."
[ProductCopier] 🧹 deduped 1 duplicate URL(s) before fetch
[ProductCopier] 📥 fetching 5 image(s), normalize-first=true
[ProductCopier] 🎨 normalised image #1: 1500×1500 jpeg (180 KB) → 1000×1000 webp (44 KB), crop 1240×1180, draw 700×667 (height-fit), found=true, 142ms
[ProductCopier] 📷 reencoded image #2: 1200×800 jpeg (95 KB) → 1200×800 webp (28 KB), 67ms
[ProductCopier] ✅ batch done: 5/5 ok, ~180 KB total, format=webp, 720ms
```

---

## 5. Image-handling rules (current)

| | Image #1 (cover) | Images #2..N (gallery) |
|---|---|---|
| Auto-crop white/transparent edges | ✅ | ❌ original kept |
| Square 1000×1000 white-bg canvas | ✅ | ❌ original dims (capped at 2000 px longest side) |
| 15% margin per side (~70% product fill) | ✅ | ❌ N/A |
| Re-encoded as WebP @ q=0.92 | ✅ | ✅ (skipped if source is already WebP) |
| EXIF orientation honoured | ✅ | ✅ |

Knobs in `IMAGE_NORMALIZE_DEFAULTS` at the top of `background.js`:
- `size: 1000` — output canvas edge in px
- `paddingPct: 15` — margin per side
- `bg: '#ffffff'` — background colour
- `format: 'image/webp'` — output mime
- `quality: 0.92` — WebP quality
- `bgThreshold: 240`, `alphaThreshold: 30` — what counts as "background" for auto-crop
- `REENCODE_MAX_DIM: 2000` — longest-side cap for gallery images (constant elsewhere in the file)

---

## 6. Gemini integration

### Model
- **Default:** `gemini-3-flash-preview` (preview status; warm latency ≈ 380ms,
  matches `gemini-2.5-flash` on quality)
- **Stable fallback:** `gemini-2.5-flash` — change `GEMINI_MODEL` in
  `background.js` AND `options.js` (must stay in sync)
- Both models support `responseMimeType: "application/json"` and
  `thinkingConfig.thinkingBudget: 0` — both are required for correct output:
  - `responseMimeType` makes Gemini emit a single JSON document (still occasionally
    has trailing prose — see "Tolerant JSON parser" below)
  - `thinkingBudget: 0` disables Gemini 2.5+ Flash's hidden chain-of-thought,
    which would otherwise eat the `maxOutputTokens` budget on internal reasoning

### Auth
API key is sent via `x-goog-api-key` header (NOT URL query string — that
leaks into network history). Same in both `background.js` and `options.js`.

### Tolerant JSON parser (`parseGeminiJson`, end of `background.js`)
Three-strategy fallback:
1. Try `JSON.parse(text)` directly — fast path
2. If that fails, walk braces (`extractJSON`) to find the FIRST balanced
   top-level `{...}` block, ignoring trailing prose / second JSON objects /
   stray characters. Parse that.
3. If still failing, log the raw response (first 800 chars) for diagnosis,
   throw a friendly Arabic error.

This was added because Gemini sometimes appends explanation prose after the
requested JSON, breaking the trust-the-whole-text shortcut.

### Two paths
- `aiExtract` (background.js → `aiExtractGemini`) — legacy path, kept so an
  older popup talking to a newer SW still works during a partial reload.
  Takes the entire page HTML (≈ 12 KB) and asks Gemini to extract title +
  description.
- **`aiRewrite` (background.js → `aiRewriteGemini`)** — current path, called
  from `popup.js` paste handler when the rewrite toggle is on. Takes the
  already-extracted title + description (≈ 2 KB) and asks Gemini to translate
  + rewrite in the store's voice, using saved rules + examples. ~5× smaller
  prompt than the legacy path, ~3× faster.

### Hybrid extraction (image hallucination guard)
The popup's `Copy` step is **always DOM-only** — Gemini was removed from
copy because it regularly hallucinates image URLs on Amazon (confuses
CSS-sprite identifiers like `11WsGYSItxL._RC|01DE6WSvLKL.css,...` for image
URLs). The DOM scraper handles all 9 live sites cleanly; the AI's only
useful job is text rewriting at paste time.

---

## 7. Rewrite rules + examples

Saved in `chrome.storage.local.rewriteRules`:
```js
{
  enabled    : true,
  titleRules : "...",
  descRules  : "...",
  examples   : "..."
}
```

iblackstores style summary:
- Title: `<البراند بالعربية> - <نوع المنتج + المواصفة الرئيسية> - <اللون>`
- Description: 4-5 sections — bold title repeat, marketing intro paragraph,
  bullet list under `المميزات الرئيسية:`, optional bullet list under
  `المواصفات التقنية:` ("key: value." format), closing paragraph under
  `ليش ممكن تشتريه؟`
- Tone: Saudi/Khaleeji colloquial (ليش, يبغى, اللي, تجي, تخليك, تقدر, عشان, وين)
- No emoji, no prices, no comparisons to other stores
- Tech terms transliterated to Arabic (تايب سي, أموليد, ماج سيف), but model
  numbers + standards stay English (Qi2, IP68, GTS 4 Mini, GPS, AMOLED)

If the user clears storage, re-derive the rules by sampling 3 product pages
from `iblackstores.com` (use any product link from the homepage).

---

## 8. Site-specific notes (from live testing)

| Site | Status | Notes |
|---|---|---|
| amazon.com / amazon.sa | ✅ | Whole-page HTML scan scoped to `#imageBlock_feature_div` for image IDs (handles all regional CDNs: m.media-amazon.com, images-na/eu/fe.ssl-images-amazon.com). Synthesises bare `<id>.jpg` URLs from each visible thumbnail's image ID — all 6 alt-angle images recovered without simulating clicks. |
| eBay | ✅ | `s-l<n>` size suffix dedup; eBay description in og:description fallback. |
| Allbirds (Shopify) | ✅ | Recommendation carousel filtered via `pointsToOtherProduct` (image inside `<a>` to a different product page). |
| Extra (KSA), Jarir, Carrefour KSA, Lulu, Hnak, Jomla | ✅ | All produce clean title + description + images. |
| Shopify generic | ✅ | `<picture><source srcset>` parsed; `_500x500` size suffix dedup. |
| WooCommerce | ✅ | `data-large_image` attribute supported; srcset highest-w wins. |
| AliExpress, Shein | ⚠️ | Anti-bot blocks them in headless browsers — works in real Chrome user session. |

The DOM scraper has 4 image-extraction layers (gallery selectors, JSON-LD,
microdata, full-page fallback) plus a 5th Amazon-specific path that scans
the `#imageBlock` container HTML for any `/images/I/<id>` pattern. URLs go
through `computeImageBase` for canonicalisation (host normalisation, size-
variant stripping, query-param dropping) and `urlQuality` to prefer non-
proxied originals over CDN-resized versions.

---

## 9. Known caveats

1. **Gemini 3-flash-preview is preview** — Google may rename/retire it. If
   it ever returns 404/410, swap to `gemini-2.5-flash` (one constant in two
   files). Build stamp tells you which model is loaded.
2. **Service worker staleness** — Chrome sometimes serves an old SW after a
   code change. Symptom: messages get `undefined` responses (e.g.,
   `aiRewrite` action unknown). Fix: click 🔄 reload on the extension card,
   then click "Inspect views: service worker" — if the build stamp is wrong,
   toggle the extension off/on at chrome://extensions to force a clean SW
   re-registration.
3. **Photoshop template** — The user has a brand template at
   `/Users/qasimmohammed/Desktop/مشروع جديد.psd` (3×3 alignment grid for
   rule-of-thirds). Image normaliser uses 15% margin (= ~70% product fill),
   not the literal centre cell of the grid. The grid is for *visual* alignment
   of features, not a hard cage.
4. **Wide products** — `paste_salla.js` height-fits products into the inner
   safe area. Ultra-wide products (e.g., soundbars, monitors) fall back to
   width-clamping, so their height ends up smaller than the standard
   baseline. This is rare (most e-commerce products are square or portrait).
5. **First-image dedup** — Some scrapes produce the same URL from multiple
   sources (e.g., `#landingImage` AND `og:image`). `fetchImagesBatched` runs
   `[...new Set(urls)]` before fetching to drop exact duplicates. Look for
   the `🧹 deduped N duplicate URL(s)` log line if image #2 looks suspicious.

---

## 10. Version history (recent → older)

| Ver | What changed |
|---|---|
| 5.4.9 | URL dedup before fetch; EXIF/alpha-safe WebP reencode; 2000 px cap on gallery images |
| 5.4.8 | Cover image normalised + 15% margin; gallery images re-encoded to WebP at original dims |
| 5.4.7 | Image normaliser → first-image only, 15% margin |
| 5.4.6 | 5% margin (too tight, replaced) |
| 5.4.5 | 10% margin (too wide, replaced) |
| 5.4.4 | Product fits in centre cell of 3×3 grid (33% padding — over-corrected, reverted) |
| 5.4.3 | Height-fit so all products share top/bottom baseline |
| 5.4.2 | Tolerant Gemini JSON parser (handles trailing prose) |
| 5.4.1 | Rewrite-status surfaced + per-image normalisation logs |
| 5.4.0 | Image normaliser → WebP, square white-bg |
| 5.3.0 | Rewrite moved to paste step (decoupled from copy); hybrid mode (DOM for images, AI for text) |
| 5.2.1 | Amazon scan scoped to `#imageBlock` |
| 5.2.0 | Amazon whole-HTML scan + thumbnail-ID synthesis |
| 5.1.0 | Audit fixes (header auth, embedDescImages dedup, isSallaTab, robust JSON parser) + universal scraper coverage across 9 live e-commerce sites |
| 5.0.0 | Initial commit |

The `manifest.json` version + the `console.info('[ProductCopier] ... build X.Y.Z (...)')`
lines at the top of `background.js` and `content_copy.js` are kept in sync —
bump all three when shipping a change so reload-staleness can be diagnosed
from the SW console.

---

## 11. Testing

E2E tests live (no formal test suite, but proven workflow):

1. **Live-site smoke test** — Use the playwright MCP (or a local Chrome with
   the extension loaded) to visit a product on each platform in
   `Site-specific notes` and inspect `window.__copiedProduct` after running
   `content_copy.js`. Look for clean title, ≥ 1 image, non-empty description.
2. **Rewrite quality test** — Set the iblackstores rules + examples in
   options. Copy a product, paste with rewrite toggle on, inspect the
   resulting Salla form. Pass if: title is `<brand> - <type+spec> - <color>`
   in Arabic, description has the 4 expected sections, dialect markers
   present, no emoji/prices.
3. **Image normalisation visual test** — After paste, download the WebP
   files Salla received and overlay them with the brand template
   (`مشروع جديد.psd` on the user's Desktop). Cover image's product should
   fit within the inner 70% of the canvas with consistent top/bottom margins.

Local fixture HTML (used during the 5.1 build) lived at `/tmp/pilot-e2e/`:
- `product-page.html` — Salla-style fixture
- `shopify-page.html`, `woocommerce-page.html`, `microdata-page.html`,
  `sparse-page.html` — platform fixtures
- Local server: `cd /tmp/pilot-e2e && python3 -m http.server 8765`

---

## 12. Where things tend to break (and how to fix fast)

| Symptom | Most-likely cause | Fix |
|---|---|---|
| Paste fails with "Cannot read properties of undefined (reading 'title')" | Stale SW that doesn't know `aiRewrite` | Reload the extension card; if no fix, toggle off/on |
| Rewrite seems off / wrong style | Rules + examples not saved | Open Options → re-paste rules + examples → save |
| Cover image too small / lots of whitespace | `paddingPct` set too high | Lower it in `IMAGE_NORMALIZE_DEFAULTS` at top of `background.js` |
| Gallery images sideways | EXIF orientation flag not honoured | Already fixed in 5.4.9 — verify build stamp; if broken again, check `imageOrientation: 'from-image'` is still in `reencodeAsWebP` |
| Image #2 is the same as image #1 | DOM scraper emitted same URL from two sources | Already fixed in 5.4.9 — verify the `🧹 deduped` log fires |
| Amazon: only 1 image extracted | Extension running stale build, OR `#imageBlock_feature_div` selector list misses a layout variant | Verify build stamp; otherwise add the missing container ID to the fallback chain in the Amazon extraction block of `content_copy.js` |
| `Gemini لم يُرجع JSON صالحاً` | Model returned an unusual shape | Check the full SW console — `parseGeminiJson` logs the raw response for diagnosis |

---

## 13. Roadmap candidates (not committed)

- Web dashboard for the data-entry team (review/approve queue)
- Bulk import (CSV/Excel, supplier sheets)
- Data quality scoring + validation rules
- Multi-user workflow with roles + audit trail
- Direct Salla API integration (skip the form-fill step entirely)

---

## 14. Contact / context

- Repo owner: **OutQio** on GitHub
- Store: `iblackstores.com` (المخازن السوداء) — Salla-hosted
- Brand template: `~/Desktop/مشروع جديد.psd` (3×3 alignment grid)
- Last hands-on session: see `git log` for chronological context
