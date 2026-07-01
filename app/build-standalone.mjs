// Builds a single self-contained HTML file that runs from file:// (double-click,
// no server). It inlines styles.css and concatenates the ES modules into one
// classic <script>, stripping `import`/`export` so everything shares one scope.
// The PWA layer (manifest + service worker) is dropped — it needs an http origin.
//
// Run: node build-standalone.mjs   (re-run after editing any module)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), 'utf8');

const strip = (src) =>
  src
    .replace(/^\s*import\s+[^\n]*\n/gm, '')   // drop import lines
    .replace(/^export\s+/gm, '');             // drop the export keyword

// Order matters: engine -> preset -> store -> (store namespace) -> app.
const engine = strip(read('engine.js'));
const preset = strip(read('preset.js'));
const storeMod = strip(read('store.js'));
const app = strip(read('app.js'));

// app.js uses `import * as store` — recreate that namespace object explicitly.
const storeNamespace = `
const store = { SCHEMA_VERSION, emptySave, load, save, saveNow, exportCharacter,
  exportEverything, exportPack, download, analyzeImport, importSaveFile, importPackInto };
`;

const js = [
  '(function(){',
  '"use strict";',
  '// ===== engine.js =====', engine,
  '// ===== preset.js =====', preset,
  '// ===== store.js =====', storeMod,
  storeNamespace,
  '// ===== app.js =====', app,
  '})();',
].join('\n');

const css = read('styles.css');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no" />
  <meta name="theme-color" content="#7a2b2b" />
  <title>Parchment (offline / single file)</title>
  <style>
${css}
  </style>
</head>
<body>
  <div id="app"></div>
  <input id="file-input" type="file" accept="application/json,.json" hidden />
  <script>
${js}
  </script>
</body>
</html>
`;

const out = join(here, '..', 'parchment-offline.html');
writeFileSync(out, html);
console.log('Wrote', out, `(${(html.length / 1024).toFixed(0)} KB)`);
