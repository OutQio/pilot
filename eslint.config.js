// ESLint flat config for the Product Copier extension.
// One repo, three different runtime contexts:
//   1. background.js                      → MV3 service worker (no DOM, has fetch + chrome.*)
//   2. content_copy.js / paste_salla.js   → content scripts (have DOM + page globals)
//   3. popup.js / options.js              → extension pages (DOM + chrome.*)
// Each gets its own globals override below.

import globals from 'globals';

const sharedRules = {
  'no-unused-vars'      : ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-undef'            : 'error',
  'no-var'              : 'error',
  'prefer-const'        : 'warn',
  'eqeqeq'              : ['error', 'always', { null: 'ignore' }],
  'no-console'          : 'off',          // we deliberately log build stamps + diagnostics
  'no-empty'            : ['error', { allowEmptyCatch: true }],
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-async-promise-executor': 'error',
  'no-prototype-builtins': 'off',
};

export default [
  {
    // Ignore generated / vendor / fixture artifacts
    ignores: [
      'node_modules/',
      '.playwright-mcp/',
      'dist/',
      'build/',
      'icons/',
      '*.zip',
      '.claude/',
    ],
  },

  // ── background.js — service worker (no DOM, has fetch + chrome.*)
  {
    files: ['background.js'],
    languageOptions: {
      ecmaVersion : 'latest',
      sourceType  : 'script',
      globals     : {
        ...globals.serviceworker,
        ...globals.webextensions,
        OffscreenCanvas   : 'readonly',
        createImageBitmap : 'readonly',
        FileReader        : 'readonly',
        AbortSignal       : 'readonly',
        fetch             : 'readonly',
        chrome            : 'readonly',
      },
    },
    rules: sharedRules,
  },

  // ── content scripts — DOM + page globals
  {
    files: ['content_copy.js', 'paste_salla.js'],
    languageOptions: {
      ecmaVersion : 'latest',
      sourceType  : 'script',
      globals     : {
        ...globals.browser,
        // paste_salla.js exposes pasteIntoSalla on the page world; popup.js
        // calls it via chrome.scripting.executeScript. Keep it visible to
        // ESLint as a "global" so the no-undef check passes.
        pasteIntoSalla : 'writable',
      },
    },
    rules: sharedRules,
  },

  // ── extension pages — DOM + chrome.*
  {
    files: ['popup.js', 'options.js'],
    languageOptions: {
      ecmaVersion : 'latest',
      sourceType  : 'script',
      globals     : {
        ...globals.browser,
        ...globals.webextensions,
        chrome         : 'readonly',
        // popup.js calls pasteIntoSalla() inside a func passed to
        // chrome.scripting.executeScript — that function gets serialised and
        // runs in the page world (where paste_salla.js was just injected),
        // not in popup.js's own context. Mark it as a known global so ESLint
        // doesn't flag it as undefined.
        pasteIntoSalla : 'readonly',
      },
    },
    rules: sharedRules,
  },
];
