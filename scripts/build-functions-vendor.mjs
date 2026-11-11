#!/usr/bin/env node
/**
 * Przygotowuje zależności Edge Functions do wdrożenia: pakuje ExcelJS (przeglądarkową, samodzielną paczkę) do JEDNEGO
 * pliku ESM w supabase/functions/_vendor/. Powód: pakiet `npm:exceljs` ciągnie za sobą drzewo kilku tysięcy plików
 * (surowa paczka funkcji ~43 MB), a platforma ma limit rozmiaru funkcji (20 MB przy pakowaniu CLI, 5 MB po stronie serwera).
 * Z jednym plikiem funkcja `request-calculation` ma kilka MB.
 *
 * Plik jest GENEROWANY (w .gitignore): uruchamiaj przed `supabase functions serve` i `supabase functions deploy`
 * (skrypty npm: functions:serve, functions:deploy robią to za Ciebie). Wersję ExcelJS wyznacza package.json.
 */
import { build } from 'esbuild';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outdir = `${root}supabase/functions/_vendor`;
mkdirSync(outdir, { recursive: true });
const outfile = `${outdir}/exceljs.js`;

await build({
  stdin: {
    contents: "import ExcelJS from 'exceljs/dist/exceljs.min.js';\nexport default ExcelJS;\n",
    resolveDir: root,
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  // Noty licencyjne pakietów zostają w pliku (na końcu).
  legalComments: 'eof',
  banner: { js: '// PLIK GENEROWANY przez scripts/build-functions-vendor.mjs — nie edytuj, nie dodawaj do repozytorium.' },
  outfile,
});

console.log(`supabase/functions/_vendor/exceljs.js: ${(statSync(outfile).size / 1e6).toFixed(1)} MB`);
