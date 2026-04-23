// popup.js
'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// BusyButton
// Encapsulates the spinner / icon / label state for a single action button.
// Previously: setBusy() and setIdle() each took 5 arguments and were called
// with the same 4 DOM refs every single time. Now the refs are bound once.
// ══════════════════════════════════════════════════════════════════════════════
class BusyButton {
  constructor({ btn, spinner, icon, label }) {
    this._btn     = btn;
    this._spinner = spinner;
    this._icon    = icon;
    this._label   = label;
  }

  busy(msg) {
    this._btn.disabled = true;
    this._spinner.classList.add('on');
    this._icon.style.display = 'none';
    this._label.textContent  = msg;
  }

  idle(msg) {
    this._btn.disabled = false;
    this._spinner.classList.remove('on');
    this._icon.style.display = '';
    this._label.textContent  = msg;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ProgressBar
// Thin wrapper so callers don't need to reach into sub-elements directly.
// ══════════════════════════════════════════════════════════════════════════════
class ProgressBar {
  constructor({ wrap, fill, label }) {
    this._wrap  = wrap;
    this._fill  = fill;
    this._label = label;
  }

  show(pct, msg) {
    this._wrap.classList.add('on');
    this._fill.style.width    = `${pct}%`;
    this._label.textContent   = msg;
  }

  hide() { this._wrap.classList.remove('on'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// UI helpers
// ══════════════════════════════════════════════════════════════════════════════
function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className   = `status on ${type}`;
}
function clearStatus(el) { el.className = 'status'; }

function showPreview(data) {
  document.getElementById('previewTitle').textContent = data.title || 'بدون عنوان';
  document.getElementById('previewBadges').innerHTML  =
    `<span class="pbadge pbadge-blue">📷 ${data.images?.length ?? 0} صورة</span>` +
    `<span class="pbadge pbadge-green">📝 ${data.description ? 'وصف ✓' : 'لا وصف'}</span>` +
    (data.aiExtracted  ? '<span class="pbadge pbadge-purple">🤖 AI</span>'   : '') +
    (data.aiRewritten  ? '<span class="pbadge pbadge-orange">✍️ مُعاد كتابته</span>' : '');
  document.getElementById('preview').classList.add('on');
}

function setPasteReady(hasData) {
  document.getElementById('btnPaste').disabled        = !hasData;
  document.getElementById('btnClear').style.display   = hasData ? 'block' : 'none';
}

// ══════════════════════════════════════════════════════════════════════════════
// Wire up BusyButton / ProgressBar instances
// ══════════════════════════════════════════════════════════════════════════════
const copyBtn  = new BusyButton({
  btn    : document.getElementById('btnCopy'),
  spinner: document.getElementById('copySpinner'),
  icon   : document.getElementById('copyIcon'),
  label  : document.getElementById('copyLabel'),
});
const pasteBtn = new BusyButton({
  btn    : document.getElementById('btnPaste'),
  spinner: document.getElementById('pasteSpinner'),
  icon   : document.getElementById('pasteIcon'),
  label  : document.getElementById('pasteLabel'),
});
const copyBar  = new ProgressBar({
  wrap : document.getElementById('copyProgress'),
  fill : document.getElementById('copyProgressFill'),
  label: document.getElementById('copyProgressLabel'),
});
const pasteBar = new ProgressBar({
  wrap : document.getElementById('pasteProgress'),
  fill : document.getElementById('pasteProgressFill'),
  label: document.getElementById('pasteProgressLabel'),
});

const copyStatus  = document.getElementById('copyStatus');
const pasteStatus = document.getElementById('pasteStatus');
const aiToggle    = document.getElementById('aiToggle');

// ══════════════════════════════════════════════════════════════════════════════
// Initialise on popup open
// ══════════════════════════════════════════════════════════════════════════════
async function init() {
  const { productData, settings, geminiKey } =
    await chrome.storage.local.get(['productData', 'settings', 'geminiKey']);

  if (productData) {
    showPreview(productData);
    setPasteReady(true);
  }

  // AI toggle: enabled only when a key exists AND useAI is not explicitly off
  aiToggle.checked = !!(geminiKey && settings?.useAI !== false);
  if (!geminiKey) {
    aiToggle.disabled     = true;
    aiToggle.parentElement.title = 'أضف مفتاح API في الإعدادات';
  }
}
init();

document.getElementById('btnSettings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ══════════════════════════════════════════════════════════════════════════════
// COPY
// ══════════════════════════════════════════════════════════════════════════════
document.getElementById('btnCopy').addEventListener('click', async () => {
  clearStatus(copyStatus);
  copyBtn.busy('جاري الاستخراج...');
  copyBar.hide();

  try {
    const { settings, geminiKey, rewriteRules } =
      await chrome.storage.local.get(['settings', 'geminiKey', 'rewriteRules']);

    const useAI          = aiToggle.checked && !!geminiKey;
    const imgLimit       = settings?.imgLimit       ?? 8;
    const embedDescImgs  = settings?.embedDescImages !== false;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // ── Extract product data (AI or DOM) ──────────────────────────────────────
    let productData;
    if (useAI) {
      productData = await extractWithAI(tab, geminiKey, imgLimit, rewriteRules ?? null);
    } else {
      productData = await extractWithDOM(tab, imgLimit);
    }

    if (!productData?.title) {
      copyBar.hide();
      setStatus(copyStatus, '❌ لم يتم العثور على بيانات منتج.\nتأكد أنك على صفحة منتج.', 'error');
      return;
    }

    // ── Embed description images (optional) ──────────────────────────────────
    copyBar.show(80, `📥 جاري تحميل ${productData.images?.length ?? 0} صورة...`);
    if (embedDescImgs && productData.description) {
      const res = await chrome.runtime.sendMessage({
        action: 'fetchDescriptionImages',
        html  : productData.description,
      });
      productData.description = res?.html ?? productData.description;
    }

    // ── Persist and update UI ─────────────────────────────────────────────────
    copyBar.show(100, '✅ اكتمل!');
    await chrome.storage.local.set({ productData });
    showPreview(productData);
    setPasteReady(true);

    const aiNote = productData.aiExtracted ? ' (AI 🤖)' : '';
    setStatus(
      copyStatus,
      `✅ تم النسخ${aiNote}!\n` +
      `📷 ${productData.images?.length ?? 0} صورة\n` +
      `📝 الوصف: ${productData.description ? '✓' : '✗'}`,
      'success'
    );

  } catch (err) {
    console.error('[Copy]', err);
    setStatus(copyStatus, `❌ خطأ: ${err.message}`, 'error');
  } finally {
    copyBtn.idle('نسخ من هذه الصفحة');
    setTimeout(() => copyBar.hide(), 1500);
  }
});

// ── AI extraction path (hybrid) ───────────────────────────────────────────────
// Why hybrid?
//   The DOM scraper (content_copy.js) is rock-solid for image URLs because it
//   queries the live DOM and validates extensions/CDN patterns. Gemini, in
//   contrast, regularly hallucinates image URLs on complex pages — most
//   visibly on Amazon, where it confuses CSS-sprite identifiers like
//   "11WsGYSItxL._RC|01DE6WSvLKL.css,..." for product images.
//
// So we always run the DOM extractor for images, and use Gemini purely for
// text quality (translation + Arabic rewriting + cleaner descriptions).
async function extractWithAI(tab, geminiKey, imgLimit, rewriteRules) {
  const willRewrite = rewriteRules?.enabled;
  copyBar.show(20, '🔍 جاري تحليل الصفحة...');

  // 1. DOM extraction first — gives us reliable images regardless of AI outcome
  const domResult = await extractWithDOM(tab, imgLimit);

  copyBar.show(40, willRewrite ? '✍️ جاري الاستخراج وإعادة الكتابة...' : '🤖 جاري تحليل الصفحة...');

  // 2. Pull page HTML for Gemini text processing
  const [{ result: pageHtml }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func  : () => document.documentElement.outerHTML,
  });

  copyBar.show(50, willRewrite ? '✍️ Gemini يعيد كتابة المنتج...' : '🤖 Gemini يعالج البيانات...');

  const aiResult = await chrome.runtime.sendMessage({
    action: 'aiExtract', html: pageHtml, url: tab.url, apiKey: geminiKey, rewriteRules,
  });

  if (aiResult?.error) {
    // Soft fallback — inform the user but don't abort. DOM result still useful.
    setStatus(copyStatus, `⚠️ AI فشل (${aiResult.error})، استخدام نتيجة DOM`, 'warn');
    return domResult;
  }

  copyBar.show(70, '✅ AI أنهى المعالجة...');

  // 3. Merge: AI for text (when non-empty and meaningful), DOM for images.
  //    Guards against AI returning the title duplicated as description, which
  //    happens when the page's real description isn't in the first 12k chars.
  const aiTitle = aiResult.title?.trim();
  const aiDesc  = aiResult.description?.trim();
  const aiDescIsJustTitle = aiDesc && aiTitle && aiDesc.replace(/<[^>]+>/g, '').trim() === aiTitle;
  return {
    title       : aiTitle || domResult?.title || '',
    description : (aiDesc && !aiDescIsJustTitle) ? aiDesc : (domResult?.description || ''),
    images      : domResult?.images ?? [],
    aiExtracted : true,
    aiRewritten : aiResult.aiRewritten,
    sourceUrl   : tab.url,
  };
}

// ── DOM extraction path ───────────────────────────────────────────────────────
async function extractWithDOM(tab, imgLimit) {
  copyBar.show(20, '🔍 جاري تحليل الصفحة...');

  // Inject image-limit setting before running the extractor
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func  : limit => { window.__copySettings = { imgLimit: limit }; },
    args  : [imgLimit],
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files : ['content_copy.js'],
  });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func  : () => window.__copiedProduct ?? null,
  });

