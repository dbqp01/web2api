import { z } from 'zod';
import { parse, WorkflowError } from './contracts.mjs';
import { upstreamJson } from './upstream.mjs';

const date = z.iso.date().refine(s => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
export const usgarInput = z.object({
  check_in: date, check_out: date, guests: z.number().int().min(1).max(8).default(2), max_results: z.number().int().min(1).max(50).default(20),
}).strict().superRefine((input, ctx) => {
  const nights = (Date.parse(input.check_out) - Date.parse(input.check_in)) / 86400000;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (input.check_in < today || nights < 1 || nights > 30) ctx.addIssue({ code: 'custom', message: 'Dates must be future/current Lima dates, with 1–30 nights.' });
});
const cents = z.number().finite().nonnegative().max(1000000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001);
const roomSchema = z.object({
  id_room_type: z.number().int().positive(), slug: z.string().regex(/^[a-z0-9-]+$/), room_name: z.string().min(1).max(200),
  price: cents, non_refundable_price: cents, max_guests: z.number().int().min(1).max(100), total_rooms: z.number().int().nonnegative(),
  available_qty: z.number().int().nonnegative(), currency: z.literal('USD'), nights: z.number().int().positive(), total_stay_price: cents,
});
const roomsSchema = z.object({ success: z.literal(true), rooms: z.array(roomSchema).max(100) }).strict();
const calendarSchema = z.object({ success: z.literal(true), from: date, to: date, days: z.record(date, z.record(z.string(), z.number().int().nonnegative())) }).strict();
export const usgarOutput = z.object({
  data: z.object({ query: usgarInput, nights: z.number().int().positive(), currency: z.literal('USD'),
    rooms: z.array(z.object({ id: z.number().int(), slug: z.string(), name: z.string(), max_guests: z.number().int(), available_quantity_reported: z.number().int(), standard_nightly_cents: z.number().int(), standard_stay_cents: z.number().int(), non_refundable_nightly_cents: z.number().int(), non_refundable_stay_cents: z.number().int(), source_url: z.url() }).strict()),
    total: z.number().int().nonnegative(), truncated: z.boolean(), availability_confirmed: z.literal(false), price_basis: z.string(),
  }).strict(),
  evidence: z.object({ source_mode: z.literal('observed_first_party_http'), scope: z.literal('usgar_public_read_only'), evidence_level: z.literal('E4'), source_urls: z.array(z.url()), observed_at: z.iso.datetime(), verification: z.string(), transport: z.literal('http_only'), cached: z.boolean(), limits: z.array(z.string()) }).strict(),
}).strict();
export const usgarDefinitions = { search_usgar_rooms: { input: usgarInput, output: usgarOutput, effect: 'read', description: 'Consultar habitaciones de USGAR por fechas (1–30 noches) y huéspedes (1–8). API HTTP directa; contrasta inventario con calendario. Tarifas en centavos USD reportadas por el sitio; no crea reserva ni garantiza disponibilidad.' } };
const origin = 'https://usgarhoteles.com';

export function createUsgarRunner() {
  const cache = new Map();
  return async function run(name, raw) {
    if (name !== 'search_usgar_rooms') throw new WorkflowError('UNKNOWN_WORKFLOW', 404);
    const input = parse(usgarInput, raw), key = JSON.stringify(input);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.time < 30000) return structuredClone({ ...hit.value, evidence: { ...hit.value.evidence, cached: true } });
    const nights = (Date.parse(input.check_out) - Date.parse(input.check_in)) / 86400000;
    const lastNight = new Date(Date.parse(input.check_out) - 86400000).toISOString().slice(0, 10);
    const roomUrl = new URL('/api/rooms', origin);
    roomUrl.search = new URLSearchParams({ checkIn: input.check_in, checkOut: input.check_out, lang: 'es' });
    const calendarUrl = new URL('/api/rooms/calendar', origin);
    calendarUrl.search = new URLSearchParams({ from: input.check_in, to: lastNight });
    // Sequential reads stop immediately on rate limiting; no retry or browser fallback.
    const rooms = parse(roomsSchema, await upstreamJson(roomUrl, { headers: { Accept: 'application/json' } }), 'UPSTREAM_CHANGED').rooms;
    const calendar = parse(calendarSchema, await upstreamJson(calendarUrl, { headers: { Accept: 'application/json' } }), 'UPSTREAM_CHANGED');
    if (calendar.from !== input.check_in || calendar.to !== lastNight || new Set(rooms.map(r => r.slug)).size !== rooms.length) throw new WorkflowError('VERIFICATION_FAILED');
    for (const room of rooms) {
      const counts = [];
      for (let n = 0; n < nights; n++) {
        const day = new Date(Date.parse(input.check_in) + n * 86400000).toISOString().slice(0, 10);
        const count = calendar.days[day]?.[room.slug];
        if (count === undefined) throw new WorkflowError('INVENTORY_UNVERIFIED');
        counts.push(count);
      }
      if (room.nights !== nights || Math.round(room.total_stay_price * 100) !== Math.round(room.price * 100) * nights ||
          room.available_qty > room.total_rooms || Math.min(...counts) !== room.available_qty) throw new WorkflowError('INVENTORY_UNVERIFIED');
    }
    const filtered = rooms.filter(r => r.max_guests >= input.guests && r.available_qty > 0);
    const value = {
      data: { query: input, nights, currency: 'USD', rooms: filtered.slice(0, input.max_results).map(r => ({
        id: r.id_room_type, slug: r.slug, name: r.room_name, max_guests: r.max_guests, available_quantity_reported: r.available_qty,
        standard_nightly_cents: Math.round(r.price * 100), standard_stay_cents: Math.round(r.total_stay_price * 100),
        non_refundable_nightly_cents: Math.round(r.non_refundable_price * 100), non_refundable_stay_cents: Math.round(r.non_refundable_price * 100) * nights,
        source_url: `${origin}/es/rooms/${r.slug}/`,
      })), total: filtered.length, truncated: filtered.length > input.max_results, availability_confirmed: false, price_basis: 'site_reported_rate_for_dates; taxes_and_fees_not_independently_confirmed' },
      evidence: { source_mode: 'observed_first_party_http', scope: 'usgar_public_read_only', evidence_level: 'E4', source_urls: [roomUrl.href, calendarUrl.href],
        observed_at: new Date().toISOString(), verification: 'schema_dates_totals_and_calendar_crosscheck', transport: 'http_only', cached: false,
        limits: ['Inventory and rates are reported by USGAR, not independently checked against its PMS.', 'No booking hold or payment was created. Inventory may change.'] },
    };
    if (cache.size >= 32) cache.delete(cache.keys().next().value);
    cache.set(key, { time: Date.now(), value });
    return structuredClone(value);
  };
}
