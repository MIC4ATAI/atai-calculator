/**
 * Podpis webhooka: HMAC-SHA256 z sekretu współdzielonego z n8n. Podpisujemy `${timestamp}.${body}`, więc przechwycone
 * żądanie nie da się odtworzyć po czasie (n8n odrzuca stare znaczniki) ani z inną treścią.
 */
const encoder = new TextEncoder();

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Wartość nagłówka X-Signature: `sha256=<hex>`. `timestamp` to sekundy uniksowe (tekst z nagłówka X-Timestamp).
 *
 * Znacznik MUSI być liczbą całkowitą: separator `.` byłby inaczej niejednoznaczny (`1` + `2.3` i `1.2` + `3` dają ten sam
 * ciąg). Odbiorca powinien sprawdzać to samo (`^[0-9]+$`) przed liczeniem podpisu.
 */
export async function signPayload(secret: string, timestamp: string, body: string): Promise<string> {
  if (!/^[0-9]{1,12}$/.test(timestamp)) throw new Error('Znacznik czasu musi być liczbą całkowitą (sekundy)');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
  return `sha256=${toHex(signature)}`;
}
