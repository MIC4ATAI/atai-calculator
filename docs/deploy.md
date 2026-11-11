# Wdrożenie: checklista

Dokument prowadzi od zera do działającego środowiska produkcyjnego i kończy się próbą na prawdziwych danych. Kolejność
ma znaczenie. Zasady z `CLAUDE.md` obowiązują także tutaj: **migracje tylko przez Supabase CLI, tajne klucze tylko po
stronie serwera, żadnych sekretów w repozytorium.**

> **Co jest sprawdzone, a co nie.** Pierwsze wdrożenie produkcyjne wykonano 2026-11-11; jego aktualny stan jest w sekcji
> „Stan wdrożenia produkcyjnego” poniżej, a podział na sprawdzone lokalnie i w chmurze w sekcji 10. Wciąż **niesprawdzone**:
> klucz produkcyjny GUS, Telegram + n8n oraz zaplanowane ponawianie alertów w chmurze (Vault nie jest jeszcze skonfigurowany).

## Stan wdrożenia produkcyjnego

*Stan na 2026-11-11. Aktualizuj tę sekcję przy każdej zmianie środowiska. Nie wpisuj tu żadnych wartości sekretów, tylko ich nazwy.*

| Obszar | Stan |
| --- | --- |
| **Supabase** | projekt „MIC4ATAI Project” (`uaevcuzupnukhprcfmzp`), Frankfurt; 8 z 8 migracji; `pg_cron`, `pg_net`, Vault włączone; RLS na 13 tabelach |
| **Funkcje** | 4 aktywne (wersja 1, `verify_jwt = false`): `guest-session`, `lookup-company`, `request-calculation`, `dispatch-notifications`; po kompresji 0,8–1,1 MB |
| **Cron powiadomień** | zadanie `dispatch-notifications` aktywne (co minutę), **Vault pusty** (brak `dispatch_url` i `dispatch_secret`), więc nic nie wywołuje funkcji; do uzupełnienia razem z n8n |
| **Sekrety funkcji (nazwy)** | ustawione: `MAILERSEND_API_TOKEN`, `MAIL_FROM_DEFAULT`, `MAIL_TRANSPORT`, `APP_BASE_URL`, `MAIL_LANDING_INVITATION`, `DISPATCH_SECRET`; **nieustawione:** `GUS_API_KEY`, `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `MAIL_FROM_NAME` |
| **Auth** | Site URL i Redirect URLs na domenę produkcyjną i `*.vercel.app`; własny SMTP (MailerSend), limit 30 maili/h; cooldown 1 min na adres; szablon Magic Link po polsku (temat i treść, potwierdzone mailem); rejestracja wyłączona, konta zakłada operator |
| **Vercel** | projekt `atai-calculator`, gałąź produkcyjna `production`; domena `atai.mitax.pl` (rekord A w OVH, TXT z SPF zachowany) oraz `atai-calculator.vercel.app`; zmienne `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PUBLIC_APP_URL`; zbędne zmienne integracji (`POSTGRES_*`, klucze serwerowe) usunięte; ochrona wdrożeń obejmuje tylko podglądy |
| **Dane** | 1 organizacja (MITAX), 1 konto w roli `owner`; bez telefonu w profilu i **bez linku do polityki prywatności** |
| **Weryfikacja** | `npm run smoke` 19/19; pełna sesja od logowania do wysyłki kalkulacji przeszła na produkcji |

**Otwarte przed pierwszą prawdziwą rozmową:**

- [ ] **Klucz GUS** (`GUS_API_KEY`): bez niego NIP-y są sprawdzane na bazie testowej z nieprawdziwymi danymi firm. **Blokuje prawdziwych klientów.**
- [ ] **Link do polityki prywatności** w organizacji (`organizations.privacy_policy_url`, https); bez niego klauzula RODO przy CTA jest bez odnośnika.
- [ ] **Treści do potwierdzenia z prawnikiem** (sekcja 8): klauzula domyślna, stopka maila, zaproszenie na landing page.
- [ ] **Rotacja tokenu MailerSend:** wartość była widoczna w zapisie sesji roboczej; nowy token ustaw bez wyświetlania (`read -s`).
- [ ] **Potwierdzenie szczegółów maila z kalkulacją:** nadawca, `Reply-To`, link z domeny produkcyjnej, załącznik `.xlsx` z działającymi formułami.
- [ ] **n8n:** workflow, nowy `DISPATCH_SECRET` (sekrety funkcji **i** Vault jednocześnie), `N8N_WEBHOOK_*`, identyfikator czatu w profilu konsultanta.
- [ ] **Stopka „Delivered by MailerSend”** w mailach (zaobserwowana w mailu logowania): sprawdź w MailerSend, czy plan ją wyłącza, zanim klienci dostaną maile z kalkulacją.
- [ ] Opcjonalnie: telefon w profilu konsultanta, `MAIL_FROM_NAME`, nazwa nadawcy w SMTP Supabase (obecnie „Kalkulator”), kolejne konta konsultantów (sekcja 1, pkt 5).

## 0. Wymagania

- Supabase CLI (testowane na 3.1.0), **Docker uruchomiony podczas wdrażania funkcji** (CLI pakuje je lokalnie),
  Node.js i `npm install`.
- Konta: Supabase, Vercel, MailerSend, n8n (z botem Telegram), dostęp do DNS domeny nadawcy i aplikacji.
- Dwa adresy docelowe, które wystąpią w wielu miejscach (zapisz je teraz):
  `APP_URL` (np. `https://atai.mitax.pl`) i `SUPABASE_URL` (`https://<ref>.supabase.co`).

