// background.js — Manifest V3 service worker
'use strict';

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

// ── Message router ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.action) {
    case 'fetchImages':
      fetchImagesBatched(msg.urls)
        .then(sendResponse)
        .catch(() => sendResponse([]));
      return true;   // keep port open for async response

    case 'aiExtract':
      aiExtractGemini(msg.html, msg.url, msg.apiKey, msg.rewriteRules)
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
// Returns { base64: string, mimeType: string } or null on any failure.
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
    return { base64: await blobToBase64(blob), mimeType };
  } catch { return null; }
}

// ── Product image batch fetch ─────────────────────────────────────────────────
async function fetchImagesBatched(urls) {
  if (!urls?.length) return [];
  const out = [];
  for (let i = 0; i < urls.length; i += LIMITS.imgBatchSize) {
    const batch   = urls.slice(i, i + LIMITS.imgBatchSize);
    const settled = await Promise.allSettled(
      batch.map((url, j) => fetchProductImage(url, i + j))
    );
    settled.forEach(r => { if (r.status === 'fulfilled' && r.value) out.push(r.value); });
  }
  return out;
}

async function fetchProductImage(url, idx) {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;
  const result = await fetchAsBase64(url, LIMITS.productImageBytes, LIMITS.imgFetchMs);
  if (!result) return null;
  const ext = mimeToExt(result.mimeType);
  return { ...result, filename: `product-${idx + 1}.${ext}`, originalUrl: url };
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
  // With responseMimeType=application/json the body is already a valid JSON
  // document, but extractJSON() is kept as belt-and-suspenders for any model
  // that ignores the directive and returns prose.
  const jsonStr = text.startsWith('{') && text.endsWith('}') ? text : extractJSON(text);
  if (!jsonStr) throw new Error('Gemini لم يُرجع JSON صالحاً');

  const parsed = JSON.parse(jsonStr);
  // We deliberately drop parsed.images even if Gemini returns one — popup.js
  // pairs this AI text with images from the DOM scraper, which is more
  // reliable. See buildExtractPrompt comment for why.
  return {
    title       : (parsed.title       ?? '').trim(),
    description : (parsed.description ?? '').trim(),
    aiRewritten : useRewrite,
  };
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
