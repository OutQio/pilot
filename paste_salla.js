// paste_salla.js
// Injected into the Salla product form tab by popup.js.
// Must be entirely self-contained — no references to popup scope.
//
// Salla's form uses Stencil.js custom web components:
//   <s-input>    — product title   (shadow DOM wraps a native <input>)
//   <s-editor>   — description     (Quill editor in normal DOM, not shadow)
//   <s-uploader> — images          (shadow DOM contains the file <input>)
//
// Standard DOM selectors like input[placeholder="..."] do NOT work here.
// Each component requires a specific technique documented inline.

function pasteIntoSalla(titleText, descHtml, imagesBase64) {
  'use strict';

  const log   = [];
  let titleOk = false, descOk = false, imagesOk = false;

  // ── Helper: trigger reactivity on a Stencil component ────────────────────────
  // Stencil components intercept .value via their prototype's property descriptor.
  // Setting el.value directly bypasses the setter and the component never updates.
  // We must call descriptor.set.call(el, value) to go through the reactive path.
  //
  // Walks the prototype chain so we still find the descriptor when Stencil
  // places it on a parent class (e.g. some s-input subclasses extend a base).
  function findValueSetter(el) {
    let proto = Object.getPrototypeOf(el);
    while (proto && proto !== HTMLElement.prototype && proto !== Object.prototype) {
      const d = Object.getOwnPropertyDescriptor(proto, 'value');
      if (d?.set) return d.set;
      proto = Object.getPrototypeOf(proto);
    }
    return null;
  }

  function setStencilValue(el, value) {
    if (!el) return;
    try {
      const setter = findValueSetter(el);
      if (setter) {
        setter.call(el, value);
        el.dispatchEvent(new CustomEvent('input',    { bubbles: true, detail: { value } }));
        el.dispatchEvent(new CustomEvent('change',   { bubbles: true, detail: { value } }));
        el.dispatchEvent(new CustomEvent('s-change', { bubbles: true, detail: { value } }));
        return;
      }
    } catch { /* component doesn't expose a descriptor — fall through */ }
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ── 1. TITLE ─────────────────────────────────────────────────────────────────
  try {
    // Prefer the product-name field; fall back to any s-input on the page.
    const sInput = document.querySelector('s-input[placeholder*="اسم المنتج"]')
                ?? document.querySelector('s-lingual-field s-input')
                ?? document.querySelector('s-input');

    if (sInput) {
      setStencilValue(sInput, titleText);

      // Belt-and-suspenders: also write directly to the native input inside
      // shadow DOM, in case Stencil's reactive path misses it.
      const inner = sInput.shadowRoot?.querySelector('input');
      if (inner) {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        nativeSetter ? nativeSetter.call(inner, titleText) : (inner.value = titleText);
        inner.dispatchEvent(new Event('input',  { bubbles: true }));
        inner.dispatchEvent(new Event('change', { bubbles: true }));
      }

      titleOk = true;
      log.push('✅ العنوان: تم');
    } else {
      log.push('⚠️ لم يُعثر على s-input للعنوان');
    }
  } catch (e) { log.push(`❌ العنوان: ${e.message}`); }

  // ── 2. DESCRIPTION ───────────────────────────────────────────────────────────
  //
  // Why not qlEditor.innerHTML = html?
  //   Quill renders from its internal Delta state, NOT from the DOM.
  //   Writing innerHTML updates the DOM visually but Quill's Delta doesn't change,
  //   so on the next repaint Quill re-renders and overwrites our content.
  //
  // Why not setStencilValue(sEditor, html)?
  //   The value reaches the component but Quill strips all formatting (bullets,
  //   bold, alignment) because it doesn't recognise it as a paste event.
  //
  // What actually works:
  //   Dispatch a ClipboardEvent('paste') with a DataTransfer carrying text/html.
  //   Quill always listens for paste on its .ql-editor div and runs its own
  //   clipboard.convert() (HTML → Delta) which correctly preserves:
  //     ✅ <ul>/<li> bullet lists   ✅ <strong>/<em>   ✅ <h1>–<h3>
  //     ✅ ql-align-center          ✅ <a> links        ✅ <img> embeds
  //
  // Why pre-inject RTL classes instead of clicking the toolbar button?
  //   The toolbar button applies RTL to Quill's *internal* selection, which cannot
  //   be set programmatically (browser Range API and execCommand both use the
  //   browser's native selection, which Quill ignores). Pre-injecting
  //   ql-direction-rtl + ql-align-right into the HTML means Quill's clipboard
  //   parser stores them in the Delta directly — identical to what Quill writes
  //   when a user clicks the button themselves.
  try {
    const qlEditor = document.querySelector('.ql-editor[contenteditable="true"]');

    if (qlEditor && typeof DataTransfer !== 'undefined') {
      // Focus + select-all so the paste *replaces* any existing content.
      qlEditor.focus();
      try { document.execCommand('selectAll'); } catch { /* not available in all environments */ }

      // Pre-inject RTL classes for Arabic content.
      let htmlToInsert = descHtml;
      if (/[\u0600-\u06FF\u0750-\u077F]/.test(descHtml)) {
        const tmp = document.createElement('div');
        tmp.innerHTML = descHtml;
        tmp.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre').forEach(el => {
          el.classList.add('ql-direction-rtl', 'ql-align-right');
        });
        htmlToInsert = tmp.innerHTML;
      }

      // Dispatch the paste event — Quill's handler runs clipboard.convert() on it.
      const dt = new DataTransfer();
      dt.setData('text/html', htmlToInsert);
      dt.setData('text/plain', '');
      qlEditor.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData : dt,
        bubbles       : true,
        cancelable    : true,
      }));

      // After Quill settles, sync the final rendered HTML back to s-editor's
      // Stencil state so the component considers itself "changed".
      const sEditor = document.querySelector('s-editor');
      if (sEditor) {
        setTimeout(() => {
          try {
            const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sEditor), 'value');
            if (descriptor?.set) {
              const finalHtml = qlEditor.innerHTML;
              descriptor.set.call(sEditor, finalHtml);
              sEditor.dispatchEvent(new CustomEvent('s-change', {
                bubbles : true,
                detail  : { value: finalHtml },
              }));
            }
          } catch { /* best-effort */ }
        }, 150);
      }

      descOk = true;
      log.push('✅ الوصف: تم');
    } else {
      log.push('⚠️ لم يُعثر على .ql-editor للوصف');
    }
  } catch (e) { log.push(`❌ الوصف: ${e.message}`); }

  // ── 3. IMAGES ────────────────────────────────────────────────────────────────
  // <s-uploader> wraps FilePond inside its shadow DOM.
  // document.querySelector('input[type="file"]') finds nothing — must pierce shadow root.
  try {
    if (!imagesBase64?.length) {
      imagesOk = true;
      log.push('ℹ️ لا توجد صور');
    } else {
      // Convert base64 objects → File objects
      const files = imagesBase64.flatMap(d => {
        if (!d?.base64) return [];
        try {
          const { base64, mimeType = 'image/jpeg', filename = 'product.jpg' } = d;
          const bytes = atob(base64);
          const buf   = new Uint8Array(bytes.length);
          for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
          return [new File([buf], filename, { type: mimeType })];
        } catch { return []; }
      });

      if (!files.length) {
        log.push('⚠️ تعذر تحويل بيانات الصور إلى ملفات');
      } else {
        const fileInput = document.querySelector('s-uploader')
                            ?.shadowRoot
                            ?.querySelector('input[type="file"]');

        if (fileInput) {
          const dt = new DataTransfer();
          files.forEach(f => dt.items.add(f));

          // Use the native HTMLInputElement files setter to bypass Stencil's
          // property interception; then fire the events FilePond listens for.
          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
          nativeSetter
            ? nativeSetter.call(fileInput, dt.files)
            : Object.defineProperty(fileInput, 'files', { value: dt.files, configurable: true });

          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          fileInput.dispatchEvent(new Event('input',  { bubbles: true }));

          imagesOk = true;
          log.push(`✅ الصور (${files.length}): تم`);
        } else {
          log.push('⚠️ لم يُعثر على s-uploader أو file input في shadow DOM');
        }
      }
    }
  } catch (e) { log.push(`❌ الصور: ${e.message}`); }

  return {
    // Why include imagesOk? Previously we returned success=true even when
    // image upload failed, which caused the popup to flash a green ✅ while
    // silently dropping all product photos. imagesOk defaults to true when
    // no images were provided, so a text-only paste still passes.
    success  : titleOk && descOk && imagesOk,
    titleOk,
    descOk,
    imagesOk,
    message  : log.join('\n'),
  };
}