## 1. Supabase w chmurze

1. **Projekt:** osobna organizacja i projekt Supabase, region **Frankfurt (eu-central-1)**. Zapisz hasło bazy w menedżerze
   haseł. Zawrzyj umowę powierzenia (DPA) w ustawieniach organizacji Supabase (wymóg RODO).
2. **Powiąż repozytorium:** `supabase login`, potem `supabase link --project-ref <ref>`.
3. **Migracje:** `supabase db push --dry-run` (przejrzyj listę), potem `supabase db push`. `supabase/seed.sql` **nie jest**
   wdrażany (zawiera konta testowe, tylko lokalnie). Sprawdź: `supabase migration list` pokazuje wszystkie migracje po
   obu stronach.
4. **Rozszerzenia:** migracja `20261111190000_dispatch_cron.sql` włącza `pg_cron`, `pg_net` i Vault (`supabase_vault`).
   Po `db push` otwórz w panelu *Database → Extensions* i potwierdź, że wszystkie trzy są włączone (jeśli migracja nie ma
   uprawnień do któregoś, włącz je ręcznie w panelu i powtórz `db push`); w *SQL editor*:
   `select jobname, schedule from cron.job;` zwraca `dispatch-notifications | * * * * *`.
5. **Użytkownicy i organizacje** (jednorazowo, ręcznie; nie ma jeszcze panelu operatora):
   - *Authentication → Users → Add user* (konto konsultanta, operatora). Logowanie jest wyłącznie magic linkiem
     (`shouldCreateUser: false`), więc **konto musi istnieć wcześniej**. Profil tworzy się automatycznie.
   - W *SQL editor* (jako właściciel bazy) załóż organizację i członkostwa (UUID użytkowników z panelu):

   ```sql
   insert into public.organizations (name, nip, brand, privacy_policy_url, cta_notice)
   values ('MITAX Consulting sp. z o.o.', '<NIP 10 cyfr>',
           jsonb_build_object('senderName', 'MITAX Consulting', 'senderEmail', 'kalkulator@<zweryfikowana-domena>',
                              'primaryColor', '#1f6f5c', 'logoUrl', 'https://<domena>/logo.png'),
           'https://<domena>/polityka-prywatnosci', null)
   returning id;
   insert into public.memberships (org_id, user_id, role) values ('<org id>', '<user uuid>', 'owner');  -- owner | admin | consultant
   insert into public.platform_operators (user_id) values ('<uuid operatora>');                         -- tylko konta operatora platformy
   update public.profiles set full_name = 'Imię Nazwisko', phone = '+48 ...', signature = E'Imię Nazwisko\nStanowisko' where user_id = '<user uuid>';
   ```

