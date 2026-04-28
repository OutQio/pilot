# Product Copier → Salla (AI)

Chrome extension that copies a product from any e-commerce page and pastes it
into Salla's `Add Product` form — with optional Gemini-powered Arabic rewriting
and brand-template image normalisation.

> Originally built for one Salla store's data-entry team. Open-sourced so
> any team running a Salla store can fork, adapt the rewrite rules + image
> template to their own brand, and ship their own.

**Current version:** 5.4.9 · **Manifest:** MV3 · **Min Chrome:** 103

---

## What it does

1. **Copy** — Scrape the title, description, and product images from any
   e-commerce page (DOM-only, instant, no API call). Universal — battle-tested
   on Amazon (incl. amazon.sa), eBay, Allbirds (Shopify), Extra, Jarir,
   Carrefour KSA, Lulu Hypermarket, Hnak, Jomla, plus generic Salla / Shopify /
   WooCommerce / Magento / BigCommerce.

2. **Paste** — Open Salla's `Add Product` page and click Paste. Optional
   toggle:

   - **`✍️ إعادة كتابة بأسلوب متجرك`** ON → Gemini rewrites the title +
     description in Arabic in your store's voice, using saved style rules
     (e.g. "title format: brand-Arabic - product type+spec - colour").
   - Toggle OFF → original DOM-extracted text goes in as-is.

3. **Image normalisation** — The cover image is auto-cropped (white/transparent
   edges removed), centred on a 1000×1000 white canvas with 15% margin, and
   re-encoded as WebP. Gallery images keep their original framing but are also
   re-encoded as WebP (with EXIF orientation honoured + a 2000 px longest-side
   safety cap).

---

## Install (developer mode)

1. Clone or fork this repo:
   ```bash
   git clone https://github.com/OutQio/pilot.git
   cd pilot
   ```
