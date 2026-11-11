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

# 4. Konfiguracja funkcji (GUS testowy + poczta do lokalnego Mailpita). Plik jest w .gitignore.
cp supabase/functions/.env.example supabase/functions/.env

# 5. W osobnych terminalach:
npm run functions:serve    # Edge Functions (najpierw buduje paczkę ExcelJS do supabase/functions/_vendor/, potem `supabase functions serve`)
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

### Wypróbowanie leada (etap 2)

1. W widoku rozmówcy wpisz NIP z publicznej bazy testowej GUS, np. `526-104-05-67` (T-MOBILE), i potwierdź firmę.
   Baza testowa ma stare, zanonimizowane dane; gdy GUS nie odpowie, rozmowa toczy się dalej z samym NIP-em.
2. Wypełnij dane, a konsultant odsłania wynik. Pod wynikiem pojawia się prośba o kalkulację: podaj dowolny adres.
3. Wysłane kalkulacje (mail z Excelem i linkiem do sesji) trafiają do lokalnego **Mailpita**:
   http://127.0.0.1:54324 (nic nie wychodzi poza komputer). Konsultant widzi na żywo „Kalkulacja wysłana”.
4. Stan z rozmowy jest zamrożony przy pierwszej prośbie: kolejne wysyłki (do 3) niosą ten sam stan,
   a adres i NIP są już zablokowane.

Zmienne funkcji (poczta, GUS, adres aplikacji) opisuje `supabase/functions/.env.example`. Na produkcji
ustawiasz je przez `supabase secrets set`, nigdy w repozytorium.

## Komendy

```bash
npm test             # testy Vitest: obliczenia (zgodność z arkuszem), logika widoków, walidacja
npm run test:db      # testy pgTAP: RLS, niezmienność tabel, RPC (wymaga działającego supabase start)
npm run test:e2e     # testy end-to-end na lokalnym stosie (patrz niżej)
npm run smoke        # kontrola po wdrożeniu: node scripts/smoke.mjs <adres Supabase> <klucz publiczny> [adres aplikacji]
npm run functions:prepare  # buduje supabase/functions/_vendor/exceljs.js (wymagane przed serve/deploy; robią to functions:serve/deploy)
npm run typecheck    # sprawdzenie typów
npm run build        # typecheck + build produkcyjny
supabase db reset    # czysta baza z migracji + seed
```

### Follow-up i powiadomienia (etap 3)

Po wysłaniu kalkulacji klient może wracać do swojego linku: u klienta stały pasek „Wynik z rozmowy” z różnicą względem
bieżącej symulacji i przyciskiem „Wróć do stanu z rozmowy”, a konsultant widzi powroty i zmiany (plakietka „Klient wrócił”
na liście sesji, widok `/session/<id>/follow-up` z trzema kolumnami: rozmowa, ostatnia symulacja, zmiany).

Powiadomienia przez n8n (Telegram) są opcjonalne:

1. Konsultant ustawia identyfikator czatu na stronie **Powiadomienia** (`/notifications`).
2. W `supabase/functions/.env` ustaw `N8N_WEBHOOK_URL` i `N8N_WEBHOOK_SECRET` (min. 16 znaków). Lokalnie adres może wskazywać
   odbiornik na hoście: `http://host.docker.internal:54399/hook` (http wolno tylko dla localhost i host.docker.internal).
   Pusty `N8N_WEBHOOK_URL` wyłącza wysyłkę. Po zmianie pliku `functions serve` się restartuje.
3. Workflow po stronie n8n i format żądania: [`docs/n8n-followup.md`](docs/n8n-followup.md) (szablon do importu:
   `docs/n8n-followup-workflow.json`).

### Testy end-to-end (`npm run test:e2e`)

Sprawdzają prawdziwe Edge Functions, bazę i Mailpit: NIP i GUS, CTA, zamrożenie stanu, Excel odczytany z załącznika,
blokady i limit wysyłek. Wymagają działających `supabase start`, `npm run functions:serve` i świeżej bazy z seedem
(`supabase db reset`); skrypt sprawdza to i podpowiada, czego brakuje. Klucze lokalne pobiera sam ze
`supabase status` i przekazuje tylko procesowi testów.

Scenariusze powiadomień (`notifications.e2e.test.ts`) uruchamiają odbiornik webhooka na hoście i potrzebują w
`supabase/functions/.env` zmiennych `N8N_WEBHOOK_URL=http://host.docker.internal:54399/hook` i `N8N_WEBHOOK_SECRET`
(skrypt czyta port i sekret z tego pliku, nie wypisuje ich). Bez nich te scenariusze są pomijane, z ostrzeżeniem.

Testy zapisują dane w lokalnej bazie (leady są tylko do dopisywania), więc **przed `npm run test:db` zrób
`supabase db reset`**: testy bazy liczą wiersze na czystym stanie. Część scenariuszy czeka ok. 10 s na koniec okna
ochrony przed podwójnym kliknięciem, a zapytania do GUS zależą od jego dostępności (wtedy asercje o danych z GUS
są pomijane).

Po zmianie schematu bazy: nowa migracja w `supabase/migrations/` (nigdy ręcznie na produkcji), a potem
`supabase gen types typescript --local > src/lib/database.types.ts`.

## Struktura

```
src/calc/        logika obliczeń i testy zgodności z arkuszem (jedyne miejsce na wzory)
src/session/     sesja na żywo: widok rozmówcy (GuestPage), prezentera (SessionPage), logika widoku
                 rozmówcy (guestView, guestRequest — współdzielona z Edge Function), formatowanie
src/company/     NIP i firma: mapowanie GUS, widok firmy, krok „Podaj NIP”
src/cta/         prośba o kalkulację: polityka (limity, blokady), składanie maila ze snapshotu, karta rozmówcy
src/excel/       skoroszyt z kalkulacją (wartości + formuły „Twoja symulacja”), testy parytetu z src/calc
src/email/       szablon maila, marka organizacji, adaptery MailerSend i Mailpit
src/followup/    follow-up: stan z rozmowy, porównanie, oś czasu, pasek klienta, widok konsultanta
src/notify/      powiadomienia dla konsultanta: ładunek, podpis HMAC, dostarczanie do n8n, walidacja adresata
src/profile/     strona „Powiadomienia” (adresat alertów)
src/e2e/         testy end-to-end (poza `npm test`)
src/auth/        logowanie magic linkiem
src/org/         wybór organizacji
src/app/         układ i lista sesji konsultanta
src/lib/         klient Supabase (tylko klucz publiczny) i wygenerowane typy bazy
supabase/
  migrations/    schemat, RLS, triggery, RPC
  tests/         testy pgTAP
  functions/     Edge Functions: guest-session, lookup-company, request-calculation (+ _shared)
  seed.sql       dane deweloperskie (tylko lokalnie)
```

## Do zamknięcia przed pierwszą rozmową z klientem

Checklista wdrożenia (Supabase w chmurze, sekrety, Auth, Vercel, MailerSend, GUS, n8n, próba końcowa) jest w
[`docs/deploy.md`](docs/deploy.md); znane ograniczenia i rzeczy odłożone: [`docs/spec.md`](docs/spec.md), sekcja „Infrastruktura”.

© MITAX Consulting sp. z o.o. Wszelkie prawa zastrzeżone.
