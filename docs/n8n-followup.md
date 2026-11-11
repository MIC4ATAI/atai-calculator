# Alert o powrocie klienta: workflow n8n

Kalkulator wysyła do n8n krótki, podpisany webhook za każdym razem, gdy klient, który dostał kalkulację, **wraca do
swojej sesji** albo **zmienia dane** (jedno powiadomienie na wizytę, wizyta kończy się po 30 min ciszy). Workflow
weryfikuje podpis i wysyła konsultantowi wiadomość na Telegramie.

> **Status:** plik `docs/n8n-followup-workflow.json` to szablon do zaimportowania. Kod węzła weryfikującego podpis jest
> przetestowany na prawdziwych żądaniach z kalkulatora (`src/notify/n8nWorkflow.test.ts`), ale sam szablon **nie był
> jeszcze uruchomiony w żywej instancji n8n**. Po imporcie wykonaj próbę z sekcji „Sprawdzenie”.

## Co przychodzi (minimum + link)

Zgodnie z decyzją produktową do n8n nie trafiają dane leada: nazwa firmy, NIP, e-mail klienta ani wartości z kalkulacji.

```json
{
  "eventId": "ntf-42",
  "kind": "client_changed",
  "newVisit": false,
  "occurredAt": "2026-11-11T17:52:00.000Z",
  "organization": "MITAX Consulting sp. z o.o.",
  "consultantName": "Ola Konsultant",
  "sessionUrl": "https://atai.mitax.pl/session/<id>/follow-up",
  "changedFields": 2,
  "message": "MITAX Consulting sp. z o.o.: Klient zmienił dane w kalkulacji (zmienione pola: 2).",
  "channel": { "type": "telegram", "target": "123456789" }
}
```

- `kind`: `client_returned` (klient otworzył stronę) albo `client_changed` (zmienił dane; `newVisit: true`, gdy zmiana
  rozpoczęła wizytę, więc osobnego „wrócił” nie będzie).
- `sessionUrl` otwiera widok follow-up konsultanta (wymaga zalogowania).
- `message` jest gotowym tekstem alertu po polsku; workflow może wysłać go bez obróbki.

Nagłówki: `X-Timestamp` (sekundy, same cyfry), `X-Event-Id` (do deduplikacji), `X-Signature` =
`sha256=` + HMAC-SHA256(sekret, `<X-Timestamp>.<treść żądania>`).

## Konfiguracja

1. **n8n:** zaimportuj `docs/n8n-followup-workflow.json`, w węźle „Wyślij na Telegram” wskaż poświadczenia bota
   (token od @BotFather), a w węźle „Oblicz podpis (HMAC)” wklej w polu **Secret** wspólny sekret (losowy, min. 16 znaków;
   do czasu wklejenia stoi tam `WKLEJ_SEKRET_TUTAJ` i workflow odrzuca wszystko z kodem 500). Potem **aktywuj workflow**
   (adres produkcyjny webhooka działa tylko dla aktywnego; pamięć deduplikacji też). Nie są potrzebne żadne zmienne
   środowiskowe serwera: podpis liczy wbudowany węzeł Crypto, a kod nie używa `require` ani `$env`.
   Sekret leży w workflow (widać go w edytorze i w kopiach zapasowych n8n), więc ogranicz dostęp do tego workflow.
2. **Supabase (funkcje):** `supabase secrets set N8N_WEBHOOK_URL=<produkcyjny adres webhooka z n8n>`
   `N8N_WEBHOOK_SECRET=<ten sam sekret co w węźle Crypto>` (ustaw przez schowek, nie wpisując wartości w poleceniu). Adres musi być https. Bez `N8N_WEBHOOK_URL`
   wysyłka jest wyłączona (alerty czekają w outboxie).
3. **Konsultant:** w aplikacji, na stronie „Powiadomienia”, wpisuje identyfikator swojego czatu z botem (w grupach
   zaczyna się od minusa). Pusty identyfikator wyłącza alerty. Konsultant musi wcześniej napisać do bota, żeby bot mógł
   do niego pisać.

## Co robi workflow