  copyBar.show(60, '📦 البيانات جاهزة...');
  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// PASTE
// ══════════════════════════════════════════════════════════════════════════════
document.getElementById('btnPaste').addEventListener('click', async () => {
  clearStatus(pasteStatus);

  const { productData } = await chrome.storage.local.get(['productData']);
  if (!productData) {
    setStatus(pasteStatus, '⚠️ لا توجد بيانات منسوخة. اضغط نسخ أولاً.', 'error');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!isSallaTab(tab.url)) {
    setStatus(
      pasteStatus,
      '❌ يرجى الانتقال إلى صفحة إضافة منتج في سلة:\nhttps://s.salla.sa/products/new',
      'error'
    );
    return;
  }

  pasteBtn.busy('جاري اللصق...');
  pasteBar.hide();

  try {
    // ── Fetch product images as base64 ────────────────────────────────────────
    let imagesBase64 = [];
    if (productData.images?.length) {
      pasteBar.show(20, `⬇️ تحميل ${productData.images.length} صورة...`);
      imagesBase64 = await chrome.runtime.sendMessage({
        action: 'fetchImages', urls: productData.images,
      });
      pasteBar.show(60, `✅ تم تحميل ${imagesBase64.length} صورة`);
    }

    // ── Inject pasteIntoSalla from paste_salla.js then call it ───────────────
    pasteBar.show(75, '📋 جاري لصق البيانات...');
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files : ['paste_salla.js'],
    });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func  : (t, d, imgs) => pasteIntoSalla(t, d, imgs),
      args  : [productData.title, productData.description, imagesBase64],
    });

    pasteBar.show(100, '✅ اكتمل!');

    if (result?.success) {
      setStatus(pasteStatus, `✅ تم اللصق!\n${result.message}`, 'success');
    } else {
      setStatus(pasteStatus, `⚠️ اكتمل مع تنبيهات:\n${result?.message ?? ''}`, 'warn');
    }

  } catch (err) {
    console.error('[Paste]', err);
    setStatus(pasteStatus, `❌ خطأ: ${err.message}`, 'error');
  } finally {
    pasteBtn.idle('لصق البيانات في سلة');
    setTimeout(() => pasteBar.hide(), 2000);
  }
});

// ── Guard: only paste to salla.sa / salla.com domains ────────────────────────
// Why URL parsing instead of String#includes?
//   The old `url.includes('salla.sa')` matched anywhere in the URL — including
//   query strings — so https://evil.com/?ref=salla.sa would pass.
//   Compare against the parsed hostname instead, with a strict suffix match.
function isSallaTab(url = '') {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'salla.sa'  || host.endsWith('.salla.sa')
        || host === 'salla.com' || host.endsWith('.salla.com');
  } catch { return false; }
}

// ══════════════════════════════════════════════════════════════════════════════
// CLEAR
// ══════════════════════════════════════════════════════════════════════════════
document.getElementById('btnClear').addEventListener('click', async () => {
  await chrome.storage.local.remove(['productData']);
  document.getElementById('preview').classList.remove('on');
  setPasteReady(false);
  clearStatus(copyStatus);
  clearStatus(pasteStatus);
  setStatus(copyStatus, '🗑️ تم مسح البيانات المنسوخة.', 'info');
});
