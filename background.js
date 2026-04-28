// background.js — Manifest V3 service worker
'use strict';

// Build stamp — bump on every change so we can verify in DevTools that the
// running service worker is the latest, not a leftover from before reload.
console.info('[ProductCopier] background.js build 5.4.9 (URL dedup before fetch + EXIF/alpha-safe webp reencode + 2000px cap)');

// ── Single source of truth for the Gemini model ──────────────────────────────
// Also referenced in options.js — keep both in sync if you change the model.
//
// Currently using gemini-3-flash-preview: warm latency (~380 ms) matches
// 2.5-flash, output quality on Arabic rewriting is at least as good, and
// it's the most modern Flash model in the v1beta catalogue. It is a PREVIEW
// release — Google may retire/rename it without the same SLA as a stable
// model. If reliability becomes an issue, swap to 'gemini-2.5-flash'
// (stable since June 2025) by changing this single line. Both support
// responseMimeType: "application/json" and the thinkingBudget toggle below.
const GEMINI_MODEL    = 'gemini-3-flash-preview';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── Tunable limits — one place to change, everywhere benefits ─────────────────
const LIMITS = Object.freeze({
  productImageBytes : 8_000_000,  // 8 MB max per product image
  descImageBytes    : 5_000_000,  // 5 MB max per description-embedded image
  imgFetchMs        : 10_000,     // 10 s timeout per product image
  descFetchMs       :  8_000,     //  8 s timeout per description image
  aiFetchMs         : 20_000,     // 20 s timeout for Gemini API call
  aiPromptChars     : 12_000,     // chars of HTML sent to Gemini
  maxProductImages  :  8,         // cap on images returned by AI
  imgBatchSize      :  3,         // parallel product-image fetches
  descBatchSize     :  2,         // parallel description-image fetches
});

// ── Image normalisation defaults (matches iblackstores.com brand style) ──────
// Square white-background canvas, product auto-cropped to its bounding box,
// height-fit into the canvas with a uniform 10% margin on each side. Combined
// with the height-fit scaling below, this gives every product a shared
// top/bottom baseline (matching the alignment in iblackstores listings)
// while still letting the product fill ~80% of the canvas — much like the
// real iblackstores product photos. The 3×3 alignment grid in the brand
// template is for rule-of-thirds *visual* alignment of the product's
// features, not a hard cage that the product must sit inside.
//
// Output is encoded as WebP, which compresses ~30% smaller than equivalent
// JPEG at the same visual quality, and supports transparency cleanly.
const IMAGE_NORMALIZE_DEFAULTS = Object.freeze({
  size         : 1000,             // output square edge length in px
  paddingPct   : 15,               // % margin on each side
                                   // (~70% product fill of the canvas)
  bg           : '#ffffff',        // background colour for the padded canvas
  format       : 'image/webp',     // output mime type — also drives extension
  quality      : 0.92,             // 0..1 — webp quality, 0.92 ≈ visually lossless
  bgThreshold  : 240,              // RGB ≥ this counts as "background" white
  alphaThreshold: 30,              // alpha < this counts as transparent (drop)
});

// ── Message router ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.action) {
    case 'fetchImages':
      // msg.normalize is forwarded from settings.normalizeImages (default true).
      // Set to false to bypass normalisation and ship the original bytes.
      fetchImagesBatched(msg.urls, msg.normalize !== false)
        .then(sendResponse)
        .catch(() => sendResponse([]));
      return true;   // keep port open for async response

    case 'aiExtract':
      // Legacy — retained so an older popup version can still talk to a
      // newer service worker during a partial reload. New code uses aiRewrite.
      aiExtractGemini(msg.html, msg.url, msg.apiKey, msg.rewriteRules)
        .then(sendResponse)
        .catch(e => sendResponse({ error: e.message }));
      return true;

    case 'aiRewrite':
      aiRewriteGemini(msg.title, msg.description, msg.sourceUrl, msg.apiKey, msg.rewriteRules)
        .then(sendResponse)
        .catch(e => sendResponse({ error: e.message }));
      return true;

    case 'fetchDescriptionImages':
      embedDescImages(msg.html)
        .then(sendResponse)
        .catch(() => sendResponse({ html: msg.html }));
      return true;
  }
  return false;  // synchronous — no response needed
});

