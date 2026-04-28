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

const copyStatus     = document.getElementById('copyStatus');
const pasteStatus    = document.getElementById('pasteStatus');
const rewriteToggle  = document.getElementById('rewriteToggle');
const rewriteRow     = document.getElementById('rewriteRow');

// ══════════════════════════════════════════════════════════════════════════════
// Initialise on popup open
// ══════════════════════════════════════════════════════════════════════════════
async function init() {
  const { productData, geminiKey, rewriteRules } =
    await chrome.storage.local.get(['productData', 'geminiKey', 'rewriteRules']);

  if (productData) {
    showPreview(productData);
    setPasteReady(true);
  }

  // Rewrite toggle: only enabled when BOTH a Gemini key exists AND there are
  // saved rewrite rules. Default-on if the user has enabled rewrite in options;
  // they can flip it per-paste from the popup.
  const hasRules = !!(rewriteRules && (rewriteRules.titleRules || rewriteRules.descRules || rewriteRules.examples));
  const canRewrite = !!geminiKey && hasRules;
  rewriteToggle.checked  = canRewrite && rewriteRules?.enabled !== false;
  rewriteToggle.disabled = !canRewrite;
  if (!geminiKey) {
    rewriteRow.classList.add('disabled');
    rewriteRow.title = 'أضف مفتاح Gemini في الإعدادات لتفعيل إعادة الكتابة';
  } else if (!hasRules) {
    rewriteRow.classList.add('disabled');
    rewriteRow.title = 'أضف قواعد إعادة الكتابة في الإعدادات لتفعيل هذا الخيار';
  }
}
init();

document.getElementById('btnSettings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ══════════════════════════════════════════════════════════════════════════════
// COPY  — always DOM-based now. Gemini was removed from the copy step because
// its only useful job there (cleaner Arabic title/description) is more
// appropriate as a paste-time decision: the user often wants to copy from
// several stores in a row and only rewrite when actually pasting.
// ══════════════════════════════════════════════════════════════════════════════
document.getElementById('btnCopy').addEventListener('click', async () => {
  clearStatus(copyStatus);
  copyBtn.busy('جاري الاستخراج...');
  copyBar.hide();

  try {
    const { settings } = await chrome.storage.local.get(['settings']);
    const imgLimit       = settings?.imgLimit       ?? 8;
    const embedDescImgs  = settings?.embedDescImages !== false;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const productData = await extractWithDOM(tab, imgLimit);

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

    setStatus(
      copyStatus,
      `✅ تم النسخ!\n` +
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

  // Tracks the outcome of the optional Gemini rewrite step so the final
  // paste status can show whether rewriting actually ran. Without this we'd
  // overwrite a "rewrite failed" warning with the "paste OK" success message
  // and the user would never see the failure reason.
  let rewriteOutcome = 'skipped';   // 'skipped' | 'ok' | 'failed:<reason>'

  try {
    // ── (Optional) Rewrite title + description with Gemini before pasting ───
    // The toggle is only enabled in init() when both a Gemini key AND saved
    // rewrite rules are present, so we don't need to re-validate here. We
    // pass the already-extracted title+description (not the page HTML), which
    // makes the prompt ~95% smaller than the old extract+rewrite prompt.
    let title = productData.title;
    let description = productData.description;
    if (rewriteToggle.checked && !rewriteToggle.disabled) {
      pasteBar.show(10, '✍️ Gemini يعيد كتابة المنتج بأسلوب متجرك...');
      const { geminiKey, rewriteRules } =
        await chrome.storage.local.get(['geminiKey', 'rewriteRules']);
      console.info('[ProductCopier] rewrite request:', {
        hasKey       : !!geminiKey,
        rulesEnabled : !!rewriteRules?.enabled,
        hasTitleRules: !!rewriteRules?.titleRules,
        hasDescRules : !!rewriteRules?.descRules,
        hasExamples  : !!rewriteRules?.examples,
        title        : productData.title?.slice(0, 80),
        descChars    : productData.description?.length ?? 0,
      });
      let ai;
      try {
        ai = await chrome.runtime.sendMessage({
          action: 'aiRewrite',
          title       : productData.title,
          description : productData.description,
          sourceUrl   : productData.sourceUrl,
          apiKey      : geminiKey,
          rewriteRules,
        });
      } catch (e) {
        // sendMessage itself can throw when the SW disconnects mid-flight.
        ai = { error: e.message };
      }
      console.info('[ProductCopier] rewrite response:', ai && {
        hasTitle: !!ai.title,
        titleChars: ai.title?.length,
        descChars: ai.description?.length,
        error: ai.error,
      });

      // ai === undefined happens when the service worker is stale (old build
      // that doesn't recognise 'aiRewrite') and silently drops the message.
      // Treat any of {undefined, missing title, error field} as a soft failure
      // and fall back to the original DOM data.
      if (!ai || ai.error || !ai.title) {
        const reason = ai?.error
          || (ai === undefined ? 'الخدمة لم تستجب — أعد تحميل الإضافة' : 'استجابة فارغة');
        rewriteOutcome = `failed:${reason}`;
        console.warn('[ProductCopier] rewrite failed:', reason);
      } else {
        title = ai.title.trim() || title;
        description = ai.description?.trim() || description;
        rewriteOutcome = 'ok';
        console.info('[ProductCopier] rewrite OK — new title:', title.slice(0, 80));
      }
    }

    // ── Fetch + normalise product images ─────────────────────────────────────
    let imagesBase64 = [];
    if (productData.images?.length) {
      const { settings } = await chrome.storage.local.get(['settings']);
      const normalize = settings?.normalizeImages !== false;     // default ON
      pasteBar.show(30,
        normalize
          ? `🎨 تجهيز ${productData.images.length} صورة بأسلوب متجرك...`
          : `⬇️ تحميل ${productData.images.length} صورة...`
      );
      imagesBase64 = await chrome.runtime.sendMessage({
        action   : 'fetchImages',
        urls     : productData.images,
        normalize,
      });
      pasteBar.show(60, `✅ تم تجهيز ${imagesBase64.length} صورة`);
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
      args  : [title, description, imagesBase64],
    });

    pasteBar.show(100, '✅ اكتمل!');

    // Build a rewrite-status line that's preserved regardless of paste outcome
    // — so a silent rewrite failure can never hide behind a paste-OK message.
    const rewriteLine =
      rewriteOutcome === 'ok'      ? '✍️ تم تطبيق إعادة الكتابة' :
      rewriteOutcome.startsWith('failed:')
        ? `⚠️ لم تتم إعادة الكتابة: ${rewriteOutcome.slice('failed:'.length)}`
        : '';

    const headLine = result?.success ? `✅ تم اللصق!` : `⚠️ اكتمل مع تنبيهات:`;
    const tone     = result?.success
      ? (rewriteOutcome.startsWith('failed:') ? 'warn' : 'success')
      : 'warn';
    setStatus(
      pasteStatus,
      [headLine, rewriteLine, result?.message].filter(Boolean).join('\n'),
      tone
    );

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
