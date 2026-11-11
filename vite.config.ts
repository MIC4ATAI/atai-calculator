/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // Testy e2e wymagają działającego stosu Supabase: uruchamiasz je osobno (`npm run test:e2e`).
    exclude: ['src/e2e/**', '**/node_modules/**'],
  },
});
