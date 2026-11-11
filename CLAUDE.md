# atai-calculator

Kalkulator efektywności dla biur rachunkowych, udostępniany w modelu SaaS wielu organizacjom
(pierwsze: MITAX Consulting sp. z o.o. i AT AI Solutions). Konsultant prowadzi z rozmówcą
sesję na żywo: rozmówca wpisuje dane w swoim widoku, konsultant widzi je na bieżąco i odsłania wynik.

Pełna specyfikacja: `docs/spec.md`. Przeczytaj ją przed planowaniem każdej większej zmiany.

## Stack

- Frontend: React + TypeScript (Vite), wdrażany na Vercel.
- Backend: Supabase — Postgres z RLS, Auth, Realtime, Edge Functions (GUS BIR1, wysyłka maili).
- Maile: MailerSend. Automatyzacje i powiadomienia: n8n.
- Testy: Vitest. Region danych: UE (Frankfurt).

## Zasady, których nie wolno łamać

1. **Logika obliczeń żyje tylko w `src/calc/`** i musi dawać te same wyniki co arkusz
   „kalkulator-br”. Testy w `src/calc/calculator.test.ts` pilnują zgodności — nie zmieniaj
   oczekiwanych wartości w testach, żeby „przeszły”. Każda zmiana wzorów = podbicie `CALC_VERSION`.
2. **Wiele organizacji (multi-tenant) od pierwszego dnia.** Każda tabela z danymi organizacji ma
   `org_id`; dostęp wymuszają polityki RLS, a każda polityka ma test. Organizacje nie widzą się
   nawzajem. Operator platformy nie ma dostępu do leadów żadnej organizacji.
3. **Zamrożony stan sesji (`calc_snapshots`) jest niezmienny** — tylko INSERT, nigdy UPDATE/DELETE.
4. **Tajne klucze tylko po stronie serwera** (Edge Functions). Do przeglądarki trafia wyłącznie
   publiczny klucz Supabase. Żadnych sekretów w repozytorium — `.env` jest w `.gitignore`.
5. **Kalkulator nie zbiera zgód marketingowych.** Wysyła tylko to, o co rozmówca poprosił
   (Excel + link do sesji). Zgody zbiera landing page organizacji.
6. Aplikacja jest odseparowana od mitax.pl / repozytorium `mitax-main` — żadnych zależności.

## Konwencje

- Język interfejsu: polski. Kod, nazwy w kodzie i komentarze techniczne: angielski lub polski
  konsekwentnie w obrębie modułu (moduł `src/calc` używa polskich nazw dziedzinowych).
- Migracje bazy w `supabase/migrations/`, wdrażane przez Supabase CLI, nigdy ręcznie na produkcji.
- Małe, działające kroki; commit po każdym przechodzącym kroku.

## Komendy

```bash
npm install
npm test          # testy (Vitest)
npm run typecheck # sprawdzenie typów
npm run test:db   # testy RLS i bazy (pgTAP; wymaga działającego `supabase start`)
npm run dev       # aplikacja lokalnie (osobno: `supabase functions serve`)
```

Uruchomienie lokalne krok po kroku: `README.md`.
