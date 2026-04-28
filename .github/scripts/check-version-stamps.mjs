#!/usr/bin/env node
// Verifies that the version in manifest.json matches the build stamps at the
// top of background.js and content_copy.js. The three are kept in lockstep
// because the build stamps are how staleness is diagnosed in the SW console.
//
// Fails the CI run if any of the three drift.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
const expected = manifest.version;

const STAMP_RE = /\[ProductCopier\]\s+(?:background\.js|content_copy\.js)\s+build\s+(\d+\.\d+\.\d+)/;

function findStamp(file) {
  const src   = readFileSync(resolve(root, file), 'utf8');
  const match = src.match(STAMP_RE);
  return match ? match[1] : null;
}

const stamps = {
  'manifest.json' : expected,
  'background.js' : findStamp('background.js'),
  'content_copy.js': findStamp('content_copy.js'),
};

const mismatched = Object.entries(stamps).filter(([, v]) => v !== expected);

console.log('version stamps:');
for (const [k, v] of Object.entries(stamps)) console.log(`  ${k.padEnd(18)} ${v ?? '<MISSING>'}`);

if (mismatched.length > 0) {
  console.error(
    `\n❌ Version drift detected. Expected ${expected} (from manifest.json) ` +
    `in all three places, but the following are out of sync:\n  ${mismatched.map(([k, v]) => `${k}: ${v ?? 'missing'}`).join('\n  ')}\n` +
    `\nFix: bump the version in manifest.json AND the build stamp in both ` +
    `background.js and content_copy.js to match. See CLAUDE.md § Invariants.`
  );
  process.exit(1);
}

console.log(`\n✅ all three locations agree on ${expected}`);
