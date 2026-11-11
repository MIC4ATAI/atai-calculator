# atai-calculator

Kalkulator efektywności biura rachunkowego — aplikacja SaaS do prowadzenia rozmów sprzedażowych
na żywo: rozmówca wpisuje dane o swoim biurze, konsultant widzi je na bieżąco i odsłania wynik
(odzyskany czas i liczba nowych klientów, których biuro może obsłużyć bez dodatkowych etatów).

- Specyfikacja: [`docs/spec.md`](docs/spec.md)
- Zasady dla Claude Code: [`CLAUDE.md`](CLAUDE.md)
- Prompt startowy etapu 1: [`docs/etap-1-prompt.md`](docs/etap-1-prompt.md)
- Logika obliczeń i testy zgodności z arkuszem: [`src/calc/`](src/calc/)

**Stan:** etap 1 (MVP) gotowy — logowanie konsultanta, sesja na żywo (widok rozmówcy i prezentera),
model wieloklientowy z RLS i testami, zliczanie użycia. Szczegóły i odstępstwa od prototypu:
[`docs/spec.md`](docs/spec.md), sekcja „Stan etapu 1”.

## Uruchomienie lokalne

Wymagania: Node.js i npm (testowane na Node 26), Docker Desktop, [Supabase CLI](https://supabase.com/docs/guides/local-development)
(testowane na 3.1.0). Wszystko działa lokalnie, bez projektu w chmurze.

```bash
npm install

# 1. Lokalny stos Supabase (Postgres, Auth, Realtime, Edge Runtime, Mailpit).
#    Pierwszy start pobiera obrazy Dockera. Pomijamy usługi, których nie używamy.
supabase start -x logflare,vector,imgproxy,studio

# 2. Migracje i dane testowe (bezpieczne lokalnie; przywraca też czysty stan).
supabase db reset

# 3. Konfiguracja aplikacji: wartość PUBLISHABLE_KEY wpisz do VITE_SUPABASE_ANON_KEY w .env.
supabase status
cp .env.example .env

# 4. W osobnych terminalach:
supabase functions serve   # Edge Function guest-session (dostęp rozmówcy po tokenie)
npm run dev                # aplikacja: http://127.0.0.1:5173
```

W `.env` trzymamy wyłącznie adres i **publiczny** klucz Supabase. Plik jest w `.gitignore`;
tajne klucze (service role) żyją tylko po stronie serwera, w Edge Functions.

### Logowanie i konta testowe

Logowanie to magic link: wpisz adres, a mail z linkiem znajdziesz w lokalnej skrzynce
**Mailpit: http://127.0.0.1:54324**. Konta zakłada operator lub właściciel organizacji — link
nie rejestruje nowych osób. Seed (`supabase/seed.sql`) tworzy:

| E-mail | Rola |
| --- | --- |
| `marek@mitax.test` | właściciel MITAX Consulting, konsultant w AT AI (dwie organizacje) |
| `ola@mitax.test` | konsultant MITAX |
| `admin@mitax.test` | administrator MITAX |
| `wspolnik@atai.test` | właściciel AT AI Solutions |
| `jan@atai.test` | konsultant AT AI |
| `operator@platform.test` | operator platformy (bez dostępu do sesji organizacji) |

To konta wyłącznie lokalne i testowe.

### Wypróbowanie sesji na żywo

1. Zaloguj się jako `ola@mitax.test` → **Nowa sesja** → skopiuj link dla rozmówcy.
2. Otwórz link w drugim oknie (bez logowania, najlepiej w oknie prywatnym) i wpisz dane.
   Przykład kontrolny: 100 KH, 200 KPiR, 9 osób, 2 000 000 zł przychodu, 1 200 000 zł wynagrodzeń
   → 121 h, 36 min na kliencie KH, +20 KH albo +40 KPiR. W widoku prezentera pomoże „Wypełnij przykładem”.
3. Konsultant widzi wpisy na bieżąco i klika **Odsłoń wynik rozmówcy**; suwak miksu działa po obu stronach.

## Komendy

```bash
npm test             # testy Vitest: obliczenia (zgodność z arkuszem), logika widoków, walidacja
npm run test:db      # testy pgTAP: RLS, niezmienność tabel, RPC (wymaga działającego supabase start)
npm run typecheck    # sprawdzenie typów
npm run build        # typecheck + build produkcyjny
supabase db reset    # czysta baza z migracji + seed
```

Po zmianie schematu bazy: nowa migracja w `supabase/migrations/` (nigdy ręcznie na produkcji), a potem
`supabase gen types typescript --local > src/lib/database.types.ts`.

## Struktura

```
src/calc/        logika obliczeń i testy zgodności z arkuszem (jedyne miejsce na wzory)
src/session/     sesja na żywo: widok rozmówcy (GuestPage), prezentera (SessionPage), logika widoku
                 rozmówcy (guestView, guestRequest — współdzielona z Edge Function), formatowanie
src/auth/        logowanie magic linkiem
src/org/         wybór organizacji
src/app/         układ i lista sesji konsultanta
src/lib/         klient Supabase (tylko klucz publiczny) i wygenerowane typy bazy
supabase/
  migrations/    schemat, RLS, triggery, RPC
  tests/         testy pgTAP
  functions/     Edge Function guest-session
  seed.sql       dane deweloperskie (tylko lokalnie)
```

## Do zamknięcia przed pierwszą rozmową z klientem

Lista znanych rzeczy (wdrożenie funkcji, limit zapytań, polski szablon maila, procedura usuwania
danych, marka organizacji) jest w [`docs/spec.md`](docs/spec.md), sekcja „Infrastruktura”.

© MITAX Consulting sp. z o.o. Wszelkie prawa zastrzeżone.
