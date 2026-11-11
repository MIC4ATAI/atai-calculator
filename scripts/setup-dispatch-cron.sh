#!/usr/bin/env bash
# Włącza cron ponawiania powiadomień na projekcie podlinkowanym przez Supabase CLI (zwykle produkcja).
# Sekret jest czytany ze schowka (pbpaste) i nigdy nie jest wypisywany ani wpisywany w poleceniu.
#
#   openssl rand -hex 32 | pbcopy
#   bash scripts/setup-dispatch-cron.sh
#
# Kroki: (1) DISPATCH_SECRET w sekretach funkcji, (2) dispatch_url i dispatch_secret w Vault (tworzy lub aktualizuje),
# (3) schowek jest czyszczony. Kolejność ma znaczenie: funkcja dostaje sekret przed Vault, więc cron nigdy nie wywoła
# jej ze złym sekretem.
set -euo pipefail

command -v pbpaste >/dev/null || { echo "Brak pbpaste (skrypt jest dla macOS)."; exit 1; }
SECRET="$(pbpaste)"
if [ "${#SECRET}" -lt 32 ]; then
  echo "Sekret w schowku ma mniej niż 32 znaki (albo schowek jest pusty). Wygeneruj: openssl rand -hex 32 | pbcopy"
  exit 1
fi
case "$SECRET" in *[!0-9a-zA-Z_-]*) echo "Sekret zawiera niedozwolone znaki (użyj openssl rand -hex 32)."; exit 1;; esac

REF="$(tr -d '[:space:]' < supabase/.temp/project-ref)"
URL="https://${REF}.supabase.co/functions/v1/dispatch-notifications"

echo "Projekt: ${REF}"
echo "1/3 DISPATCH_SECRET w sekretach funkcji"
supabase secrets set --yes DISPATCH_SECRET="$SECRET" >/dev/null

echo "2/3 Vault: dispatch_url i dispatch_secret"
SQL_FILE="$(mktemp)"
trap 'rm -f "$SQL_FILE"' EXIT
chmod 600 "$SQL_FILE"
cat > "$SQL_FILE" <<SQL
do \$\$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'dispatch_url';
  if v_id is null then perform vault.create_secret('${URL}', 'dispatch_url');
  else perform vault.update_secret(v_id, '${URL}'); end if;

  select id into v_id from vault.secrets where name = 'dispatch_secret';
  if v_id is null then perform vault.create_secret('${SECRET}', 'dispatch_secret');
  else perform vault.update_secret(v_id, '${SECRET}'); end if;
end \$\$;
SQL
# Zapis do hostowanej bazy wymaga --yes. Wynik zwykle nie zawiera sekretu, ale błąd z kontekstem PL/pgSQL mógłby go zacytować,
# więc przy niepowodzeniu pokazujemy tylko kod i krótki komunikat, bez treści zapytania.
if ! OUT="$(supabase db query --remote --yes -f "$SQL_FILE" 2>&1)"; then
  echo "Zapis do Vault się nie powiódł:"
  printf '%s\n' "$OUT" | grep -oE '"code":"[^"]*"|ERROR: +[0-9A-Z]+: [^\\"]{0,120}' | head -3
  echo "Sekret funkcji (krok 1) jest już ustawiony; po naprawie uruchom skrypt ponownie z nowym sekretem w schowku."
  pbcopy </dev/null
  exit 1
fi

echo "3/3 Czyszczenie schowka"
pbcopy </dev/null
echo "Gotowe. Sprawdź: supabase secrets list (skrót DISPATCH_SECRET inny niż pusty) i zaległe wpisy outboxu po minucie."