6. **Auth:** patrz sekcja 2 (wymagane przed pierwszym logowaniem).
7. **Funkcje:** patrz sekcja 3.
8. **Cron powiadomień (Vault):** adres funkcji i sekret **nie są w migracji** (różnią się między środowiskami). W
   *SQL editor* ustaw je raz:

   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/dispatch-notifications', 'dispatch_url');
   select vault.create_secret('<DISPATCH_SECRET>', 'dispatch_secret');   -- ten sam sekret co w sekretach funkcji (sekcja 3)
   ```

   Bez tych dwóch wartości zadanie nic nie robi. Zmiana później: `select vault.update_secret('<id>', '<nowa wartość>');`
   (id z `select id, name from vault.secrets;`). Zadanie wywołuje funkcję tylko wtedy, gdy w outboxie coś czeka.

## 2. Supabase Auth (panel: *Authentication*)

| Ustawienie | Wartość | Dlaczego |
| --- | --- | --- |
| Site URL | `APP_URL` | domyślny cel linków w mailach logowania |
| Redirect URLs | `APP_URL/**` (oraz ewentualnie `https://*-<team>.vercel.app/**` dla podglądów) | aplikacja przekierowuje po magic linku na `<origin>/org`; adres spoza listy zostanie odrzucony |
| Allow new users to sign up | **wyłączone** | konta zakłada operator; otwarta rejestracja pozwalałaby każdemu z kluczem publicznym tworzyć konta |
| Confirm email | zgodnie z domyślnym | konta tworzy operator |
| SMTP | własny (MailerSend SMTP albo inny), nadawca z zweryfikowanej domeny | wbudowany nadawca Supabase ma bardzo niski limit i nie nadaje się na produkcję |
| Rate limits (e-mail) | dostosuj do liczby konsultantów | lokalny `config.toml` ma 30/h tylko na potrzeby testów |
| Szablon „Magic Link” | polski (poniżej) | domyślny jest angielski |

Propozycja szablonu *Magic Link* (temat: `Twój link do logowania`):

```html
<p>Dzień dobry,</p>
<p>aby zalogować się do kalkulatora, kliknij: <a href="{{ .ConfirmationURL }}">Zaloguj się</a>.</p>
<p>Link jest jednorazowy i wygaśnie. Jeśli to nie Ty o niego prosiłeś(-aś), zignoruj tę wiadomość.</p>
```

## 3. Edge Functions

**Wdrożenie:** `npm run functions:deploy` (najpierw buduje `supabase/functions/_vendor/exceljs.js`, potem
`supabase functions deploy`). Nie używaj `--use-api`: pakowanie po stronie serwera ma limit **5 MB**, lokalne
(Docker) **20 MB**, a paczki mają 8–11 MB. Ustawienia `verify_jwt` czytane są z `supabase/config.toml` (wszystkie cztery
funkcje mają `verify_jwt = false`: rozmówca nie ma konta, a `dispatch-notifications` wywołuje baza z własnym sekretem).

Pomiary rozmiaru paczek (surowa paczka eszip, lokalnie; platforma nie podaje, czy liczy przed czy po kompresji):

| Funkcja | Surowo | Po gzip |
| --- | --- | --- |
| `guest-session` | 8,4 MB | 1,8 MB |
| `lookup-company` | 10,7 MB | 2,5 MB |
| `request-calculation` | 9,9 MB (było 43 MB z pakietem `npm:exceljs`) | 2,2 MB |
| `dispatch-notifications` | 8,4 MB | 1,8 MB |

**Dwie zasady, które to umożliwiają (nie cofaj ich):** (1) każda funkcja ma własny `deno.json`; bez niego Deno widzi
`package.json` w katalogu głównym i nie rozwiązuje `npm:bir1` (funkcja się nie buduje) ani nie odcina zależności
frontendu (paczka rośnie do 147 MB); (2) `request-calculation` importuje `exceljs` z jednego, wygenerowanego pliku
(`_vendor/exceljs.js`, w `.gitignore`) zamiast z drzewa pakietów npm. **Plik trzeba zbudować przed każdym
`serve`/`deploy`** (robią to `npm run functions:serve` i `functions:deploy`).

**Sekrety** (`supabase secrets set NAZWA=wartość`, najlepiej jednym poleceniem z pliku poza repozytorium:
`supabase secrets set --env-file <plik>`; `SUPABASE_URL` i klucz service role są wstrzykiwane automatycznie):

| Sekret | Wartość na produkcji |
| --- | --- |
| `MAIL_TRANSPORT` | `mailersend` (**nigdy** `mailpit`; to lokalna skrzynka deweloperska) |
| `MAILERSEND_API_TOKEN` | token API MailerSend (sekcja 5) |
| `MAIL_FROM_DEFAULT`, `MAIL_FROM_NAME` | nadawca awaryjny z zweryfikowanej domeny |
| `APP_BASE_URL` | `APP_URL` (z niego powstają linki do sesji w mailach i w alertach) |
| `GUS_API_KEY` | klucz produkcyjny GUS (sekcja 6); **bez niego funkcja używa bazy TESTOWEJ** |
| `MAIL_LANDING_INVITATION` | `off` (domyślnie), `on` dopiero gdy istnieje landing page organizacji |
| `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET` | adres produkcyjny webhooka (https) i wspólny sekret min. 16 znaków (sekcja 7) |
| `DISPATCH_SECRET` | losowy sekret min. 32 znaki (`openssl rand -hex 32`); ten sam trafia do Vault (sekcja 1, pkt 8) |

Nie ustawiaj `MAILPIT_URL`. Po zmianie sekretów funkcje używają nowych wartości przy następnym uruchomieniu instancji.

### Rotacja i zmiana sekretów (bez ujawniania wartości)

Wartość sekretu **nie może** pojawić się w repozytorium, w poleceniu wpisanym wprost ani w czacie z asystentem (trafia do historii powłoki
i zapisu sesji). Procedura dla macOS:

1. W panelu dostawcy (np. MailerSend) utwórz **nowy** sekret i skopiuj go do schowka (Cmd+C).
2. Ustaw go, wstawiając zawartość schowka i od razu czyszcząc schowek:

   ```bash
   supabase secrets set --yes MAILERSEND_API_TOKEN="$(pbpaste)"; pbcopy </dev/null
   ```

   **Nie używaj `read -s`** w poleceniach uruchamianych z asystenta (`!`): nie ma tam interaktywnego terminala, `read` nie dostaje
   niczego i sekret zostaje ustawiony na **pustą** wartość bez żadnego komunikatu błędu (tak się stało przy pierwszej rotacji tokenu
   MailerSend, a `request-calculation` zwracał wtedy 500). W zwykłym oknie terminala `read -s T; … "$T"; unset T` działa poprawnie.
3. **Sprawdź, że wartość nie jest pusta.** `supabase secrets list` pokazuje tylko skrót SHA-256 (nigdy wartość). Skrót pustego napisu to
   `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; jeśli sekret ma taki skrót, jest pusty i trzeba go ustawić ponownie.
4. Uruchom `npm run smoke -- <SUPABASE_URL> <klucz publiczny> <APP_URL>` (musi przejść w całości), a potem **sprawdź prawdziwe użycie**
   (patrz tabela). `smoke` potwierdza kompletność konfiguracji, nie to, czy dostawca akceptuje nową wartość.
5. **Dopiero po udanym teście unieważnij stary sekret** u dostawcy. Odwrotna kolejność zostawia aplikację bez wysyłki, jeśli nowa wartość
   okaże się błędna.

| Sekret | Gdzie zmienić | Jak sprawdzić prawdziwe użycie |
| --- | --- | --- |
| `MAILERSEND_API_TOKEN` | sekrety funkcji (krok 2) | jedna prawdziwa prośba o kalkulację na własny adres (CTA): mail dochodzi; 401 od MailerSend w logu funkcji = zły token |
| `N8N_WEBHOOK_SECRET` | sekrety funkcji **i** zmienna `ATAI_WEBHOOK_SECRET` w n8n, **jednocześnie** (inaczej n8n odrzuca podpisy: 401) | wywołanie próbne z `n8n-followup.md`, sekcja „Sprawdzenie” |
| `DISPATCH_SECRET` | sekrety funkcji **i** Vault: `select vault.update_secret('<id>', '<nowa wartość>')` (id z `select id, name from vault.secrets;`) | `smoke` (401 bez sekretu), a po wpisie w Vault zaległy alert dochodzi bez ruchu klienta |
| `GUS_API_KEY` | sekrety funkcji | NIP prawdziwej firmy zwraca jej prawdziwą nazwę |
| Dane SMTP dla Auth (maile logowania) | **panel** Supabase: *Authentication → Emails → SMTP Settings* (nie sekrety funkcji) | nowy link logowania dochodzi |

Sekrety wymieniane razem (webhook n8n, Vault) ustawiaj w jednym oknie czasowym, najlepiej poza godzinami, w których ktoś prowadzi rozmowę.

**Po wdrożeniu:** `npm run smoke -- <SUPABASE_URL> <klucz publiczny> <APP_URL>`. Skrypt używa tylko klucza publicznego i
nieistniejących tokenów (niczego nie tworzy): sprawdza odpowiedzi publicznych funkcji, że `dispatch-notifications` odrzuca
żądania bez sekretu (503 oznacza brak `DISPATCH_SECRET`), że anonimowy odczyt 10 kluczowych tabel jest zabroniony oraz że
Vercel przepisuje trasy SPA. Wszystkie kontrole mają przejść.

## 4. Vercel

1. Import repozytorium; preset **Vite**, build `npm run build`, katalog wyjściowy `dist` (bez zmian względem domyślnych).
2. **Zmienne środowiskowe (Production i Preview):** `VITE_SUPABASE_URL` = `SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` = klucz
   **publiczny** (anon/publishable). **Nigdy** klucz service role: wszystko z prefiksem `VITE_` trafia do przeglądarki.
   Zmienne `POSTGRES_*`, `SUPABASE_JWT_SECRET` i `SUPABASE_SECRET_KEY`, które dodaje integracja Supabase–Vercel, usuń
   (frontend ich nie używa, a omijają RLS).
   **`VITE_PUBLIC_APP_URL` (Production) = `APP_URL`** (np. `https://atai.mitax.pl`): adres używany w linku dla rozmówcy. Bez niej link
   powstaje z adresu, z którego konsultant otworzył aplikację, a adresy `*-<team>.vercel.app` i `…-git-<branch>-…vercel.app` są
   chronione logowaniem Vercela (rozmówca zobaczyłby logowanie). Zmienna jest wkompilowywana w czasie budowania: po jej
   dodaniu lub zmianie trzeba **ponownie wdrożyć** projekt (Redeploy).
3. `vercel.json` w repozytorium przepisuje wszystkie ścieżki na `index.html` (trasy `/s/<token>`, `/session/<id>` działają
   po odświeżeniu). Skrypt `smoke` to sprawdza.
4. **Plan i konto:** zgodnie ze specyfikacją Hobby wyłącznie do budowy i testów; **przed pierwszą rozmową z prawdziwym klientem
   team na planie Pro i transfer projektu** 
5. **Domena:** dodaj `atai.mitax.pl` w ustawieniach projektu i skonfiguruj rekord DNS u operatora strefy. **Uwaga:** jeśli nazwa
   ma już inne rekordy (np. TXT z SPF dla MailerSend, gdy z tej poddomeny wysyłasz maile), **nie dodasz CNAME** (CNAME nie
   współistnieje z innymi rekordami tej samej nazwy): użyj rekordu **A** (`216.198.79.1`, opcjonalnie `64.29.17.1`) i zostaw SPF.
   Strefa na zewnętrznych serwerach nazw (np. OVH) nie pozwala Vercelowi dopisać rekordów samemu. Po zmianie adresu zaktualizuj Site
   URL i Redirect URLs (sekcja 2), `APP_BASE_URL` (sekcja 3) i `VITE_PUBLIC_APP_URL`.
6. Podglądy (Preview): chroń je opcją *Deployment Protection*, jeśli łączą się z projektem produkcyjnym Supabase.

## 5. MailerSend (wysyłka kalkulacji)

1. *Domains → Add domain*: domena nadawcy (ta, z której pochodzą adresy w `brand.senderEmail` i `MAIL_FROM_DEFAULT`).
2. U operatora DNS dodaj rekordy podane przez MailerSend: **SPF**, **DKIM** (CNAME) i rekord **return-path**; dodaj też
   **DMARC** (`_dmarc` TXT, na start `p=none` z adresem raportów). Poczekaj na weryfikację (status „Verified”).
3. *API tokens*: token z uprawnieniem tylko do wysyłki wiadomości; wartość do sekretu `MAILERSEND_API_TOKEN`.
4. **Każda organizacja** musi mieć `brand.senderEmail` na zweryfikowanej domenie, inaczej MailerSend odrzuci wiadomość (422).
   Organizacja bez własnego nadawcy używa `MAIL_FROM_DEFAULT`.
5. Śledzenie otwarć i kliknięć jest wyłączone w kodzie (prywatność klienta). `Reply-To` to adres logowania konsultanta.
6. Sprawdź limity i ograniczenia swojego planu (konta próbne bywają ograniczone) zanim zaplanujesz pierwszą rozmowę.
7. Uwaga: odpowiedź 202 bez `x-message-id` oznacza, że wszyscy odbiorcy są zablokowani (wiadomość **nie** została wysłana);
   kod to rozpoznaje i zapisuje dostawę jako nieudaną.

## 6. GUS (dane firm po NIP)

1. Wniosek o klucz produkcyjny BIR1: e-mail na **regon_bir@stat.gov.pl** (instrukcja na stronie GUS „API BIR1”).
   Czas oczekiwania na klucz bywa nieprzewidywalny: **zrób to z wyprzedzeniem**.
2. Ustaw sekret `GUS_API_KEY`. **Uwaga:** gdy sekret jest pusty, funkcja po cichu używa publicznej bazy **testowej**
   (stare, zanonimizowane dane, np. „ul. Test-Krucza”). To dobre do rozwoju, a na produkcji dałoby klientom nieprawdziwe
   dane firmy. Zweryfikuj w próbie końcowej, że prawdziwy NIP zwraca prawdziwą nazwę.
3. Dane firm są buforowane w tabeli `companies` przez 30 dni (limit zapytań do GUS). Po pierwszym zimnym starcie funkcji
   zapytanie może przekroczyć limit 8 s i zakończyć się „GUS niedostępny”; rozmowa toczy się dalej, ponowienie uzupełnia dane.

## 7. n8n i Telegram (alerty o powrocie klienta)

Pełna instrukcja, format żądania i szablon workflow: [`n8n-followup.md`](n8n-followup.md). Skrót: bot Telegram (BotFather),
zmienne `ATAI_WEBHOOK_SECRET` i `NODE_FUNCTION_ALLOW_BUILTIN=crypto` w n8n, import `n8n-followup-workflow.json`,
poświadczenia bota, **aktywacja workflow**, adres produkcyjny webhooka do `N8N_WEBHOOK_URL`. Każdy konsultant wpisuje swój
identyfikator czatu na stronie *Powiadomienia* w aplikacji. Szablon nie był jeszcze uruchomiony w żywej n8n:
wykonaj próbę z sekcji „Sprawdzenie” w tej instrukcji.

**Instancja n8n działa na własnym serwerze w Polsce** (stan na 2026-11-11), więc dane z alertów nie opuszczają EOG po drodze
do n8n. Wymagania z tego wynikające:

- **Publiczny adres https.** Funkcje Supabase wywołują webhook z internetu (adresy wyjściowe Supabase nie są stałe, więc nie da się
  ograniczyć dostępu listą adresów IP). Potrzebny jest ważny certyfikat od publicznego urzędu (np. Let's Encrypt) i adres
  `https://…`: kod odrzuca `http` (wyjątek tylko dla `localhost`/`host.docker.internal`) i nie śledzi przekierowań.
- **Ochrona przed nadużyciem** zapewnia podpis HMAC i znacznik czasu (żądanie bez poprawnego podpisu dostaje 401), ale warto
  dodatkowo ograniczyć częstość żądań na reverse proxy (np. kilka na sekundę na adres) i wystawić publicznie **tylko** ścieżkę webhooka.
- **Dane wykonań:** n8n zapisuje treść każdego żądania (organizacja, imię konsultanta, identyfikator czatu, link do sesji). Włącz czyszczenie
  historii wykonań (`EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE` w godzinach), żeby te dane nie leżały dłużej, niż trzeba.
- **Trwałość deduplikacji:** pamięć 500 ostatnich identyfikatorów jest w danych statycznych workflow i przetrwa restart tylko przy
  trwałej bazie n8n (nie w trybie pamięciowym) i aktywnym workflow.
- **Telegram** to osobny odbiorca poza Twoją kontrolą: wiadomość (nazwa organizacji, tekst alertu, link do widoku konsultanta) trafia na
  serwery Telegrama. Dane klienta w niej nie ma, ale to dane konsultanta (patrz `n8n-followup.md`, „Uwaga prawna”).

## 8. Dane organizacji przed pierwszą rozmową

Uzupełnij (SQL editor, jako właściciel; edytować może też właściciel organizacji przez API):

- `organizations.privacy_policy_url`: **link do polityki prywatności organizacji (https)**. Bez niego klauzula informacyjna
  przy CTA wyświetla się bez linku, a to nie spełnia obowiązku informacyjnego. Baza odrzuca adresy inne niż https.
- `organizations.cta_notice`: własna treść klauzuli przy polu e-mail (20–1500 znaków, akapity rozdzielone pustą linią,
  `{organization}` zostanie zastąpione nazwą). Pusta = treść domyślna z `src/cta/notice.ts`.
- `organizations.brand`: nadawca, kolor, logo; `default_params`: założenia kalkulatora, jeśli mają różnić się od wbudowanych.

**Strona polityki prywatności w aplikacji:** publiczna podstrona `/polityka-prywatnosci` (treść i dane administratora w `src/legal/policy.ts`,
konfiguracja `MITAX_POLICY`). Dopóki brakuje danych (adres siedziby, adres e-mail do kontaktu, okres przechowywania, sposób
realizacji żądania usunięcia, szczegóły przekazywania poza EOG) albo `legalReviewedAt` jest puste, strona pokazuje ostrzeżenie
„Projekt dokumentu” i prosi wyszukiwarki o nieindeksowanie. **Nie wpisuj jej w `organizations.privacy_policy_url`, dopóki
nie jest ostateczna.** Kolejność: uzupełnij dane w `MITAX_POLICY` → prawnik zatwierdza treść → wpisz `legalReviewedAt` (data)
→ wdróż → ustaw `privacy_policy_url = https://atai.mitax.pl/polityka-prywatnosci`. Kolejna organizacja wymaga własnej
konfiguracji (administratorem jest organizacja, nie platforma).

**Treści do potwierdzenia z prawnikiem przed pierwszą rozmową** (stałe w kodzie, oznaczone „BRZMIENIE DO POTWIERDZENIA”):
`DEFAULT_CTA_NOTICE` (`src/cta/notice.ts`: m.in. podstawa prawna, okres przechowywania, odbiorcy danych: dostawca poczty
i operator platformy jako podmiot przetwarzający, dane kontaktowe administratora), `ONE_TIME_NOTICE_TEXT` (stopka maila)
i `LANDING_INVITATION_TEXT` (zaproszenie na landing page). Kalkulator **nie zbiera zgód marketingowych**: klauzula tylko
informuje, a zgody zbiera landing page organizacji (etap 4).

**Zaproszenie na landing page w mailu.** Do czasu powstania landing page'y jest **wyłączone** (`MAIL_LANDING_INVITATION=off`,
wartość domyślna), żeby mail nie prowadził klienta na nieistniejącą stronę. Jeśli organizacja chce je włączyć wcześniej,
minimalna wersja to **jedna strona kontaktowa organizacji, poza tym repozytorium**: formularz (imię, e-mail, telefon,
opcjonalnie wiadomość), pełna klauzula informacyjna organizacji z linkiem do polityki prywatności oraz **osobne, niezaznaczone**
zgody (kontakt handlowy i inne cele jako odrębne pola), zapis treści klauzuli z wersją, datą, godziną i adresem IP przy każdej
zgodzie (wymóg ze specyfikacji). Gdy taka strona działa: ustaw `brand.landingUrl` organizacji i `MAIL_LANDING_INVITATION=on`.

## 9. Próba końcowa (na prawdziwych danych, przed pierwszą rozmową)

Wykonaj jako konsultant z kontem w prawdziwej organizacji i z adresem e-mail, który kontrolujesz.

- [ ] `npm run smoke -- <SUPABASE_URL> <klucz publiczny> <APP_URL>`: wszystko zielone.
- [ ] Logowanie magic linkiem: mail po polsku, link prowadzi na `APP_URL/org` (nie na localhost).
- [ ] *Nowa sesja* → link dla rozmówcy otwiera się w oknie prywatnym.
- [ ] Prawdziwy NIP: wraca **prawdziwa** nazwa firmy z GUS (nie „Test-Krucza”).
- [ ] Dane → *Odsłoń wynik*; przykład kontrolny daje 121 h, +10 KH + 20 KPiR przy miksie 10.
- [ ] CTA: klauzula z nazwą organizacji i **działającym linkiem do polityki prywatności**; wysyłka na własny adres.
- [ ] Mail dotarł (nie do spamu), nadawca z zweryfikowanej domeny, `Reply-To` konsultanta, brak zaproszenia na landing page
  (jeśli flaga wyłączona), link do sesji działa; załącznik `.xlsx` otwiera się w Excelu, zakładka „Twoja symulacja” ma działające formuły.
- [ ] Powrót klienta do linku: alert na Telegramie (jeden na wizytę), widok follow-up konsultanta pokazuje powrót i zmiany.
- [ ] „Wróć do stanu z rozmowy” u klienta przywraca dane z rozmowy.
- [ ] Zatrzymaj workflow n8n, wywołaj powrót klienta, uruchom workflow: zaległy alert dochodzi w ciągu ok. minuty bez ruchu
  klienta (cron); `select status, attempts from notification_outbox order by id desc limit 5;`.
- [ ] Logi funkcji (*Edge Functions → Logs*) bez błędów konfiguracji (`notify: błędna konfiguracja`, brak `APP_BASE_URL` itd.).

## 10. Stan weryfikacji (co sprawdzono lokalnie, a czego nie)

Sprawdzono (lokalnie, 2026-11-11): wszystkie migracje i testy bazy (pgTAP), testy e2e na prawdziwych funkcjach, bazie i
Mailpicie, **pakowanie wszystkich funkcji poleceniem `edge-runtime bundle` tym samym obrazem, którego CLI używa przy wdrożeniu**
(wykryło dwa błędy opisane w sekcji 3 i je naprawiło), działanie zadania `pg_cron` + `pg_net` + Vault na lokalnym stosie
(zaległy alert dostarczony bez ruchu klienta) oraz skrypt `smoke`.

**Sprawdzono w chmurze (2026-11-11):** prawdziwe `supabase functions deploy` (importy spoza `supabase/functions` są poprawnie
dołączane, pakowanie lokalne przez Docker), `db push` 8 migracji, rozszerzenia `pg_cron`/`pg_net`/Vault i zadanie cron na
hostowanym Supabase (zadanie zarejestrowane i aktywne), `npm run smoke` na produkcji, własny SMTP dla Auth, MailerSend,
domena na Vercelu z certyfikatem oraz pełna sesja z wysyłką kalkulacji.

**Nadal nie sprawdzono:** działanie zaplanowanego zadania w chmurze (wymaga wpisów w Vault), Telegram i n8n, produkcyjny GUS.
Szablon workflow n8n nie był uruchomiony w żywej instancji: wykonaj próbę z sekcji „Sprawdzenie” w `n8n-followup.md`.

## 11. Znane ograniczenia (świadomie odłożone)

- Brak limitu zapytań do publicznych funkcji na IP (chroni je 192-bitowy token i limit rozmiaru ciała 16 KB); rozważ regułę na
  bramie lub WAF.
- Brak procedury usuwania danych na żądanie (RODO): sesje z historią są nieusuwalne z założenia (klucze `RESTRICT`); potrzebna
  osobna, udokumentowana migracja z jawnym wyłączeniem triggera dla wskazanych rekordów.
- Brak przycisku „wyślij alert testowy” na stronie *Powiadomienia*: błędny, ale poprawnie sformatowany identyfikator czatu nie daje sygnału.
- Brak edycji marki, klauzuli i linku do polityki w interfejsie (etap 4): zmiany przez SQL.
- Rotacja sekretów: procedura i kolejność w sekcji 3 („Rotacja i zmiana sekretów”). Rotacja nie jest zautomatyzowana ani
  przypominana: ustal terminarz (np. po odejściu osoby z dostępem do panelu dostawcy albo gdy sekret mógł zostać ujawniony).