2. Open `chrome://extensions` → toggle **Developer mode** ON
3. Click **Load unpacked** → select the cloned folder
4. Verify version says **5.4.9** under the extension name
5. Click the extension icon → **Options (⚙️)** → paste a Gemini API key from
   [Google AI Studio](https://aistudio.google.com/app/apikey) → click **اختبار**
   to confirm

> **No Web Store install yet.** This is an internal tool published as source.
> If you want a packaged build, run any zip command on the repo root and load
> that in Chrome.

---

## Configure for your store

The image normaliser and the rewrite rules are the two main customisation
points.

### Image template

Edit `IMAGE_NORMALIZE_DEFAULTS` at the top of `background.js`:

```js
const IMAGE_NORMALIZE_DEFAULTS = Object.freeze({
  size       : 1000,         // output square edge length in px
  paddingPct : 15,           // margin per side (15 = product fills ~70%)
  bg         : '#ffffff',    // background colour
  format     : 'image/webp', // output mime type
  quality    : 0.92,         // 0..1 — webp quality
  // ...
});
```

Reload the extension to pick up changes.

### Rewrite rules + examples

Open the extension's **Options** page. Three text areas:

1. **قواعد العنوان** — title rules. Length, format, language, what to
   include/exclude.
2. **قواعد الوصف** — description rules. Sections, tone, length, formatting.
3. **أمثلة من متجرك** — 2-3 real product examples (title + description) from
   your store, pasted as-is. Gemini learns the voice from these.

**Worked example (Khaleeji-Arabic store style):**

- **Title:** `<البراند بالعربية> - <نوع المنتج + المواصفة الرئيسية> - <اللون>`
- **Description:** 4-5 sections — bold title repeat, marketing intro
  paragraph, bullet list under `المميزات الرئيسية:`, optional bullet list
  under `المواصفات التقنية:` (`key: value.` format), closing paragraph
  under `ليش ممكن تشتريه؟`.
- **Tone:** Saudi / Khaleeji colloquial — `ليش`, `يبغى`, `اللي`, `تجي`,
  `تخليك`, `تقدر`, `عشان`, `وين`.
- **No** emoji, **no** prices, **no** comparisons to other stores.
- Tech terms transliterated to Arabic (`تايب سي`, `أموليد`, `ماج سيف`),
  but model numbers + standards stay English (`Qi2`, `IP68`, `GPS`,
  `AMOLED`).

To derive your own ruleset: sample 3-5 product pages from your store's
public catalog, observe the recurring patterns, paste them into the
example textarea verbatim, and write the rules in plain Arabic above.

---

## Daily usage

| Step | Action |
|---|---|
| 1 | Open any product page (Amazon, eBay, supplier site, anything with a `<h1>` and `<img>`s) |
| 2 | Click the extension icon → **`📋 نسخ من هذه الصفحة`** |
| 3 | Open `https://s.salla.sa/products/new` |
| 4 | Click the extension icon → toggle **`✍️ إعادة كتابة`** as desired → **`✅ لصق البيانات في سلة`** |
| 5 | Salla form is filled in; review + click Salla's own Save button |

---

## Live-tested platforms

| Site | Status | Notes |
|---|---|---|
| **Amazon (incl. amazon.sa)** | ✅ | Whole-page scan scoped to `#imageBlock_feature_div`. Synthesises bare `<id>.jpg` URLs from each visible thumbnail — recovers all alt-angle images without simulating clicks. |
| **eBay** | ✅ | `s-l<n>` size-suffix dedup; description from `og:description` fallback. |
| **Shopify** (Allbirds tested) | ✅ | `<picture><source srcset>` parsed; `_500x500` dedup. Recommendation carousels filtered via `pointsToOtherProduct`. |
| **WooCommerce** | ✅ | `data-large_image` attribute supported; srcset highest-`w` wins. |
| **Generic Salla / Magento / BigCommerce** | ✅ | Standard JSON-LD + microdata + selector chain. |
| Various KSA stores (tested live) | ✅ | All produce clean title + description + images. |
| AliExpress, Shein | ⚠️ | Anti-bot blocks the scrape in headless test browsers. Works in a normal Chrome user session. |

The DOM scraper has 4 layers (gallery selectors → JSON-LD → microdata →
full-page fallback) plus a 5th Amazon-specific path. URLs go through
`computeImageBase` for canonicalisation (host normalisation, size-variant
stripping, query-param dropping) and `urlQuality` to prefer non-proxied
originals over CDN-resized versions.

---

## Documentation

| Doc | When to read it |
|---|---|
| [`README.md`](./README.md) | You are here. Install + usage + worked example + live-tested sites. |
| [`CLAUDE.md`](./CLAUDE.md) | Auto-loaded by [Claude Code](https://claude.com/claude-code). Fast project memory: file map, invariants to preserve, common tasks, symptom→fix table. |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Required rules for contributing — branching, commit format, version-bump, pre-merge checks. |
| [`CHANGELOG.md`](./CHANGELOG.md) | What changed in each version. |
| [`SECURITY.md`](./SECURITY.md) | How to report a vulnerability. |

---

## Tech stack

- **Chrome Extension Manifest V3** — service worker, content scripts,
  declarative permissions
- **Google Gemini API** — model `gemini-3-flash-preview` (fallback
  `gemini-2.5-flash`), with `responseMimeType: "application/json"` for
  structured output and `thinkingBudget: 0` to disable hidden chain-of-thought
- **OffscreenCanvas + createImageBitmap** — service-worker-side image
  processing for the brand template
- **Vanilla JS** — no build step, no bundler, no framework. Edit a `.js`
  file → reload the extension → done.

---

## Contributing

Forks welcome. Open issues for bugs / questions. PRs follow the template at
`.github/PULL_REQUEST_TEMPLATE.md`.

If you're using Claude Code, the repo ships with a `CLAUDE.md` that gets
auto-loaded as project memory — just run Claude Code from the repo root and
it'll know the codebase before you ask anything.

---

## License

[MIT](./LICENSE) — fork it, sell it, ship it. Just don't blame me.