1. **Webhook z kalkulatora:** POST, odpowiedź zwraca węzeł „Respond to Webhook” (kod HTTP zależy od wyniku).
2. **Oblicz podpis (HMAC):** węzeł Crypto liczy HMAC-SHA256 z `<X-Timestamp>.<treść>` i sekretu z pola Secret.
3. **Sprawdź podpis i duplikaty:** porównuje podpis w stałym czasie i odrzuca żądanie ze złym lub brakującym podpisem (401), ze znacznikiem czasu, który
   nie jest liczbą całkowitą, albo starszym niż 5 minut (401), oraz przy sekrecie zastępczym lub krótszym niż 16 znaków (500). Alert, który już
   obsłużono (ten sam `X-Event-Id`), kończy się odpowiedzią 200 bez wysyłki.
4. **Czy wysłać alert?** → **Wyślij na Telegram** (czat z pola `channel.target`, tekst `message` + `sessionUrl`)
   → **Odpowiedz 200**. Pozostałe przypadki: odpowiedź z kodem z kroku 3.

Odpowiedź inna niż 2xx oznacza dla kalkulatora ponowienie (do 5 prób). Dostarczanie jest „co najmniej raz”: gdy n8n
odpowie 200, a kalkulator nie zdąży zapisać potwierdzenia, ten sam alert może przyjść ponownie. Stąd deduplikacja po
`X-Event-Id` (workflow pamięta 500 ostatnich identyfikatorów w danych statycznych).

## Sprawdzenie

Z lokalnego terminala (podstaw swój adres, sekret i identyfikator czatu; sekret nie trafia do historii, jeśli
ustawisz go przez `read -s`):

```bash
read -s ATAI_SECRET; TS=$(date +%s)
BODY='{"eventId":"ntf-test-1","kind":"client_returned","newVisit":false,"occurredAt":"2026-11-11T17:52:00.000Z","organization":"Test","consultantName":null,"sessionUrl":"https://example.com/session/test/follow-up","changedFields":null,"message":"Test: Klient wrócił do kalkulacji.","channel":{"type":"telegram","target":"<twój chat id>"}}'
SIG="sha256=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$ATAI_SECRET" -hex | sed 's/^.* //')"
curl -i -X POST "<adres webhooka>" -H 'Content-Type: application/json' \
  -H "X-Timestamp: $TS" -H "X-Event-Id: ntf-test-1" -H "X-Signature: $SIG" --data "$BODY"
```

Oczekiwane: 200 i wiadomość na Telegramie. Powtórzenie tego samego polecenia: 200 bez drugiej wiadomości (duplikat).
Zmiana jednego znaku w `$BODY` po podpisaniu: 401.

## Uwaga prawna

Przez n8n (infrastrukturę operatora) przechodzą: nazwa organizacji, imię konsultanta, jego identyfikator czatu
i link do sesji. Nie są to dane leadów, ale są to dane osobowe konsultanta, więc powinny być ujęte w umowie powierzenia.

Instancja n8n działa na własnym serwerze w Polsce, więc ten etap przepływu pozostaje w EOG i nie wymaga mechanizmu przekazania.
Wiadomość wysłana dalej przez bota trafia na serwery Telegrama (poza naszą kontrolą i najpewniej poza EOG): zawiera tylko
nazwę organizacji, krótki tekst o zdarzeniu i link do widoku konsultanta, bez danych firmy ani adresu e-mail klienta. Treść
wykonań w n8n warto okresowo czyścić (patrz `deploy.md`, sekcja 7).

## Rozwiązywanie problemów

- **`Module 'crypto' is disallowed`:** dotyczy starszej wersji szablonu (kod z `require('crypto')`). Obecny szablon
  liczy podpis węzłem Crypto i nie wymaga zmian na serwerze; zaimportuj go ponownie.
- **500 `sekret_nie_ustawiony`:** w polu Secret węzła „Oblicz podpis (HMAC)” jest znacznik albo sekret krótszy niż 16 znaków.
- **401 `zly_podpis`:** sekret w węźle różni się od `N8N_WEBHOOK_SECRET` w Supabase (sprawdź skrót przez
  `supabase secrets list`; pusty sekret ma skrót `e3b0c442…b855`).
- **403 z Supabase do n8n:** jeśli przed n8n stoi Cloudflare, reguły WAF/„Bot Fight” mogą blokować POST z serwerów;
  dodaj wyjątek dla ścieżki `/webhook/atai-followup`. Pamiętaj, że Cloudflare jest wtedy pośrednikiem w transmisji
  (treść alertu: nazwa organizacji, krótki tekst i link).
