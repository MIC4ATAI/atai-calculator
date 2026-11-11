// Edge Function: NIP rozmówcy → dane firmy z GUS, przypięte do sesji (bez logowania, po tokenie z linku).
//
// Rozmówca nie ma dostępu do żadnej tabeli. Funkcja sprawdza NIP (suma kontrolna), korzysta z pamięci
// podręcznej `companies` (30 dni), a w razie potrzeby pyta GUS, zapisuje firmę i przypina ją do sesji
// przez RPC `attach_company_to_session` (atomowo, z blokadą po utworzeniu leada i limitem zmian NIP).
// Zwraca wyłącznie widok bezpieczny dla rozmówcy (nazwa, adres) — nigdy surową odpowiedź GUS.
//
// POST { token, nip }
// → 200 { company }                         firma przypięta (company.gusStatus 'unavailable' = GUS niedostępny)
// → 400 { error: 'bad_request' | 'invalid_nip' }
// → 404 { error: 'not_found' }              sesja nie istnieje lub jest zarchiwizowana
// → 409 { error: 'nip_locked' }             lead już utworzony — NIP jest zablokowany
// → 422 { error: 'company_not_found' }      poprawny NIP, ale GUS nie ma takiego podmiotu
// → 429 { error: 'too_many_changes' }       przekroczony limit zmian NIP w sesji
// → 405 | 413 | 500

import { toCompanyView, type CompanyRow } from '../../../src/company/companyView.ts';
import { mapGusRecord, toAttachPayload, unavailablePayload } from '../../../src/company/gusMapping.ts';
import { isCacheUsable } from '../../../src/company/lookupPolicy.ts';
import { parseLookupRequest } from '../../../src/company/lookupRequest.ts';
import { admin } from '../_shared/admin.ts';
import { lookupNip } from '../_shared/gus.ts';
import { handleNonPost, json, readJsonBody } from '../_shared/http.ts';

const COMPANY_COLUMNS =
  'nip, regon, name, street, building_no, unit_no, postal_code, city, voivodeship, gus_type, gus_status, fetched_at';

/** Kody błędów RPC (SQLSTATE) → odpowiedzi HTTP. */
const RPC_ERRORS: Record<string, { status: number; error: string }> = {
  AT001: { status: 404, error: 'not_found' },
  AT002: { status: 409, error: 'nip_locked' },
  AT003: { status: 429, error: 'too_many_changes' },
};

Deno.serve(async (req) => {
  const early = handleNonPost(req);
  if (early) return early;

  try {
    const body = await readJsonBody(req);
    if (!body.ok) return body.response;

    const parsed = parseLookupRequest(body.value);
    if (!parsed.ok) return json(400, { error: parsed.error });
    const { token, nip } = parsed;

    const { data: session, error: sessionError } = await admin
      .from('calc_sessions')
      .select('org_id, status')
      .eq('token', token)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session || session.status === 'archived') return json(404, { error: 'not_found' });

    // Pamięć podręczna: firma tej organizacji z ostatnich 30 dni. Przypinamy ją „bez nowych danych”
    // (ładunek unavailable nie nadpisuje istniejącej firmy), dzięki czemu nie przesuwamy `fetched_at`.
    const { data: cached, error: cacheError } = await admin
      .from('companies')
      .select(COMPANY_COLUMNS)
      .eq('org_id', session.org_id)
      .eq('nip', nip)
      .maybeSingle();
    if (cacheError) throw cacheError;

    let payload: Record<string, unknown>;
    if (cached && isCacheUsable(cached, Date.now())) {
      payload = unavailablePayload(nip);
    } else {
      const gus = await lookupNip(nip, Deno.env.get('GUS_API_KEY') || undefined);
      if (gus.kind === 'not_found') return json(422, { error: 'company_not_found' });

      const mapped = gus.kind === 'found' ? mapGusRecord(gus.record, nip) : null;
      if (gus.kind === 'found' && !mapped) console.error('gus: niezrozumiała odpowiedź, traktuję jak niedostępny');
      payload = mapped ? toAttachPayload(mapped, gus.kind === 'found' ? gus.record : null) : unavailablePayload(nip);
    }

    const { data: companyId, error: attachError } = await admin.rpc('attach_company_to_session', {
      p_token: token,
      p_company: payload,
    });
    if (attachError) {
      const mapped = RPC_ERRORS[attachError.code];
      if (mapped) return json(mapped.status, { error: mapped.error });
      throw attachError;
    }

    // Widok budujemy z wiersza w bazie (źródło prawdy), nie z odpowiedzi GUS.
    const { data: row, error: rowError } = await admin
      .from('companies')
      .select(COMPANY_COLUMNS)
      .eq('id', companyId)
      .single();
    if (rowError) throw rowError;

    return json(200, { company: toCompanyView(row as CompanyRow) });
  } catch (e) {
    console.error('lookup-company:', e instanceof Error ? e.message : e);
    return json(500, { error: 'server_error' });
  }
});
