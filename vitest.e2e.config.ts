import { defineConfig } from 'vite';

/**
 * Testy end-to-end etapu 2: prawdziwe Edge Functions, baza i Mailpit na lokalnym stosie Supabase.
 * Uruchamiane przez `npm run test:e2e` (skrypt scripts/e2e.mjs sprawdza stos i dostarcza klucze).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/e2e/**/*.e2e.test.ts'],
    // Część scenariuszy czeka na koniec okna podwójnego kliknięcia (10 s) i odpytuje zewnętrzną bazę testową GUS.
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
});
