// content_copy.js
// Injected into the source product page. Extracts title, description, and images.
// Result stored on window.__copiedProduct (read back by popup.js).

(function () {
  'use strict';

  // ── Selector lists — defined once, used consistently throughout ──────────────
  // Previously the description selector string was repeated on line 168 for the
  // "description images" section. Now there is one canonical list.
  const DESCRIPTION_SELECTORS = [
    'div.p-about',                                        // mokab.com / Salla-based stores
    '[itemprop="description"]',
    '.product-description',
    '#product-description',
    '.product__description',
    '#tab-description',
    '.woocommerce-product-details__short-description',
    '#productDescription',
    '[data-testid="product-description"]',
    '.p-description',
    '.product-details-content',
    '.description-content',
  ];

  const GALLERY_SELECTORS = [
    '.swiper-slide.magnify-wrapper img',     // mokab primary gallery
    '.homeslider__slide img',                // mokab alternate
    '[class*="magnify-wrapper"] img',
    '.p-gallery img',
    '.product-gallery img',
    '.product-images img',
    '.product__media img',
    '.woocommerce-product-gallery img',
    '#product-image-magnify img',
  ];

  const JUNK_URL_FRAGMENTS = [
    'logo','icon','avatar','favicon','sprite','brand','badge',
    'blank.','1x1','pixel','placeholder','tracking','captcha',
    'rating-','star-','check-','tick-','whatsapp','facebook','twitter',
  ];

  // ── Helpers ───────────────────────────────────────────────────────────────────

  // Returns the best available image URL from an <img> element, resolving lazy-
  // load attributes before falling back to src.
  function resolveImgSrc(img) {
    const attrs = [
      'data-zoom-image','data-large','data-original','data-full',
      'data-src','data-lazy','data-lazy-src','data-original-src','src',
    ];
    for (const attr of attrs) {
      const val = img.getAttribute(attr);
      if (!val || val.startsWith('data:') || val.startsWith('blob:')) continue;
      try { return new URL(val, location.href).href; } catch { /* invalid URL */ }
    }
    return null;
  }

  // Returns false for SVGs, logos, tracking pixels, and anything that doesn't
  // look like a real image URL.
  function isProductImage(url) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return false;
    if (/\.svg(\?|$)/i.test(url)) return false;
    const lower = url.toLowerCase();
    if (JUNK_URL_FRAGMENTS.some(frag => lower.includes(frag))) return false;
    // URL must either have a recognised image extension OR an image CDN pattern
    const hasExt = /\.(jpg|jpeg|png|webp|gif)(\?|$|#|-)/i.test(url);
    const hasCdn = /cdn\.|images\.|img\.|media\./i.test(url);
    return hasExt || hasCdn;
  }

  // Walks up to 8 ancestor elements looking for junk containers (nav, footer…).
  function isInJunkArea(el) {
    let node = el.parentElement;
    for (let depth = 0; depth < 8 && node; depth++) {
      const sig = `${node.className ?? ''} ${node.id ?? ''}`.toLowerCase();
      if (/\bnav\b|header|footer|related|recommend|similar|upsell|cross|cart|wishlist/.test(sig)) return true;
      if (/^(NAV|HEADER|FOOTER|ASIDE)$/.test(node.tagName)) return true;
      node = node.parentElement;
    }
    return false;
  }

  // Gets visible text from an element. .innerText requires a layout pass (fails
  // in headless environments); .textContent is always available as a fallback.
  function getText(el) {
    return el ? (el.innerText || el.textContent || '').trim() : '';
  }

  // ── 1. TITLE ──────────────────────────────────────────────────────────────────
  function extractTitle() {
    const candidates = [
      () => getText(document.querySelector('h1.p-name')),
      () => getText(document.querySelector('h1[itemprop="name"]')),
      () => getText(document.querySelector('h1.product_title')),
      () => getText(document.querySelector('h1.product__title')),
      () => getText(document.querySelector('#productTitle')),
      () => getText(document.querySelector('.product-title h1')),
      () => getText(document.querySelector('h1')),
      () => document.querySelector('meta[property="og:title"]')?.content?.trim(),
      () => document.title.replace(/\s*[-|–]\s*.*$/, '').trim(),
    ];
    for (const fn of candidates) {
      try {
        const t = fn();
        if (t?.length > 2) return t;
      } catch { /* selector unsupported in this page context */ }
    }
    return '';
  }

  // ── 2. DESCRIPTION ────────────────────────────────────────────────────────────
  function extractDescription() {
    for (const sel of DESCRIPTION_SELECTORS) {
      const el = document.querySelector(sel);
      if (!el) continue;

      // Clone so we don't mutate the live DOM
      const clone = el.cloneNode(true);
      clone.querySelectorAll('script,style,iframe,noscript,button').forEach(n => n.remove());

      // Resolve lazy-loaded images inside the description
      clone.querySelectorAll('img').forEach(img => {
        const src = resolveImgSrc(img);
        if (src) img.setAttribute('src', src);
      });

      // Measure text length (not HTML length) — avoids rejecting short-markup
      // descriptions like <p>سلك راف</p> which has only 8 real characters.
      const textLen = (clone.textContent ?? clone.innerText ?? '').trim().length;
      if (textLen > 5) return clone.innerHTML.trim();
    }
    return '';
  }

  // ── 3. IMAGES ─────────────────────────────────────────────────────────────────
  function extractImages(limit) {
    const seen     = new Set();   // exact URL dedup
    const seenBase = new Set();   // CDN size-variant dedup
    const results  = [];          // { url, priority }

    function add(url, priority) {
      if (!url || seen.has(url) || !isProductImage(url)) return;
      // Normalise Salla CDN size suffixes like -500x500-ABC123.jpg → -NORM.jpg
      const base = url.replace(/-\d+x\d+-[A-Za-z0-9]+(\.|$)/g, '-NORM$1');
      if (seenBase.has(base)) return;
      seen.add(url);
      seenBase.add(base);
      results.push({ url, priority });
    }

    // A. Product gallery (highest priority — these are always the main images)
    for (const sel of GALLERY_SELECTORS) {
      document.querySelectorAll(sel).forEach(img => {
        // Skip thumbnail row re-renders (same swiper images at smaller size)
        if (img.className?.includes('object-cover') && img.className?.includes('rounded')) return;
        const url = resolveImgSrc(img);
        if (url) add(url, 90);
      });
    }

    // B. JSON-LD structured data (most semantically correct source)
    // Accept Product and ItemPage; skip Organization (mokab misuses it).
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const data  = JSON.parse(s.textContent);
        const items = Array.isArray(data) ? data : [data];
        items.forEach(item => {
          const type = [].concat(item['@type'] ?? []).join(',');
          if (!/Product|ItemPage/i.test(type)) return;
          [].concat(item.image ?? []).forEach((img, i) => {
            const raw = typeof img === 'string' ? img : (img.url ?? img.contentUrl ?? '');
            try { add(new URL(raw, location.href).href, 100 - i); } catch {}
          });
        });
      } catch { /* malformed JSON-LD */ }
    });

    // C. Description images (bundle products often use these as main visuals)
    // Reuses DESCRIPTION_SELECTORS[0] to avoid a separate hard-coded string.
    const descEl = document.querySelector(DESCRIPTION_SELECTORS[0])
                ?? document.querySelector(DESCRIPTION_SELECTORS[1])
                ?? document.querySelector(DESCRIPTION_SELECTORS[2]);
    if (descEl) {
      descEl.querySelectorAll('img').forEach(img => {
        const url = resolveImgSrc(img);
        if (url) add(url, img.naturalWidth >= 300 ? 55 : 30);
      });
    }

    // D. Full-page fallback (only when gallery + JSON-LD gave fewer than 3 images)
    if (results.length < 3) {
      document.querySelectorAll('img').forEach(img => {
        if (img.naturalWidth < 200 && img.naturalHeight < 200) return;
        if (isInJunkArea(img)) return;
        const url = resolveImgSrc(img);
        if (url) add(url, 20);
      });
    }

    // E. Open Graph meta tags (last resort)
    document.querySelectorAll('meta[property="og:image"]').forEach((m, i) => {
      try { add(new URL(m.content, location.href).href, 15 - i); } catch {}
    });

    results.sort((a, b) => b.priority - a.priority);
    return results.slice(0, limit).map(r => r.url);
  }

  // ── Assemble ──────────────────────────────────────────────────────────────────
  const imgLimit = window.__copySettings?.imgLimit ?? 8;
  const title    = extractTitle();

  if (!title || title.length < 2) {
    window.__copiedProduct = null;
    console.warn('[ProductCopier] No title found — may not be a product page');
    return;
  }

  window.__copiedProduct = {
    title,
    description : extractDescription(),
    images      : extractImages(imgLimit),
    sourceUrl   : location.href,
    extractedAt : new Date().toISOString(),
  };

  console.info(
    `[ProductCopier] ✅ "${title}" — ` +
    `${window.__copiedProduct.images.length} images, ` +
    `${window.__copiedProduct.description.length} desc chars`
  );
})();