// ── Shared fetch helper ───────────────────────────────────────────────────────
// Previously: fetchOne() and the inner closure of embedDescImages() each had
// their own fetch → resp.ok check → blob → size check → FileReader pipeline.
// Now there is exactly ONE place that does this.
//
// Returns { base64: string, mimeType: string, blob: Blob } or null on any failure.
async function fetchAsBase64(url, maxBytes, timeoutMs) {
  const abs = url.startsWith('//') ? `https:${url}` : url;
  try {
    const resp = await fetch(abs, {
      method      : 'GET',
      credentials : 'omit',
      cache       : 'force-cache',
      headers     : { Accept: 'image/*,*/*;q=0.8' },
      signal      : AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    if (!blob?.size || blob.size > maxBytes) return null;
    const mimeType = blob.type || guessMime(abs);
    return { base64: await blobToBase64(blob), mimeType, blob };
  } catch { return null; }
}

// ── Image normalisation (auto-crop + pad to square + WebP) ───────────────────
// Why? The merchant uploads to Salla need a consistent visual style — square
// canvas, white background, product centred with a uniform margin, in the same
// modern format. Customer-facing CDN images from Amazon/eBay/AliExpress vary
// wildly in aspect ratio, padding, and format (JPG/PNG/etc.). This function
// normalises any input image to match the iblackstores brand defaults.
//
// Algorithm:
//   1. createImageBitmap(blob) — Chrome's fast image decoder, works in SW
//   2. Draw to an OffscreenCanvas at native size and read pixel data
//   3. Find the product's bounding box by ignoring near-white & transparent
//      pixels (sample every 4 px for speed; ~16x faster, still pixel-accurate
//      to within 4 px which is invisible at 1000 px output)
//   4. Compute a target box on a `size×size` canvas with `paddingPct` margin
//   5. Draw the cropped region scaled to fit, centred, on a white background
//   6. Encode as WebP via convertToBlob (better compression than JPEG, lossy
//      enough at q=0.92 to be visually lossless for product photos)
//
// Returns a NEW { base64, mimeType, blob } — original blob is discarded.
// On any failure (decode, OOM, no pixels found) returns the original input.
async function normalizeImageBlob(input, opts = {}, label = '') {
  const o = { ...IMAGE_NORMALIZE_DEFAULTS, ...opts };
  const start = Date.now();
  try {
    if (!input?.blob) return input;
    const inputBytes = input.blob.size;
    const bitmap = await createImageBitmap(input.blob);

    // ── Pass 1: read pixels of the source to find the product bounding box ──
    const src = new OffscreenCanvas(bitmap.width, bitmap.height);
    const sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(bitmap, 0, 0);
    const px = sctx.getImageData(0, 0, src.width, src.height).data;

    let minX = src.width, minY = src.height, maxX = 0, maxY = 0;
    let found = false;
    const isBg = (r, g, b, a) =>
      a < o.alphaThreshold ||
      (r >= o.bgThreshold && g >= o.bgThreshold && b >= o.bgThreshold);
    // Sample every 4th pixel — 16x faster than full scan, accuracy ~4 px
    for (let y = 0; y < src.height; y += 4) {
      for (let x = 0; x < src.width; x += 4) {
        const i = (y * src.width + x) * 4;
        if (!isBg(px[i], px[i + 1], px[i + 2], px[i + 3])) {
          if (x < minX) minX = x; if (y < minY) minY = y;
          if (x > maxX) maxX = x; if (y > maxY) maxY = y;
          found = true;
        }
      }
    }
    // If the whole image is "background" (transparent / pure white) just use
    // the full canvas as the product. Avoids divide-by-zero downstream.
    if (!found || maxX <= minX || maxY <= minY) {
      minX = 0; minY = 0; maxX = src.width - 1; maxY = src.height - 1;
    }
    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;

    // ── Pass 2: render onto a white square canvas with uniform padding ──────
    const out = new OffscreenCanvas(o.size, o.size);
    const octx = out.getContext('2d');
    octx.fillStyle = o.bg;
    octx.fillRect(0, 0, o.size, o.size);

    // Available area after applying the padding margin
    const inner = o.size * (1 - 2 * o.paddingPct / 100);
    // Height-prefer scaling so every normalised image has the SAME vertical
    // extent — which makes them line up on shared top + bottom baselines in
    // the iblackstores listing grid. Wide products (>1:1 aspect) fall back to
    // width-fit so they don't overflow the canvas; this only affects edge
    // cases like sound bars / monitors / car-grilles, while the common
    // square / portrait product case stays height-normalised.
    let scale = inner / cropH;                  // step 1: fit by height
    if (cropW * scale > inner) scale = inner / cropW; // step 2: clamp if too wide
    const drawW = cropW * scale;
    const drawH = cropH * scale;
    const dx = (o.size - drawW) / 2;
    const dy = (o.size - drawH) / 2;
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(bitmap, minX, minY, cropW, cropH, dx, dy, drawW, drawH);
    bitmap.close?.();

    // ── Encode and return ──
    const newBlob = await out.convertToBlob({ type: o.format, quality: o.quality });
    const ms = Date.now() - start;
    const inKB  = (inputBytes / 1024) | 0;
    const outKB = (newBlob.size / 1024) | 0;
    const fitMode = scale === inner / cropH ? 'height-fit' : 'width-clamped';
    console.info(
      `[ProductCopier] 🎨 normalised ${label || 'image'}: ` +
      `${bitmap.width}×${bitmap.height} ${input.mimeType.replace('image/','')} (${inKB} KB) → ` +
      `${o.size}×${o.size} ${o.format.replace('image/','')} (${outKB} KB), ` +
      `crop ${cropW}×${cropH}, draw ${drawW|0}×${drawH|0} (${fitMode}), found=${found}, ${ms}ms`
    );
    return {
      base64   : await blobToBase64(newBlob),
      mimeType : o.format,
      blob     : newBlob,
    };
  } catch (e) {
    console.warn(`[ProductCopier] ⚠️ normalise failed for ${label || 'image'} (using original):`, e?.message);
    return input;
  }
}

// ── Product image batch fetch ─────────────────────────────────────────────────
// `normalize` controls whether the FIRST image goes through normalizeImageBlob
// (auto-crop → pad to square → WebP). Only the first image is normalised
// because Salla shows it as the product card thumbnail — that's where the
// brand-style framing matters most. Subsequent gallery images keep their
// original size, format, and framing so detail / context shots aren't
// destructively recropped.
async function fetchImagesBatched(urls, normalize = true) {
  if (!urls?.length) return [];
  // Dedup exact-URL duplicates BEFORE fetching. The DOM scraper's per-source
  // dedup (computeImageBase) handles size-variant URLs, but identical URLs
  // can still slip through when the same image appears as e.g. <#landingImage>
  // AND og:image AND a script-block reference. Without this guard the cover
  // image's source URL would also become image #2 (raw, un-normalised).
  const before = urls.length;
  urls = [...new Set(urls)];
  if (urls.length < before) {
    console.info(`[ProductCopier] 🧹 deduped ${before - urls.length} duplicate URL(s) before fetch`);
  }
  const start = Date.now();
  console.info(`[ProductCopier] 📥 fetching ${urls.length} image(s), normalize-first=${normalize}`);
  const out = [];
  for (let i = 0; i < urls.length; i += LIMITS.imgBatchSize) {
    const batch   = urls.slice(i, i + LIMITS.imgBatchSize);
    const settled = await Promise.allSettled(
      // Only image #0 (the cover / first gallery slot in Salla) gets normalised.
      batch.map((url, j) => fetchProductImage(url, i + j, normalize && (i + j) === 0))
    );
    settled.forEach(r => { if (r.status === 'fulfilled' && r.value) out.push(r.value); });
  }
  const ms = Date.now() - start;
  // Summary log so the user can confirm at a glance: how many succeeded,
  // what total bytes are being shipped, and what format they're in.
  const totalKB = out.reduce((s, im) => s + Math.ceil((im.base64?.length ?? 0) * 0.75 / 1024), 0);
  const formats = [...new Set(out.map(im => im.mimeType.replace('image/','')))].join('+');
  console.info(
    `[ProductCopier] ✅ batch done: ${out.length}/${urls.length} ok, ` +
    `~${totalKB} KB total, format=${formats || '–'}, ${ms}ms`
  );
  return out;
}

async function fetchProductImage(url, idx, normalize = true) {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;
  let result = await fetchAsBase64(url, LIMITS.productImageBytes, LIMITS.imgFetchMs);
  if (!result) {
    console.warn(`[ProductCopier] ⚠️ fetch failed for image #${idx + 1}: ${url}`);
    return null;
  }
  if (normalize) {
    // Cover image — full brand normalisation: auto-crop → centre on a white
    // 1000×1000 square with 15% margin → encode as WebP.
    result = await normalizeImageBlob(result, {}, `image #${idx + 1}`);
  } else {
    // Gallery images — keep the original dimensions and framing (so detail
    // shots / infographics / lifestyle photos aren't destructively cropped),
    // but still re-encode as WebP for consistent format + smaller payload.
    result = await reencodeAsWebP(result, `image #${idx + 1}`);
  }
  const ext = mimeToExt(result.mimeType);
  // Drop the temp Blob from the returned object so we don't ship it across
  // the message boundary (Blobs aren't structured-cloneable to popup pages).
  return {
    base64     : result.base64,
    mimeType   : result.mimeType,
    filename   : `product-${idx + 1}.${ext}`,
    originalUrl: url,
  };
}

// ── WebP-only re-encode (no crop, no resize, except a safety dimension cap) ──
// Used for gallery images 2..N where we want a uniform output format but
// must preserve the original framing.
//
// Three things kept us from a clean encode in the first cut:
//   1. EXIF orientation — JPEGs from phones often carry a rotation flag.
//      We pass `imageOrientation: 'from-image'` so the bitmap is upright in
//      memory and the canvas writes it that way (otherwise it'd come out
//      sideways and look "distorted").
//   2. Premultiplied alpha — the default sometimes muddies edges of PNG-
//      with-transparency. Setting it to 'none' preserves edges crisply.
//   3. Huge source images — some CDNs return 4000×6000 raw photos. An
//      OffscreenCanvas that big can fail silently or burn memory. We cap
//      the longest side at 2000 px while preserving aspect ratio.
const REENCODE_MAX_DIM = 2000;
async function reencodeAsWebP(input, label = '') {
  if (!input?.blob) return input;
  if (input.mimeType === 'image/webp') {
    console.info(
      `[ProductCopier] 📷 ${label || 'image'} already webp, ` +
      `${(input.blob.size / 1024) | 0} KB — passing through`
    );
    return input;
  }
  const start = Date.now();
  let bitmap;
  try {
    bitmap = await createImageBitmap(input.blob, {
      imageOrientation     : 'from-image',
      premultiplyAlpha     : 'none',
      colorSpaceConversion : 'default',
    });

    // Cap longest side at REENCODE_MAX_DIM, preserving aspect ratio.
    let w = bitmap.width;
    let h = bitmap.height;
    let scaled = false;
    const longest = Math.max(w, h);
    if (longest > REENCODE_MAX_DIM) {
      const s = REENCODE_MAX_DIM / longest;
      w = Math.round(w * s);
      h = Math.round(h * s);
      scaled = true;
    }

    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { alpha: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await c.convertToBlob({
      type    : 'image/webp',
      quality : IMAGE_NORMALIZE_DEFAULTS.quality,
    });
    const ms    = Date.now() - start;
    const inKB  = (input.blob.size / 1024) | 0;
    const outKB = (blob.size / 1024)       | 0;
    console.info(
      `[ProductCopier] 📷 reencoded ${label || 'image'}: ` +
      `${bitmap.width}×${bitmap.height} ${input.mimeType.replace('image/','')} (${inKB} KB) → ` +
      `${w}×${h} webp (${outKB} KB)${scaled ? ' [scaled to fit cap]' : ''}, ${ms}ms`
    );
    return { base64: await blobToBase64(blob), mimeType: 'image/webp', blob };
  } catch (e) {
    bitmap?.close?.();
    console.warn(`[ProductCopier] ⚠️ reencode failed for ${label || 'image'} (using original):`, e?.message);
    return input;
  }
}

// ── Description image embedding ───────────────────────────────────────────────
// Why scope replacement to the <img src="..."> attribute instead of a global
// string replace? Two CDN URLs can share a prefix (e.g. img.png and
// img.png?w=500). A global split/join on the prefix would corrupt the longer
// URL. Operating at the tag-then-attribute level guarantees no collision.
async function embedDescImages(html) {
  if (!html) return { html: '' };

  const allSrcs = [...html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  const toFetch = [...new Set(allSrcs.filter(u => u && !u.startsWith('data:') && !u.startsWith('blob:')))];
  if (!toFetch.length) return { html };

  const urlMap = new Map();
  for (let i = 0; i < toFetch.length; i += LIMITS.descBatchSize) {
    const batch   = toFetch.slice(i, i + LIMITS.descBatchSize);
    const settled = await Promise.allSettled(batch.map(async url => {
      const res = await fetchAsBase64(url, LIMITS.descImageBytes, LIMITS.descFetchMs);
      return res ? { url, dataUrl: `data:${res.mimeType};base64,${res.base64}` } : null;
    }));
    settled.forEach(r => { if (r.status === 'fulfilled' && r.value) urlMap.set(r.value.url, r.value.dataUrl); });
  }

  // For every <img …> tag, rewrite its src attribute only when we have a
  // replacement. Function-form replace avoids `$n` interpolation issues that
  // could arise if the data URL ever contained backreference syntax.
  const out = html.replace(/<img\b[^>]*?>/gi, tag =>
    tag.replace(/(\bsrc\s*=\s*)(["'])([^"']+)\2/i, (full, pre, q, src) =>
      urlMap.has(src) ? `${pre}${q}${urlMap.get(src)}${q}` : full
    )
  );
  return { html: out };
}

// ── Gemini AI extraction ──────────────────────────────────────────────────────
// rewriteRules is optional. When present and enabled, a single Gemini call
// both extracts AND rewrites — no second round-trip needed.
async function aiExtractGemini(pageHtml, pageUrl, apiKey, rewriteRules = null) {
  if (!apiKey) throw new Error('مفتاح Gemini API مفقود');

  const cleanHtml  = stripForAI(pageHtml);
  const useRewrite = rewriteRules?.enabled && (rewriteRules.titleRules || rewriteRules.descRules || rewriteRules.examples);
  const prompt     = useRewrite
    ? buildRewritePrompt(pageUrl, cleanHtml, rewriteRules)
    : buildExtractPrompt(pageUrl, cleanHtml);

  // Rewriting requires more creative latitude than pure extraction.
  const temperature    = useRewrite ? 0.4 : 0.1;
  // Rewritten descriptions can be longer than raw-extracted ones.
  const maxOutputTokens = useRewrite ? 2048 : 1024;

  // Send the key as a header so it doesn't show up in service-worker request
  // logs / browser network history. Both auth methods are accepted by Google.
  //
  // Two important generationConfig flags:
  //   responseMimeType: "application/json"
  //     Asks Gemini to constrain output to a single valid JSON document.
  //     Eliminates markdown-fence/prose-prefix parsing that the old
  //     "ask for JSON in the prompt" approach was vulnerable to.
  //   thinkingConfig.thinkingBudget: 0
  //     Gemini 2.5+ Flash defaults to "thinking" mode which silently
  //     consumes output tokens on hidden chain-of-thought before producing
  //     visible text. For deterministic JSON extraction we don't need it,
  //     and it would otherwise truncate our maxOutputTokens budget.
  const resp = await fetch(GEMINI_ENDPOINT, {
    method  : 'POST',
    headers : {
      'Content-Type'  : 'application/json',
      'x-goog-api-key': apiKey,
    },
    body    : JSON.stringify({
      contents         : [{ parts: [{ text: prompt }] }],
      generationConfig : {
        temperature,
        maxOutputTokens,
        responseMimeType : 'application/json',
        thinkingConfig   : { thinkingBudget: 0 },
      },
    }),
    signal  : AbortSignal.timeout(LIMITS.aiFetchMs),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Gemini HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const text = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
  const parsed = parseGeminiJson(text, 'aiExtractGemini');
  // We deliberately drop parsed.images even if Gemini returns one — popup.js
  // pairs this AI text with images from the DOM scraper, which is more
  // reliable. See buildExtractPrompt comment for why.
  return {
    title       : (parsed.title       ?? '').trim(),
    description : (parsed.description ?? '').trim(),
    aiRewritten : useRewrite,
  };
}

// ── Gemini AI rewrite (paste-time) ───────────────────────────────────────────
// Purpose: transform an already-extracted title + description into the user's
// store style. The DOM scraper has already done the hard work — Gemini just
// translates to Arabic (if needed) and applies the rules + examples.
//
// Why a separate function from aiExtractGemini?
//   The extract path needs the entire page HTML (12 KB) for context. The
//   rewrite path needs only the structured title + description, which is
//   typically <2 KB. This makes the rewrite prompt ~5x cheaper and ~3x faster.
async function aiRewriteGemini(title, description, sourceUrl, apiKey, rewriteRules) {
  if (!apiKey) throw new Error('مفتاح Gemini API مفقود');
  if (!rewriteRules || (!rewriteRules.titleRules && !rewriteRules.descRules && !rewriteRules.examples)) {
    throw new Error('لا توجد قواعد إعادة كتابة محفوظة');
  }
  if (!title?.trim()) throw new Error('لا يوجد عنوان لإعادة كتابته');

  const prompt = buildRewriteOnlyPrompt(title, description, sourceUrl, rewriteRules);

  const resp = await fetch(GEMINI_ENDPOINT, {
    method  : 'POST',
    headers : {
      'Content-Type'  : 'application/json',
      'x-goog-api-key': apiKey,
    },
    body    : JSON.stringify({
      contents         : [{ parts: [{ text: prompt }] }],
      generationConfig : {
        temperature      : 0.4,           // creative latitude for rewriting
        maxOutputTokens  : 2048,
        responseMimeType : 'application/json',
        thinkingConfig   : { thinkingBudget: 0 },
      },
    }),
    signal  : AbortSignal.timeout(LIMITS.aiFetchMs),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Gemini HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const text = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
  const parsed = parseGeminiJson(text, 'aiRewriteGemini');
  return {
    title       : (parsed.title       ?? '').trim(),
    description : (parsed.description ?? '').trim(),
    aiRewritten : true,
  };
}

// ── Prompt: rewrite-only ─────────────────────────────────────────────────────
// Takes the already-extracted title + description (not raw HTML) and asks
// Gemini to produce the same product in the store's voice. Much shorter than
// the extract+rewrite prompt because we skip the 12 KB of page HTML.
function buildRewriteOnlyPrompt(title, description, sourceUrl, rules) {
  const titleRulesBlock = rules.titleRules?.trim()
    ? `\nقواعد العنوان:\n${rules.titleRules.trim()}`
    : '';

  const descRulesBlock = rules.descRules?.trim()
    ? `\nقواعد الوصف:\n${rules.descRules.trim()}`
    : '';

  const examplesBlock = rules.examples?.trim()
    ? `\n\nأمثلة من المتجر (استخدمها لفهم الأسلوب المطلوب، لا تنسخها):\n${rules.examples.trim()}`
    : '';

  // Trim very long extracted descriptions so we don't waste tokens on noise.
  const safeDesc = (description ?? '').slice(0, 4000);

  return `أنت خبير في كتابة محتوى المنتجات للتجارة الإلكترونية بالعربية مع خبرة في SEO.

مهمتك:
1. ترجم العنوان والوصف إلى العربية إن لم يكونا بها
2. أعد كتابة العنوان والوصف بالعربية وفق القواعد والأمثلة أدناه
3. حسّن النص لـ SEO العربي: أدرج الكلمات المفتاحية بشكل طبيعي في النص، لا تكرارها بشكل مبالغ${titleRulesBlock}${descRulesBlock}${examplesBlock}

${sourceUrl ? `المصدر الأصلي: ${sourceUrl}\n` : ''}العنوان الأصلي:
${title}

الوصف الأصلي (HTML):
${safeDesc}

أرجع JSON بهذا الشكل:
{"title":"العنوان بالعربية","description":"الوصف HTML بالعربية مع الحفاظ على <p>, <ul>, <li>, <strong>"}`;
}

// ── Prompt: extract only (no rewrite) ────────────────────────────────────────
// We deliberately ask for only title + description, NOT images. The DOM
// scraper handles images far more reliably than Gemini does — Gemini tends
// to hallucinate URLs from CSS sprite identifiers, srcset fragments, and
// other DOM noise. popup.js merges DOM-extracted images with this AI text.
function buildExtractPrompt(url, html) {
  return `You are a product data extractor. Extract info from this e-commerce page HTML.
URL: ${url}
HTML: ${html.slice(0, LIMITS.aiPromptChars)}
Return JSON in this shape:
{"title":"product name in original language","description":"clean HTML description preserving <p>, <ul>, <li>, <strong>, <em>"}
Rules: description should be the actual product description from the page (features, specs, marketing copy) — NOT just the title repeated. If no real description exists, return an empty string for description.`;
}

// ── Prompt: extract + translate + rewrite + SEO (single call) ────────────────
// Everything happens in one Gemini call:
//   1. Extract raw product data from the page HTML (any language)
//   2. Translate title and description to Arabic
//   3. Rewrite using the store's title rules, description rules, and examples
//   4. Optimise for Arabic Google SEO (natural keyword integration, not stuffed)
function buildRewritePrompt(url, html, rules) {
  const examplesBlock = rules.examples?.trim()
    ? `\n\nأمثلة من المتجر (استخدمها لفهم الأسلوب المطلوب، لا تنسخها):\n${rules.examples.trim()}`
    : '';

  const titleRulesBlock = rules.titleRules?.trim()
    ? `\nقواعد العنوان:\n${rules.titleRules.trim()}`
    : '';

  const descRulesBlock = rules.descRules?.trim()
    ? `\nقواعد الوصف:\n${rules.descRules.trim()}`
    : '';

  return `أنت خبير في كتابة محتوى المنتجات للتجارة الإلكترونية بالعربية مع خبرة في SEO.

مهمتك:
1. استخرج بيانات المنتج من HTML أدناه (قد يكون المحتوى بالصينية أو الإنجليزية أو العربية)
2. ترجم العنوان والوصف إلى العربية إن لم يكونا بها
3. أعد كتابة العنوان والوصف بالعربية وفق القواعد والأمثلة أدناه
4. حسّن النص لـ SEO العربي: أدرج الكلمات المفتاحية بشكل طبيعي في النص، لا تكرارها بشكل مبالغ${titleRulesBlock}${descRulesBlock}${examplesBlock}

URL: ${url}
HTML:
${html.slice(0, LIMITS.aiPromptChars)}

أرجع JSON بهذا الشكل (بدون الصور — يتولى استخراجها مكوّن آخر):
{"title":"العنوان بالعربية","description":"الوصف HTML بالعربية مع الحفاظ على <p>, <ul>, <li>, <strong>"}`;
}

// ── HTML stripping ────────────────────────────────────────────────────────────
// Removes scripts, styles, nav, footer etc. before sending to AI.
// Typical saving: ~70% of raw HTML tokens.
function stripForAI(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(header|nav|footer|aside|iframe|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/\s{3,}/g, ' ')
    .replace(/\n{3,}/g, '\n');
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror   = reject;
    reader.readAsDataURL(blob);
  });
}

function guessMime(url) {
  const lower = url.toLowerCase();
  if (lower.includes('.png'))  return 'image/png';
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.gif'))  return 'image/gif';
  if (lower.includes('.avif')) return 'image/avif';
  if (lower.includes('.svg'))  return 'image/svg+xml';
  return 'image/jpeg';
}

// MIME → file extension. Centralised so adding a new format is one line.
// Avoids the previous bug where 'image/svg+xml' produced a 'svg+xml' filename.
function mimeToExt(mime) {
  const map = {
    'image/jpeg'    : 'jpg',
    'image/jpg'     : 'jpg',
    'image/png'     : 'png',
    'image/webp'    : 'webp',
    'image/gif'     : 'gif',
    'image/avif'    : 'avif',
    'image/bmp'     : 'bmp',
    'image/svg+xml' : 'svg',
  };
  return map[mime?.toLowerCase()] ?? 'jpg';
}

// Robust JSON extraction from Gemini's response.
//   - Strips ``` and ```json fences
//   - Walks the string looking for the FIRST balanced { ... } block
//     (the previous `/\{[\s\S]*\}/` was greedy and would over-match when
//     Gemini returned multiple JSON-like fragments separated by prose).
function extractJSON(text) {
  if (!text) return null;
  const cleaned = text
    .replace(/^\s*```(?:json|JSON)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') { if (start === -1) start = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) return cleaned.slice(start, i + 1);
    }
  }
  return null;
}

// Robustly parse a Gemini text response into an object, tolerating:
//   - trailing prose / whitespace / a second JSON object (Gemini sometimes
//     emits the rewritten product followed by an "explanation" object)
//   - markdown ```json fences
//   - whitespace around the object
// Throws with a helpful diagnostic that includes the raw response (truncated)
// when neither a direct parse nor extractJSON yields valid JSON.
function parseGeminiJson(text, context = 'gemini') {
  if (!text) throw new Error('Gemini لم يُرجع JSON صالحاً (استجابة فارغة)');

  // Strategy 1: try parsing the trimmed text directly. Works for the common
  // case of a clean { ... } body.
  try { return JSON.parse(text); } catch { /* fall through */ }

  // Strategy 2: walk the string with a brace-balanced parser to find the
  // first complete top-level object, then parse just that. This handles
  // trailing content of any shape: prose, second object, stray characters.
  const candidate = extractJSON(text);
  if (candidate) {
    try { return JSON.parse(candidate); } catch (e) {
      console.warn(
        `[ProductCopier] ❌ ${context}: extracted JSON failed to parse:`,
        e.message,
        '\nextracted:', candidate.slice(0, 500),
        '\nraw response (first 500 chars):', text.slice(0, 500)
      );
    }
  }

  // Strategy 3: give up. Surface the raw response so we can diagnose later.
  console.warn(
    `[ProductCopier] ❌ ${context}: could not recover JSON from response. ` +
    `Raw response (first 800 chars):\n${text.slice(0, 800)}`
  );
  throw new Error('Gemini لم يُرجع JSON صالحاً');
}
