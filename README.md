# Product Copier → Salla (AI)

Chrome extension that copies a product from any e-commerce page and pastes it
into Salla's `Add Product` form — with optional Gemini-powered Arabic rewriting
and brand-template image normalisation.

> Built for the [iblackstores.com](https://iblackstores.com) data-entry team.
> Open-source so others running Salla stores can fork, adapt the rewrite rules
> + image template, and ship their own.

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

iblackstores' specific rules + examples are documented in
[`HANDOFF.md` § 7](./HANDOFF.md#7-rewrite-rules--examples).

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

## Documentation

| Doc | When to read it |
|---|---|
| [`README.md`](./README.md) | You are here. Install + usage. |
| [`HANDOFF.md`](./HANDOFF.md) | Pick up the codebase cold. Architecture, file map, all config knobs, version history, known caveats, symptom→fix table. |
| [`CLAUDE.md`](./CLAUDE.md) | Auto-loaded by [Claude Code](https://claude.com/claude-code). Fast project memory: invariants to preserve, common tasks, where things tend to break. |
| [`CHANGELOG.md`](./CHANGELOG.md) | What changed in each version. |

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
