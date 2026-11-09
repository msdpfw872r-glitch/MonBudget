/**
 * periode.js — Périodes d'analyse : semaine, mois, année, tout, dates libres.
 *
 * Version : 0.5.1
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Une période = { kind, from, to } avec des dates "AAAA-MM-JJ" incluses.
 * La semaine va du lundi au dimanche. Ne dépend pas du navigateur (testable dans Node).
 *
 * Historique :
 *   0.5.1  FRE (Fidag)  Première version.
 */

export const KINDS = [
  { id: 'semaine', label: 'Semaine' },
  { id: 'mois', label: 'Mois' },
  { id: 'annee', label: 'Année' },
  { id: 'tout', label: 'Tout' },
  { id: 'libre', label: 'Dates' },
];

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && toIso(toDate(s)) === s;

/** Lundi de la semaine de cette date. */
export function mondayOf(iso) {
  const day = toDate(iso).getUTCDay(); // 0 = dimanche
  return addDays(iso, -((day + 6) % 7));
}

/** Dernier jour du mois. */
function lastOfMonth(y, m) {
  return toIso(new Date(Date.UTC(y, m, 0)));
}

/**
 * Période d'un genre donné qui contient la date `anchor`.
 * @param {'semaine'|'mois'|'annee'|'tout'|'libre'} kind
 * @param {string} anchor  "AAAA-MM-JJ"
 * @param {{from: string, to: string}} [range]  pour 'libre' (et 'tout' : premières / dernières dates)
 */
export function periodFor(kind, anchor, range = null) {
  const [y, m] = anchor.split('-').map(Number);
  switch (kind) {
    case 'semaine': { const from = mondayOf(anchor); return { kind, from, to: addDays(from, 6) }; }
    case 'annee': return { kind, from: `${y}-01-01`, to: `${y}-12-31` };
    case 'tout': return { kind, from: range?.from ?? '1900-01-01', to: range?.to ?? '2999-12-31' };
    case 'libre': {
      let from = isIso(range?.from) ? range.from : `${anchor.slice(0, 7)}-01`;
      let to = isIso(range?.to) ? range.to : lastOfMonth(y, m);
      if (from > to) [from, to] = [to, from];
      return { kind, from, to };
    }
    default: return { kind: 'mois', from: `${anchor.slice(0, 7)}-01`, to: lastOfMonth(y, m) };
  }
}

/** Période précédente (-1) ou suivante (+1), de même genre et même durée. */
export function shiftPeriod(p, delta) {
  switch (p.kind) {
    case 'semaine': return periodFor('semaine', addDays(p.from, 7 * delta));
    case 'mois': {
      const d = toDate(p.from); d.setUTCMonth(d.getUTCMonth() + delta);
      return periodFor('mois', toIso(d));
    }
    case 'annee': return periodFor('annee', `${Number(p.from.slice(0, 4)) + delta}-01-01`);
    case 'libre': {
      const days = Math.round((toDate(p.to) - toDate(p.from)) / 86400000) + 1;
      return { kind: 'libre', from: addDays(p.from, days * delta), to: addDays(p.to, days * delta) };
    }
    default: return p;
  }
}

/** "lundi" style court : "5 octobre", avec l'année si demandé. */
function day(iso, withYear) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d === 1 ? '1er' : d} ${MOIS[m - 1]}${withYear ? ` ${y}` : ''}`;
}

/** Libellé lisible : « Octobre 2026 », « Année 2026 », « Semaine du 5 au 11 octobre 2026 »… */
export function periodLabel(p) {
  const [y1, m1] = p.from.split('-').map(Number);
  const [y2, m2] = p.to.split('-').map(Number);
  const range = () => {
    if (p.from === p.to) return `Le ${day(p.from, true)}`;
    if (y1 === y2 && m1 === m2) return `Du ${p.from.slice(8) === '01' ? '1er' : Number(p.from.slice(8))} au ${day(p.to, true)}`;
    if (y1 === y2) return `Du ${day(p.from, false)} au ${day(p.to, true)}`;
    return `Du ${day(p.from, true)} au ${day(p.to, true)}`;
  };
  switch (p.kind) {
    case 'mois': return `${cap(MOIS[m1 - 1])} ${y1}`;
    case 'annee': return `Année ${y1}`;
    case 'tout': return 'Toutes les opérations';
    case 'semaine': return `Semaine ${range().replace(/^Du /, 'du ').replace(/^Le /, 'le ')}`;
    default: return range();
  }
}

/** Texte court des boutons « ‹ … » / « … › ». */
export function shiftLabel(p, delta) {
  const q = shiftPeriod(p, delta);
  switch (p.kind) {
    case 'mois': return cap(MOIS[Number(q.from.slice(5, 7)) - 1]);
    case 'annee': return q.from.slice(0, 4);
    case 'semaine': return delta < 0 ? 'Semaine précédente' : 'Semaine suivante';
    default: return delta < 0 ? 'Précédente' : 'Suivante';
  }
}

/** Vrai si la date est dans la période. */
export const inPeriod = (iso, p) => iso >= p.from && iso <= p.to;

/** Mois couverts par la période (« AAAA-MM »), dans l'ordre. */
export function monthsIn(p) {
  const out = [];
  let cur = p.from.slice(0, 7);
  const end = p.to.slice(0, 7);
  while (cur <= end && out.length < 600) {
    out.push(cur);
    const [y, m] = cur.split('-').map(Number);
    cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  return out;
}
