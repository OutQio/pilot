// content_copy.js
// Injected into the source product page. Extracts title, description, and images.
// Result stored on window.__copiedProduct (read back by popup.js).
//
// Designed to be universal across e-commerce platforms — covers Salla, Shopify,
// WooCommerce, Magento, BigCommerce, OpenCart, PrestaShop, and generic stores
// that follow Schema.org / OpenGraph conventions.

(function () {
  'use strict';

  // Build stamp — bump on every change so we can verify in DevTools that
  // Chrome is loading the latest version (no cached service-worker copy).
  console.info('[ProductCopier] content_copy.js build 5.4.9 (paste-time rewrite, image normaliser, hardened JSON parser)');

  // ── Selector lists — defined once, used consistently throughout ──────────────
  // Order matters: more specific / higher-quality selectors come first.
  const TITLE_SELECTORS = [
    'h1.p-name',                                          // Salla / mokab.com
    'h1.product-single__title',                           // Shopify (Debut, Brooklyn)
    'h1.product__title',                                  // Shopify (Dawn)
    'h1.product_title',                                   // WooCommerce
    'h1.product-name',                                    // BigCommerce / generic
    'h1.productView-title',                               // BigCommerce (Cornerstone)
    'h1.entry-title',                                     // WordPress / WooCommerce
    'h1[itemprop="name"]',                                // Schema.org microdata
    'h1[data-product-title]',                             // generic data-attr
    '#productTitle',                                      // Amazon
    '.product-title h1',
    '.product-name h1',
    '.product-info h1',
    'h1',                                                 // last DOM resort
  ];

  const DESCRIPTION_SELECTORS = [
    'div.p-about',                                        // Salla / mokab.com
    '[itemprop="description"]',                           // Schema.org microdata
    '.product-single__description',                       // Shopify
    '.product__description',                              // Shopify (Dawn)
    '.product-description',                               // generic
    '#product-description',
    '.woocommerce-product-details__short-description',    // WooCommerce
    '#tab-description',                                   // WooCommerce / generic tabs
    '.productView-description',                           // BigCommerce
    '#productDescription',                                // Amazon (legacy)
    '#productDescription_feature_div',                    // Amazon (newer)
    '#feature-bullets',                                   // Amazon bullet-list summary
    '#aplus, #aplus_feature_div',                         // Amazon enhanced content
    '[data-feature-name="featurebullets"]',               // Amazon feature flag
    '[data-feature-name="productDescription"]',
    '#desc_div, #vi-desc-maincntr',                       // eBay description container
    '[data-testid="product-description"]',
    '[data-product-description]',
    '.p-description',
    '.product-details-content',
    '.description-content',
    '.product-details__description',                      // Magento
    '.product.attribute.description',                     // Magento 2
    '.product-info__description',
    '.detail__description',
    '.std',                                               // OpenCart / older Magento
    '.pdp-product-description',                           // Noon / generic pdp
    '.pdp__description',
  ];

  const GALLERY_SELECTORS = [
    '.swiper-slide.magnify-wrapper img',                  // Salla / mokab primary
    '.homeslider__slide img',                             // Salla alternate
    '[class*="magnify-wrapper"] img',
    '.p-gallery img',                                     // Salla
    '.product-gallery img',                               // generic
    '.product-images img',
    '.product__media img',                                // Shopify (Dawn)
    '.product__photo img',                                // Shopify
    '.product-single__media img',                         // Shopify (Debut)
    '.product-single__photo img',
    '.woocommerce-product-gallery img',                   // WooCommerce
    '.woocommerce-product-gallery__image img',
    '.fotorama__img',                                     // Magento
    '.gallery-image-container img',                       // Magento
    '.MagicSlideshow img',                                // BigCommerce (legacy)
    '.productView-image img',                             // BigCommerce
    '#product-image-magnify img',
    '[data-product-image]',
    '[data-zoom-image-url]',
    '[data-zoom-target]',
    '[data-image-large]',
    '.media-gallery img',
    '.product-gallery__image img',
    '.detail__main img',
    // Amazon
    '#landingImage',                         // Amazon main product image
    '#imgTagWrapperId img',                  // Amazon main image wrapper
    '#imgBlkFront',                          // Amazon book cover variant
    '#altImages img',                        // Amazon alt-angle thumbnails
    '.imageThumbnail img',
    '.a-button-thumbnail img',
    '#main-image-container img',
  ];

  // Junk URL fragments we never want as a product image.
  // Lowercased before comparison; matches anywhere in the URL.
  const JUNK_URL_FRAGMENTS = [
    'logo','icon','avatar','favicon','sprite','brand','badge',
    'blank.','1x1','pixel','placeholder','tracking','captcha','spinner','loader',
    'rating-','star-','check-','tick-','social-',
    'whatsapp','facebook','twitter','instagram','tiktok','pinterest','snapchat',
    'paypal','visa','mastercard','mada-','apple-pay','google-pay','stcpay',
    // Marketing tiles / promotional banners that often live alongside
    // product photos in the same CDN folder (Shopify, Jarir, etc.)
    'site_navigation','site-navigation','sale_nav','sale-nav','navigation_',
    'newarrivals','new-arrivals','new_arrivals','banner_','/banners/',
    'promo_','promotion_','marketing_','homepage_','category_tile',
    '_tile.','-tile.','_tile_','-tile-','_nav_','-nav-',
  ];

  // Lazy-load attributes — checked in priority order. First non-empty,
  // non-data-URL value wins. Order matters:
  //   1. Explicit high-resolution variants (zoom / large) — best quality
  //   2. Responsive sets (srcset, data-srcset) — pick highest descriptor
  //   3. Lazy-load placeholders (data-src etc) — what the gallery will load
  //   4. Plain src — last resort, often a low-res thumbnail
  const LAZY_ATTRS = [
    'data-zoom-image','data-zoom-image-url',
    'data-old-hires',                                   // Amazon main image attr
    'data-large','data-large_image','data-image-large','data-image_large',
    'data-original','data-full','data-hi-res','data-image',
    'srcset','data-srcset',
    'data-src','data-lazy','data-lazy-src','data-original-src','data-defer-src',
    'data-img','data-img-src','data-thumb',
    'src',
  ];

  // ── Helpers ───────────────────────────────────────────────────────────────────

  // Decode HTML entities that sometimes leak into URLs. JSON-LD scripts are
  // raw text — JSON.parse won't decode `&amp;` even though it's almost always
  // wrong inside a URL. Without this, the same image at different priorities
  // dedupes as two distinct URLs (one with `&amp;`, one with `&`).
  function decodeUrlEntities(s) {
    return s
      .replace(/&amp;/gi,  '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#x27;/gi, "'")
      .replace(/&#39;/gi,  "'")
      .replace(/&lt;/gi,   '<')
      .replace(/&gt;/gi,   '>');
  }

  // Resolve a possibly-relative URL against the current page; strict about
  // non-image URIs.
  function toAbs(url) {
    if (!url) return null;
    if (url.startsWith('data:') || url.startsWith('blob:')) return null;
    const cleaned = decodeUrlEntities(url.trim());
    try { return new URL(cleaned, location.href).href; } catch { return null; }
  }

  // Pick the highest-resolution candidate from a srcset attribute.
  // srcset format: "url1 1x, url2 2x" or "url1 100w, url2 800w".
  function pickFromSrcset(srcset) {
    if (!srcset) return null;
    const candidates = srcset.split(',').map(part => {
      const tokens = part.trim().split(/\s+/);
      const url    = tokens[0];
      const desc   = tokens[1] || '1x';
      const num    = parseFloat(desc) || 1;
      return { url, num };
    }).filter(c => c.url);
    candidates.sort((a, b) => b.num - a.num);
    return candidates[0]?.url ?? null;
  }

  // Amazon-specific: <img> elements carry a JSON map of available sizes:
  //   data-a-dynamic-image='{"https://.../foo.jpg":[w,h], "https://.../foo2.jpg":[w,h]}'
  // Pick the URL with the largest area. This is the only way to recover the
  // hi-res versions from Amazon thumbnails, which only display at 40px.
  function pickFromAmazonDynamic(img) {
    const raw = img.getAttribute?.('data-a-dynamic-image');
    if (!raw) return null;
    try {
      const map = JSON.parse(raw);
      let bestUrl = null, bestArea = 0;
      for (const url in map) {
        const dims = map[url];
        const area = (dims?.[0] || 0) * (dims?.[1] || 0);
        if (area > bestArea) { bestUrl = url; bestArea = area; }
      }
      return bestUrl;
    } catch { return null; }
  }

  // Returns the best available image URL from an <img> element. Walks all known
  // lazy-load attributes, picks highest-res from srcset, and looks at adjacent
  // <source> elements when the <img> is inside a <picture>.
  function resolveImgSrc(img) {
    // 1. Check <picture><source srcset> siblings (modern responsive images)
    const picture = img.closest('picture');
    if (picture) {
      const sources = picture.querySelectorAll('source[srcset]');
      for (const s of sources) {
        const fromSet = pickFromSrcset(s.getAttribute('srcset'));
        const abs     = toAbs(fromSet);
        if (abs) return abs;
      }
    }

    // 1.5. Amazon's data-a-dynamic-image JSON — highest-quality variant of the
    // *same* image angle. Skipped silently on non-Amazon sites where the attr
    // doesn't exist.
    const amazonDyn = pickFromAmazonDynamic(img);
    if (amazonDyn) {
      const abs = toAbs(amazonDyn);
      if (abs) return abs;
    }

    // 2. Walk known lazy-load attributes (srcset variants are parsed for
    //    highest descriptor; everything else is treated as a single URL)
    for (const attr of LAZY_ATTRS) {
      const val = img.getAttribute(attr);
      if (!val) continue;
      const candidate = attr.endsWith('srcset') ? pickFromSrcset(val) : val;
      const abs = toAbs(candidate);
      if (abs) return abs;
    }
    return null;
  }

  // Returns the displayed/intrinsic size of an image, falling back to the
  // width/height attributes when the image hasn't loaded yet (lazy-load).
  function imgSize(img) {
    const w = img.naturalWidth  || img.width
            || parseInt(img.getAttribute('width'),  10)
            || parseInt(img.getAttribute('data-width'), 10) || 0;
    const h = img.naturalHeight || img.height
            || parseInt(img.getAttribute('height'), 10)
            || parseInt(img.getAttribute('data-height'), 10) || 0;
    return { w, h };
  }

  // Returns false for SVGs, logos, tracking pixels, and anything that doesn't
  // look like a real image URL.
  function isProductImage(url) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return false;
    if (/\.svg(\?|$|#)/i.test(url)) return false;
    const lower = url.toLowerCase();
    if (JUNK_URL_FRAGMENTS.some(frag => lower.includes(frag))) return false;
    // URL must either have a recognised image extension OR an image CDN pattern
    const hasExt = /\.(jpe?g|png|webp|gif|avif|bmp)(\?|$|#|-)/i.test(url);
    const hasCdn = /cdn[.\-/]|images?[.\-/]|img[.\-/]|media[.\-/]|assets?[.\-/]|content[.\-/]|photos?[.\-/]/i.test(url);
    return hasExt || hasCdn;
  }

  // Walks up to 10 ancestor elements looking for junk containers (nav, footer,
  // related-product carousels, "you may also like" sections, etc.).
  function isInJunkArea(el) {
    let node = el.parentElement;
    for (let depth = 0; depth < 10 && node; depth++) {
      const className = typeof node.className === 'string' ? node.className : '';
      const sig = `${className} ${node.id ?? ''}`.toLowerCase();
      if (/\bnav\b|header|footer|related|recommend|similar|upsell|cross-?sell|cart|wishlist|review|comment|you-?may|may-?also|frequently|bundle|complementary|tile_|tile-|drawer|menu/.test(sig)) return true;
      if (/^(NAV|HEADER|FOOTER|ASIDE)$/.test(node.tagName)) return true;
      node = node.parentElement;
    }
    return false;
  }

  // Universal "this image belongs to a *different* product" check.
  // Many sites (Carrefour, Lulu, generic catalogues) render related-product
  // tiles using the same gallery selectors as the main product. The strongest
  // signal we can get without site-specific selectors is: the image is wrapped
  // in an <a href> that points to a different product page than the one we're on.
  function pointsToOtherProduct(img) {
    const a = img.closest?.('a[href]');
    if (!a) return false;
    const href = a.getAttribute('href');
    if (!href || href === '#' || href.startsWith('javascript:')) return false;
    try {
      const linkUrl = new URL(href, location.href);
      if (linkUrl.pathname === location.pathname) return false; // same page
      // Heuristic: pathname looks like a product URL pattern, and is different
      // from the current pathname → it's a recommendation tile.
      if (/\/(p|product|products|item|items|dp|i)\/[^/]+/i.test(linkUrl.pathname)) return true;
      if (linkUrl.pathname.endsWith('.html') && linkUrl.pathname !== location.pathname) return true;
      // Default: cross-page links to anything other than our page are suspect.
      return linkUrl.hostname === location.hostname && linkUrl.pathname.length > 5;
    } catch { return false; }
  }

  // Gets visible text from an element. .innerText requires a layout pass (fails
  // in headless environments); .textContent is always available as a fallback.
  function getText(el) {
    return el ? (el.innerText || el.textContent || '').trim() : '';
  }

  // Strip a trailing " - Site Name" / " | Site Name" / " :: Site Name" suffix.
  // Applied to every title source so the store name doesn't pollute the output
  // regardless of whether the title came from an h1 selector or a meta fallback.
  //
  // Safety gate: only return the stripped version if it kept >= 40% of the
  // original AND is still at least 3 chars long. This prevents mangling
  // legitimate product names that contain a hyphen, e.g. "iPhone 13 - 256GB".
  function stripSiteSuffix(t) {
    if (!t) return '';
    const original = t.trim();
    const stripped = original.replace(/\s*[-|–—:]+\s*[^-|–—:]{2,60}\s*$/, '').trim();
    if (stripped.length >= 3 && stripped.length >= original.length * 0.4) return stripped;
    return original;
  }

  // ── 1. TITLE ──────────────────────────────────────────────────────────────────
  function extractTitle() {
    for (const sel of TITLE_SELECTORS) {
      try {
        const t = getText(document.querySelector(sel));
        if (t?.length > 2) return stripSiteSuffix(t);
      } catch { /* selector unsupported */ }
    }
    const og = document.querySelector('meta[property="og:title"]')?.content?.trim();
    if (og?.length > 2) return stripSiteSuffix(og);
    const tw = document.querySelector('meta[name="twitter:title"]')?.content?.trim();
    if (tw?.length > 2) return stripSiteSuffix(tw);
    return stripSiteSuffix(document.title);
  }

  // ── 2. DESCRIPTION ────────────────────────────────────────────────────────────
  function extractDescription() {
    for (const sel of DESCRIPTION_SELECTORS) {
      const el = document.querySelector(sel);
      if (!el) continue;

      // Clone so we don't mutate the live DOM
      const clone = el.cloneNode(true);
      clone.querySelectorAll('script,style,iframe,noscript,button,form,input,select,textarea').forEach(n => n.remove());

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

    // Last-resort fallbacks: structured meta tags. Wrapped in <p> so the
    // downstream Quill paste preserves it as a paragraph.
    const og = document.querySelector('meta[property="og:description"]')?.content?.trim();
    if (og?.length > 5) return `<p>${escapeHtml(og)}</p>`;
    const md = document.querySelector('meta[name="description"]')?.content?.trim();
    if (md?.length > 5) return `<p>${escapeHtml(md)}</p>`;
    return '';
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // ── 3. IMAGES ─────────────────────────────────────────────────────────────────

  // Compute a normalised dedup key for an image URL. Reduces:
  //   Salla    : -500x500-ABC123.jpg              → -NORM.jpg
  //   Shopify  : _500x500.jpg / _500x.jpg / _x500 → -NORM.jpg
  //   WC/Magento: -500x500.jpg                    → -NORM.jpg
  //   Amazon   : ._AC_SX425_.jpg / ._AC_UL232_…   → .NORM.jpg
  //   eBay     : /s-l1600.jpg / /s-l400.jpg       → /s-NORM.jpg
  //   Jarir/CF : /cdn-cgi/image/…/<orig>          → <orig>
  //   Generic  : ?w=500 / ?width=500 / ?size=…    → query-stripped
  // and canonicalises Amazon / eBay multi-host CDNs so the same image at
  // different hostnames maps to a single base.
  function computeImageBase(url) {
    let base;
    try { base = decodeURIComponent(url); } catch { base = url; }
    base = base
      .replace(/^https?:\/\/[^/]+\/cdn-cgi\/image\/[^/]+\//i, '')
      .replace(/-\d+x\d+-[A-Za-z0-9]+(\.[a-z]+|$)/gi, '-NORM$1')
      .replace(/[_-]\d+x\d*(\.[a-z]+)/gi, '-NORM$1')
      .replace(/[_-]x\d+(\.[a-z]+)/gi, '-NORM$1')
      .replace(/\._AC_[^.]*?_\.([a-z]+)/gi, '.NORM.$1')
      .replace(/\/s-l\d+(?:-\d+)?(\.[a-z]+)/gi, '/s-NORM$1')
      .replace(/^https?:\/\/[^/]*media-amazon\.com/i,            'amazon-cdn:')
      .replace(/^https?:\/\/[^/]*images-amazon\.com/i,           'amazon-cdn:')
      .replace(/^https?:\/\/images-[a-z]+\.ssl-images-amazon\.com/i, 'amazon-cdn:')
      .replace(/^https?:\/\/[^/]*ebayimg\.com/i,                 'ebay-cdn:');
    // Final Amazon dedup: collapse any /images/I/<ID>.<anything>.<ext> down
    // to /images/I/<ID> so that the bare hi-res URL and any sized variant
    // (._AC_US40_, ._SX425_, etc.) of the same image map to one key.
    if (base.startsWith('amazon-cdn:/images/I/')) {
      const idMatch = base.match(/^amazon-cdn:\/images\/I\/([A-Za-z0-9+\-_]+)/);
      if (idMatch) base = `amazon-cdn:/images/I/${idMatch[1]}`;
    }
    try {
      const u = new URL(base, location.href);
      // Drop CDN sizing / format / cache-buster parameters used by the major
      // platforms we've observed in the wild. New CDN? Add its size param here.
      [
        'w','width','h','height','size','quality','q','format','fit','crop',
        'sw','sh','v','version','dpi','dpr','auto',
        'im',                                     // Carrefour / MAF (?im=Resize=376)
        'resize','scale','rs','f',                // generic image servers
        'wid','hei',                              // Magento legacy
        '$listing-product-2x$', 'locale',         // Extra/aurora style
      ].forEach(p => u.searchParams.delete(p));
      base = u.href;
    } catch { /* base may not be parseable after substitution */ }
    return base;
  }

  // Quality score for two URLs that share the same dedup base. Higher wins.
  // Prefer non-proxied originals (Jarir cdn-cgi/image, Cloudflare /cdn-cgi/),
  // prefer Amazon "bare" URLs (no size suffix = full-size original) over
  // Amazon size-variant URLs, and prefer larger explicit dimensions in the URL.
  function urlQuality(url) {
    let score = 0;
    if (!/\/cdn-cgi\//i.test(url)) score += 10;
    // Amazon: an /images/I/<ID>.jpg URL with no "._AC_..._" or "._S..._"
    // segment is the original full-size image. Score it well above sized
    // variants like ._AC_US40_, ._AC_SX425_, ._AC_SL1500_ etc.
    if (/\/images\/I\/[A-Za-z0-9+\-_]+\.(?:jpe?g|png|webp)$/i.test(url) &&
        !/\._(?:AC|S[XYL]|SR|SS|UF|UL|US|AA)_/i.test(url)) {
      score += 50;
    }
    const sizeMatch = url.match(/[_-](\d{2,4})x\d*[._]/i) ?? url.match(/[wh]idth=(\d{2,4})/i);
    if (sizeMatch) score += Math.min(parseInt(sizeMatch[1], 10), 2000) / 100;
    return score;
  }

  function extractImages(limit) {
    const seen     = new Set();   // exact URL dedup
    const baseToIdx = new Map();  // dedup base → index in results (for upgrades)
    const results   = [];         // { url, priority }

    function add(url, priority) {
      if (!url || seen.has(url) || !isProductImage(url)) return;
      const base = computeImageBase(url);
      const existingIdx = baseToIdx.get(base);
      if (existingIdx !== undefined) {
        // Same image already collected — upgrade the URL if this candidate is
        // higher quality (prefers original over CDN proxy / larger over thumb).
        const existing = results[existingIdx];
        if (urlQuality(url) > urlQuality(existing.url)) {
          existing.url = url;
          if (priority > existing.priority) existing.priority = priority;
        }
        seen.add(url);
        return;
      }
      seen.add(url);
      baseToIdx.set(base, results.length);
      results.push({ url, priority });
    }

    // A. Product gallery (highest priority — these are always the main images)
    for (const sel of GALLERY_SELECTORS) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); } catch { continue; }
      nodes.forEach(node => {
        // Some selectors hit non-<img> elements (e.g. [data-zoom-image-url])
        const img = node.tagName === 'IMG' ? node : node.querySelector?.('img') ?? node;
        // Skip thumbnail row re-renders (same swiper images at smaller size)
        if (img.className?.includes?.('object-cover') && img.className?.includes?.('rounded')) return;
        // Even gallery selectors can match recommendation carousels on some
        // sites (Allbirds shows "You may also like" inside .product__media,
        // Carrefour renders "frequently bought together" tiles with the same
        // structure). Junk-area check + cross-product-link check filter these.
        if (isInJunkArea(img))     return;
        if (pointsToOtherProduct(img)) return;
        const url = img.tagName === 'IMG'
          ? resolveImgSrc(img)
          : toAbs(node.getAttribute('data-zoom-image-url') || node.getAttribute('data-image-large') || node.getAttribute('data-zoom-target'));
        if (url) add(url, 90);
      });
    }

    // B. JSON-LD structured data (most semantically correct source)
    // Accept Product, ItemPage, ProductGroup; recurse into @graph; skip
    // Organization (some stores misuse it for the brand logo).
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const parsed = JSON.parse(s.textContent);
        const items  = [];
        const queue  = Array.isArray(parsed) ? [...parsed] : [parsed];
        while (queue.length) {
          const item = queue.shift();
          if (!item || typeof item !== 'object') continue;
          if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
          items.push(item);
        }
        items.forEach(item => {
          const type = [].concat(item['@type'] ?? []).join(',');
          if (!/Product|ItemPage|ProductGroup/i.test(type)) return;
          [].concat(item.image ?? []).forEach((img, i) => {
            const raw = typeof img === 'string' ? img : (img.url ?? img.contentUrl ?? '');
            const abs = toAbs(raw);
            if (abs) add(abs, 100 - i);
          });
          // Some stores nest images inside Offer.image
          [].concat(item.offers ?? []).forEach(offer => {
            [].concat(offer?.image ?? []).forEach((img, i) => {
              const raw = typeof img === 'string' ? img : (img.url ?? img.contentUrl ?? '');
              const abs = toAbs(raw);
              if (abs) add(abs, 80 - i);
            });
          });
        });
      } catch { /* malformed JSON-LD */ }
    });

    // C. Schema.org microdata (itemprop="image")
    document.querySelectorAll('[itemprop="image"]').forEach(el => {
      const url = el.tagName === 'IMG'
        ? resolveImgSrc(el)
        : toAbs(el.getAttribute('content') || el.getAttribute('href'));
      if (url) add(url, 75);
    });

    // C2. Amazon-specific: the full image gallery (all alt-angle URLs at every
    // available size) is embedded as a JSON blob inside one or more <script>
    // tags — typically as `colorImages` / `ImageBlockATF` data. The thumbnails
    // shown initially are 40 px so the regular DOM walk drops them; this scan
    // is the only way to recover the hi-res variants without simulating clicks.
    //
    // Both raw HTML (`media-amazon.com/images/I/...`) and JSON-encoded
    // (`media-amazon.com\/images\/I\/...`) forms are matched. The `\/` escapes
    // are common because Amazon serializes the ImageBlock data via JSON.
    // Amazon-specific extraction. Amazon's image gallery is a JS-driven mess:
    //   - <#landingImage> mutates as you hover/click thumbnails
    //   - Alt-angle thumbnails are 40 px (filtered as too-small)
    //   - The full ImageBlock data lives in JS state, sometimes serialised
    //     into <script> bodies with `\/`-escaped slashes
    //   - URLs appear in src, data-src, srcset, data-a-dynamic-image, plus
    //     embedded inside JSON in <script> and HTML attributes
    //
    // Strategy: don't try to enumerate every container. Just walk the entire
    // document HTML, regex out every "/images/I/<ID>..." occurrence, extract
    // the image ID, and synthesize the bare hi-res URL. Amazon serves the
    // bare URL (no _AC_*_ suffix) as the original full-size photo from any
    // CDN host. Dedup by image ID handles all the size/host variants.
    if (/amazon\./i.test(location.hostname)) {
      // Scope the scan to Amazon's main image-block container so we don't
      // pick up image IDs from color-variant swatches, related products,
      // sponsored carousels, "frequently bought together", etc. The full
      // alt-angle gallery (the only set we want) lives entirely within
      // #imageBlock or its newer variants. If none exist (rare layout
      // edge case), fall back to whole-document.
      const imageBlock =
          document.querySelector('#imageBlock_feature_div')
       ?? document.querySelector('#imageBlockNew_feature_div')
       ?? document.querySelector('#imageBlock')
       ?? document.querySelector('#booksImageBlock_feature_div')
       ?? document.querySelector('#main-image-container')
       ?? document.documentElement;
      const raw  = imageBlock.outerHTML.replace(/\\\//g, '/');
      const re   = /https?:\/\/([a-z0-9.-]*amazon[a-z0-9.-]*)\/images\/I\/([A-Za-z0-9+\-_]+)/gi;
      const seen = new Set();
      let added  = 0;
      let m;
      while ((m = re.exec(raw)) !== null) {
        const host = m[1];
        const id   = m[2];
        if (seen.has(id)) continue;
        seen.add(id);
        add(`https://${host}/images/I/${id}.jpg`, 95);
        added++;
      }
      console.info(`[ProductCopier] Amazon: scanned ${seen.size} unique image IDs from ${imageBlock === document.documentElement ? 'WHOLE DOC (no #imageBlock)' : '#' + imageBlock.id}, added ${added}`);

      // Also pick up data-a-dynamic-image (largest variant per element) and
      // data-old-hires — these surface even if the URL never appears in src.
      document.querySelectorAll('img[data-a-dynamic-image]').forEach(img => {
        const u = pickFromAmazonDynamic(img);
        if (u) { const abs = toAbs(u); if (abs) add(abs, 92); }
      });
      document.querySelectorAll('img[data-old-hires]').forEach(img => {
        const abs = toAbs(img.getAttribute('data-old-hires'));
        if (abs) add(abs, 92);
      });
    }

    // D. Description images (bundle products often use these as main visuals)
    // Reuses DESCRIPTION_SELECTORS so we never have a hard-coded duplicate.
    let descEl = null;
    for (const sel of DESCRIPTION_SELECTORS) {
      descEl = document.querySelector(sel);
      if (descEl) break;
    }
    if (descEl) {
      descEl.querySelectorAll('img').forEach(img => {
        if (pointsToOtherProduct(img)) return;
        const url = resolveImgSrc(img);
        const { w, h } = imgSize(img);
        // Larger description images are likely product visuals; smaller are icons
        if (url) add(url, (w >= 300 || h >= 300) ? 55 : 30);
      });
    }

    // E. Full-page fallback (only when gallery + JSON-LD gave fewer than 3 images)
    // Many sites (Carrefour Tailwind UI, custom React stores) don't match any
    // of our gallery selectors, so this branch carries the load. We must apply
    // BOTH filters here — junk-area for nav/footer, and other-product for
    // recommendation tiles.
    if (results.length < 3) {
      document.querySelectorAll('img').forEach(img => {
        const { w, h } = imgSize(img);
        if ((w && w < 200) || (h && h < 200)) return;
        if (isInJunkArea(img))         return;
        if (pointsToOtherProduct(img)) return;
        const url = resolveImgSrc(img);
        if (url) add(url, 20);
      });
    }

    // F. Open Graph / Twitter meta tags (last resort)
    document.querySelectorAll('meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"]').forEach((m, i) => {
      const abs = toAbs(m.content);
      if (abs) add(abs, 15 - i);
    });
    const tw = document.querySelector('meta[name="twitter:image"]');
    if (tw) {
      const abs = toAbs(tw.content);
      if (abs) add(abs, 10);
    }

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
