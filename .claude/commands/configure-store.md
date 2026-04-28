---
description: Visit a Salla store's public catalog, sample real products, and derive rewrite rules + 2-3 examples in the store's actual voice. Use when a user wants AI rewriting tuned to their brand.
argument-hint: "<storefront-url>"
---

The user has given you their Salla storefront URL: **$ARGUMENTS**

Your job is to derive **rewrite rules + 2-3 examples** that match this
store's actual voice, so when they paste products with the rewrite toggle
on, output sounds like their existing catalog.

---

## Procedure

### 1. Visit the homepage and find product links
- Use a browser tool (Playwright, WebFetch, etc.) to load `$ARGUMENTS`.
- Scrape product card links — typically `<a href>` elements pointing at
  paths like `/p/<id>`, `/<slug>` or `/products/<slug>`. Filter out
  category, cart, account, login, search pages.
- Pick **3-5 products** that look representative of the store's range
  (different categories ideally). Save their URLs.

### 2. For each product page
Visit it and extract:
- The `<h1>` text (the title)
- The product description block (`.product__description`,
  `[itemprop="description"]`, `.p-about`, or whichever the page uses)

You're not running the extension's scraper — you're just observing the
real text the store uses.

### 3. Identify patterns
Look for recurring structure across the products:

**Title pattern** — write down the FIXED skeleton you observe. E.g.:
- `<Brand> - <Product type + spec> - <Color>` separated by ` - `
- `<Type>: <Model>, <Spec>` with colons
- All-caps brand prefix
- Maximum length common to all titles

**Description pattern** — list the sections in order. E.g.:
- Bold opening line repeating the title
- Marketing intro paragraph (1-2 sentences, conversational tone?)
- Bullet list of features under a bold heading like `المميزات الرئيسية:`
- Optional spec list as `key: value.`
- Closing question/section like `ليش ممكن تشتريه؟`

**Tone markers** — note the dialect and forbidden patterns:
- Khaleeji vs Levantine vs MSA vs English
- Specific dialect markers (`ليش`, `يبغى`, `اللي`, `تخليك`, `تقدر`)
- Are emoji used? Prices mentioned? Comparisons to other stores?
- Tech terms — Arabic-transliterated (`تايب سي`, `أموليد`) or kept English
  (`USB-C`, `AMOLED`)?

### 4. Draft the three textareas
Output three blocks the user can copy-paste into the Options page:

**قواعد العنوان** — 1 paragraph in plain Arabic describing the title rules.
**قواعد الوصف** — 1 paragraph describing the section structure and tone.
**أمثلة من متجرك** — 2-3 full examples (title + full description) copied
verbatim from the products you sampled.

Format the output exactly like this so the user can copy each block:

```
==== Paste this into "قواعد العنوان": ====
<title rules in Arabic>

==== Paste this into "قواعد الوصف": ====
<description rules in Arabic>

==== Paste this into "أمثلة من متجرك": ====
مثال ١:
العنوان: <real title 1>
الوصف:
<real description 1>

مثال ٢:
العنوان: <real title 2>
الوصف:
<real description 2>

مثال ٣:
العنوان: <real title 3>
الوصف:
<real description 3>
```

### 5. Walk them through saving
Tell them:
1. Open extension → ⚙️ → in the **✍️ إعادة كتابة المنتجات** section,
   check **تفعيل إعادة الكتابة (يتطلب Gemini AI)**
2. Paste each block into its matching textarea
3. Click **💾 حفظ قواعد إعادة الكتابة**
4. Test by running `/test-on <a-product-url-from-amazon-or-elsewhere>`

If the result doesn't match their voice well, iterate — they tell you
what's off, you adjust the rules text, they save again.
