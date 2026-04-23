// options.js
'use strict';

// Keep in sync with the constant in background.js.
// If you upgrade the Gemini model, change it in both files.
const GEMINI_MODEL = 'gemini-2.0-flash';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const apiKeyInput      = document.getElementById('apiKey');
const btnSave          = document.getElementById('btnSave');
const btnTest          = document.getElementById('btnTest');
const apiStatus        = document.getElementById('apiStatus');
const toggleEye        = document.getElementById('toggleEye');
const useAICheck       = document.getElementById('useAI');
const embedDescCheck   = document.getElementById('embedDescImages');
const imgLimitRange    = document.getElementById('imgLimit');
const imgLimitVal      = document.getElementById('maxImgVal');
const btnSaveSettings  = document.getElementById('btnSaveSettings');
const settingsStatus   = document.getElementById('settingsStatus');

// Rewrite rules
const enableRewrite    = document.getElementById('enableRewrite');
const rewriteFields    = document.getElementById('rewriteFields');
const titleRulesInput  = document.getElementById('titleRules');
const descRulesInput   = document.getElementById('descRules');
const styleExamples    = document.getElementById('styleExamples');
const btnSaveRewrite   = document.getElementById('btnSaveRewrite');
const rewriteStatus    = document.getElementById('rewriteStatus');

// ── Helpers ───────────────────────────────────────────────────────────────────
function showStatus(el, msg, type, durationMs = 4000) {
  el.textContent = msg;
  el.className   = `status show ${type}`;
  setTimeout(() => { el.className = 'status'; }, durationMs);
}

const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── Rewrite toggle — dim/enable the fields section ───────────────────────────
function applyRewriteToggle() {
  rewriteFields.classList.toggle('disabled', !enableRewrite.checked);
}
enableRewrite.addEventListener('change', applyRewriteToggle);

// ── Load saved values ─────────────────────────────────────────────────────────
async function init() {
  const { geminiKey, settings, rewriteRules } =
    await chrome.storage.local.get(['geminiKey', 'settings', 'rewriteRules']);

  if (geminiKey) apiKeyInput.value = geminiKey;

  const s = settings ?? {};
  useAICheck.checked     = s.useAI           !== false;
  embedDescCheck.checked = s.embedDescImages !== false;
  imgLimitRange.value    = s.imgLimit        ?? 8;
  imgLimitVal.textContent = imgLimitRange.value;

  // Rewrite rules
  const r = rewriteRules ?? {};
  enableRewrite.checked      = r.enabled    ?? false;
  titleRulesInput.value      = r.titleRules ?? '';
  descRulesInput.value       = r.descRules  ?? '';
  styleExamples.value        = r.examples   ?? '';
  applyRewriteToggle();
}
init();

// ── Live range label ──────────────────────────────────────────────────────────
imgLimitRange.addEventListener('input', () => {
  imgLimitVal.textContent = imgLimitRange.value;
});

// ── Show / hide API key ───────────────────────────────────────────────────────
toggleEye.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

// ── Save API key ──────────────────────────────────────────────────────────────
btnSave.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) return showStatus(apiStatus, '⚠️ أدخل المفتاح أولاً.', 'error');
  await chrome.storage.local.set({ geminiKey: key });
  showStatus(apiStatus, '✅ تم حفظ المفتاح!', 'success');
});

// ── Test API key ──────────────────────────────────────────────────────────────
// Saves the key on success so the user doesn't have to click Save separately.
btnTest.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) return showStatus(apiStatus, '⚠️ أدخل المفتاح أولاً.', 'error');

  showStatus(apiStatus, '⏳ جاري الاختبار...', 'info', 30_000);
  btnTest.disabled = true;

  try {
    // Send the key as a header rather than a query string so it doesn't
    // appear in DevTools / browser network history.
    const resp = await fetch(GEMINI_ENDPOINT, {
      method  : 'POST',
      headers : {
        'Content-Type'  : 'application/json',
        'x-goog-api-key': key,
      },
      body    : JSON.stringify({
        contents         : [{ parts: [{ text: 'Hi' }] }],
        generationConfig : { maxOutputTokens: 5 },
      }),
      signal  : AbortSignal.timeout(15_000),
    });

    if (resp.ok) {
      await chrome.storage.local.set({ geminiKey: key });
      showStatus(apiStatus, '✅ مفتاح Gemini يعمل! تم الحفظ.', 'success');
    } else {
      const err = await resp.json().catch(() => ({}));
      showStatus(apiStatus, `❌ ${err.error?.message ?? resp.status}`, 'error');
    }
  } catch (e) {
    showStatus(apiStatus, `❌ خطأ في الاتصال: ${e.message}`, 'error');
  } finally {
    btnTest.disabled = false;
  }
});

// ── Save performance settings ─────────────────────────────────────────────────
btnSaveSettings.addEventListener('click', async () => {
  await chrome.storage.local.set({
    settings: {
      useAI           : useAICheck.checked,
      embedDescImages : embedDescCheck.checked,
      imgLimit        : parseInt(imgLimitRange.value, 10),
    },
  });
  showStatus(settingsStatus, '✅ تم حفظ الإعدادات!', 'success');
});

// ── Save rewrite rules ────────────────────────────────────────────────────────
// Stored under a separate 'rewriteRules' key so it doesn't collide with
// the existing 'settings' object and stays easy to clear independently.
btnSaveRewrite.addEventListener('click', async () => {
  const titleRules = titleRulesInput.value.trim();
  const descRules  = descRulesInput.value.trim();
  const examples   = styleExamples.value.trim();

  // Warn if rewrite is enabled but no guidance provided — Gemini will just
  // rewrite randomly without any rules to follow, which is worse than nothing.
  if (enableRewrite.checked && !titleRules && !descRules && !examples) {
    return showStatus(rewriteStatus,
      '⚠️ أضف قواعد أو أمثلة قبل تفعيل إعادة الكتابة — بدونها لن يعرف Gemini أسلوب متجرك.',
      'error'
    );
  }

  await chrome.storage.local.set({
    rewriteRules: {
      enabled   : enableRewrite.checked,
      titleRules,
      descRules,
      examples,
    },
  });
  showStatus(rewriteStatus, '✅ تم حفظ قواعد إعادة الكتابة!', 'success');
});
