/**
 * cartes.js — Factures de carte : rattacher les achats des cartes à la facture prélevée sur le compte.
 *
 * Version : 0.24.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-16
 *
 * Exemple : les cartes UBS de Maman et de Papa ont une facture commune, prélevée par LSV sur
 * le compte UBS. Le prélèvement est une « facture » (catégorie non comptée dans les totaux) ;
 * les achats des deux cartes sont comptés une seule fois, chacun pour sa personne.
 * Chaque achat rattaché porte `cardBillId` = id du prélèvement.
 *
 * Rattachement automatique (0.18.0) : chaque fichier de carte importé correspond à UNE facture. On cherche
 * d'abord le fichier (import) dont les achats non rattachés font exactement le montant du prélèvement, le
 * dernier achat étant au plus 45 jours avant. Sinon, une suite continue d'achats (par date) de même total.
 * Sinon, la personne coche elle-même les achats ; l'écart éventuel est affiché (frais, etc.).
 *
 * Historique :
 *   0.4.0  FRE (Fidag)  Première version.
 *   0.18.0 FRE (Fidag)  Un fichier de carte = une facture (importGroups, findImportGroup) ; le paiement de la
 *                       facture reçu sur la carte n'est jamais un achat à rattacher.
 *   0.18.1 FRE (Fidag)  autoLinkAll : toutes les correspondances par fichier d'abord, les suites d'achats ensuite.
 *   0.19.0 FRE (Fidag)  Facture « vérifiée sans le détail » (billChecked) : plus signalée, sans importer les achats.
 *   0.20.0 FRE (Fidag)  findSmartMatch : achats de la période, moins quelques achats passés sur la facture suivante
 *                       (surtout en monnaie étrangère), plus quelques achats restés ouverts des factures précédentes.
 *   0.24.0 FRE (Fidag)  Réparation : une facture pas juste (ou vide) reprend le fichier qui fait exactement son
 *                       montant, même si des achats de ce fichier sont restés sur une autre facture pas juste
 *                       (rattachements faux d'avant) ; un fichier réimporté en plusieurs fois compte comme un seul
 *                       fichier (même période) ; candidates/linkBill acceptent les achats des factures pas justes.
 */

import { toCents } from './text.js';
import { ReglageError } from './reglages.js';

const cents = (tx) => toCents(tx.amount);

/** Cartes dont la facture est prélevée sur ce compte. */
export async function cardsPaidFrom(db, accountId) {
  return (await db.getAll('accounts')).filter((a) => a.kind === 'carte' && a.billPaidFrom === accountId);
}

/** Toutes les factures (prélèvements) enregistrées, de la plus récente à la plus ancienne. */
export async function listBills(db) {
  const all = await db.getAll('transactions');
  return all.filter((t) => t.isCardBillPayment).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/**
 * Achats qui peuvent être rattachés à cette facture : opérations des cartes payées par ce compte,
 * pas encore rattachées à une autre facture, datées au plus tard le jour du prélèvement.
 * Triés par date (le plus ancien d'abord).
 * @param {{takeFrom?: Set<string>|'all'|null}} [opts]  aussi les achats rattachés à ces factures (ou à toutes : 'all').
 */
export async function candidates(db, bill, { takeFrom = null } = {}) {
  const cards = await cardsPaidFrom(db, bill.accountId);
  // Le paiement de la facture reçu sur la carte (catégorie « facture de carte ») n'est pas un achat.
  const billCats = new Set((await db.getAll('categories')).filter((c) => c.isCardBill).map((c) => c.id));
  const out = [];
  for (const c of cards) {
    for (const t of await db.getAllWhere('transactions', 'accountId', c.id)) {
      if (billCats.has(t.categoryId)) continue;
      if (t.date <= bill.date && (!t.cardBillId || t.cardBillId === bill.id || takeFrom === 'all' || takeFrom?.has(t.cardBillId))) out.push(t);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/**
 * Factures « pas justes » : des achats rattachés mais un écart, et pas vérifiées à la main.
 * Leurs achats peuvent être repris par une facture qui tombe juste.
 * @returns {Promise<Set<string>>}
 */
export async function looseBillIds(db) {
  const out = new Set();
  for (const b of await listBills(db)) {
    if (b.billChecked) continue;
    const st = await billStatus(db, b);
    if (st.count && !st.complete) out.add(b.id);
  }
  return out;
}

/**
 * Clé du fichier d'un achat : un même fichier réimporté (même période) compte comme un seul fichier,
 * même si ses achats sont répartis entre plusieurs importations.
 * @returns {Promise<(t: object) => string|null>}
 */
export async function fileKeyOf(db) {
  const keys = new Map();
  for (const imp of await db.getAll('imports')) {
    if (imp.period?.from && imp.period?.to) keys.set(imp.id, `${imp.period.from}|${imp.period.to}`);
  }
  return (t) => (t.importId ? keys.get(t.importId) ?? t.importId : null);
}

/** État d'une facture : total rattaché, écart, nombre d'achats. Montants en francs. */
export async function billStatus(db, bill) {
  const linked = await db.getAllWhere('transactions', 'cardBillId', bill.id);
  const linkedCents = linked.reduce((s, t) => s + cents(t), 0);
  const diff = cents(bill) - linkedCents; // les deux sont négatifs pour des achats
  return {
    count: linked.length,
    linkedTotal: linkedCents / 100,
    billAmount: bill.amount,
    difference: diff / 100, // < 0 : la facture est plus élevée que les achats rattachés
    complete: linked.length > 0 && diff === 0,
    checked: Boolean(bill.billChecked), // vérifiée à la main, sans le détail des achats
  };
}

/**
 * Cherche une suite continue d'achats dont le total est exactement celui de la facture.
 * Préfère la suite qui commence le plus tôt (les achats les plus anciens sont facturés d'abord).
 * @returns {object[]|null}
 */
export function findExactRun(bill, list) {
  const target = cents(bill);
  const free = list.filter((t) => !t.cardBillId);
  for (let i = 0; i < free.length; i++) {
    let sum = 0;
    for (let j = i; j < free.length; j++) {
      sum += cents(free[j]);
      if (sum === target) return free.slice(i, j + 1);
    }
  }
  return null;
}

const DAY = 86400000;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
export const MAX_DAYS_BEFORE_BILL = 45;

/**
 * Achats regroupés par fichier importé (un fichier de carte = une facture).
 * @returns {{importId: string, items: object[], cents: number, from: string, to: string, free: boolean}[]}
 */
export function importGroups(list, keyOf = (t) => t.importId) {
  const m = new Map();
  for (const t of list) {
    const key = keyOf(t);
    if (!key) continue;
    const g = m.get(key) ?? { importId: key, items: [], cents: 0, from: t.date, to: t.date, free: true };
    g.items.push(t);
    g.cents += cents(t);
    if (t.date < g.from) g.from = t.date;
    if (t.date > g.to) g.to = t.date;
    if (t.cardBillId) g.free = false;
    m.set(key, g);
  }
  return [...m.values()].sort((a, b) => b.to.localeCompare(a.to));
}

/**
 * Le fichier importé qui correspond exactement à cette facture, ou null.
 * Sans options : seulement les achats libres. Avec `takeable` : `list` doit contenir TOUS les achats des cartes
 * (candidates(db, bill, {takeFrom: 'all'})) ; un fichier entier convient si chacun de ses achats est libre, déjà sur
 * cette facture ou sur une facture de `takeable` (pas juste).
 * @param {{keyOf?: Function, takeable?: Set<string>|null}} [opts]
 */
export function findImportGroup(bill, list, { keyOf, takeable = null } = {}) {
  const target = cents(bill);
  const ok = (t) => !t.cardBillId || (takeable && (t.cardBillId === bill.id || takeable.has(t.cardBillId)));
  return importGroups(takeable ? list : list.filter(ok), keyOf)
    .find((g) => g.items.every(ok) && g.cents === target && g.to <= bill.date && daysBetween(g.to, bill.date) <= MAX_DAYS_BEFORE_BILL)?.items ?? null;
}

/** Achat en monnaie étrangère (souvent comptabilisé plus tard : peut passer sur la facture suivante). */
export const isForeign = (t) => (t.currency && t.currency !== 'CHF') || /Montant d’origine|Montant\s*:\s*[A-Z]{3}\b/.test(`${t.note ?? ''} ${t.description ?? ''}`);

export const SMART_MAX_CHANGES = 3;
const SMART_POOL = 25;

/**
 * Recherche « intelligente » quand ni un fichier entier ni une suite d'achats ne tombe juste.
 * Base : les achats ouverts de la période de la facture (depuis peu avant la facture précédente).
 * Ajustements (au plus SMART_MAX_CHANGES) : retirer des achats récents (passés sur la facture suivante,
 * surtout en monnaie étrangère) et/ou ajouter des achats plus anciens restés ouverts.
 * @param {object} bill
 * @param {object[]} list  candidates(db, bill)
 * @param {{prevBillDate?: string|null}} [opts]
 * @returns {{items: object[], removed: object[], added: object[], ambiguous: boolean}|null}
 */
export function findSmartMatch(bill, list, { prevBillDate = null } = {}) {
  const open = list.filter((t) => !t.cardBillId && t.date <= bill.date);
  if (!open.length) return null;
  const shift = (d, days) => new Date(Date.parse(d) + days * DAY).toISOString().slice(0, 10);
  const target = cents(bill);
  // Clôture du relevé : en général environ une semaine avant le prélèvement (on essaie plusieurs écarts).
  const CLOSE_GAPS = [7, 5, 3, 10, 0, 14];
  const startOf = (gap) => (prevBillDate ? shift(prevBillDate, -gap) : shift(bill.date, -(gap + 31)));
  const score = (combo, gap) => combo.reduce((s, m) => s + (m.out ? (isForeign(m.t) ? 0 : 2) : 3), 0) + CLOSE_GAPS.indexOf(gap) * 0.1;
  for (let k = 0; k <= SMART_MAX_CHANGES; k++) {
    const sols = []; // { combo, gap, core }
    for (const gap of CLOSE_GAPS) {
      const end = shift(bill.date, -gap);
      const start = startOf(gap);
      const core = open.filter((t) => t.date > start && t.date <= end);
      const late = open.filter((t) => t.date > end); // passés sur la facture suivante (peuvent revenir)
      const older = open.filter((t) => t.date <= start);
      const diff = core.reduce((x, t) => x + cents(t), 0) - target;
      // Retirer : des achats de la période (étrangers et récents d'abord). Ajouter : des anciens restés ouverts ou des « tardifs ».
      const removable = [...core].sort((a, b) => Number(isForeign(b)) - Number(isForeign(a)) || b.date.localeCompare(a.date)).slice(0, SMART_POOL);
      const addable = [...late, ...[...older].sort((a, b) => b.date.localeCompare(a.date))].slice(0, SMART_POOL);
      const moves = [...removable.map((t) => ({ t, out: true, v: cents(t) })), ...addable.map((t) => ({ t, out: false, v: -cents(t) }))];
      const walk = (from, combo, sum) => {
        if (combo.length === k) { if (sum === diff) sols.push({ combo: [...combo], gap, core }); return; }
        for (let i = from; i < moves.length && sols.length < 100; i++) { combo.push(moves[i]); walk(i + 1, combo, sum + moves[i].v); combo.pop(); }
      };
      walk(0, [], 0);
    }
    if (!sols.length) continue;
    const build = (sol) => {
      const removed = sol.combo.filter((m) => m.out).map((m) => m.t);
      const added = sol.combo.filter((m) => !m.out).map((m) => m.t);
      const gone = new Set(removed.map((t) => t.id));
      return { items: [...sol.core.filter((t) => !gone.has(t.id)), ...added], removed, added, s: score(sol.combo, sol.gap) };
    };
    // Plusieurs écarts de clôture peuvent donner le même ensemble d'achats : on les regroupe.
    const uniq = new Map();
    for (const r of sols.map(build)) {
      if (!r.items.length) continue;
      const key = r.items.map((t) => t.id).sort().join('|');
      if (!uniq.has(key) || uniq.get(key).s > r.s) uniq.set(key, r);
    }
    const all = [...uniq.values()].sort((a, b) => a.s - b.s);
    if (!all.length) continue;
    const best = all[0];
    // Sûre seulement si aucune autre combinaison n'est aussi probable (scores entiers égaux).
    const ambiguous = all.length > 1 && Math.floor(all[1].s) === Math.floor(best.s);
    return { items: best.items, removed: best.removed, added: best.added, ambiguous };
  }
  return null;
}

/** Date de la facture précédente sur le même compte (pour la période de la facture). */
export async function previousBillDate(db, bill) {
  const prev = (await listBills(db)).filter((b) => b.accountId === bill.accountId && b.date < bill.date);
  return prev.length ? prev[0].date : null;
}

/** Rattache exactement ces achats à la facture (remplace les rattachements précédents). */
export async function linkBill(db, billId, txIds) {
  const bill = await db.get('transactions', billId);
  if (!bill?.isCardBillPayment) throw new ReglageError('Cette facture n’existe plus.');
  // Les achats restés sur une facture pas juste peuvent être repris.
  const allowed = new Map((await candidates(db, bill, { takeFrom: await looseBillIds(db) })).map((t) => [t.id, t]));
  const wanted = new Set(txIds);
  for (const id of wanted) {
    if (!allowed.has(id)) throw new ReglageError('Un des achats choisis est déjà rattaché à une autre facture.');
  }
  for (const t of await db.getAllWhere('transactions', 'cardBillId', billId)) {
    if (!wanted.has(t.id)) await db.put('transactions', { ...t, cardBillId: null });
  }
  for (const id of wanted) {
    const t = allowed.get(id);
    if (t.cardBillId !== billId) await db.put('transactions', { ...t, cardBillId: billId });
  }
  return billStatus(db, bill);
}

/** Détache tous les achats d'une facture. */
export async function unlinkBill(db, billId) {
  for (const t of await db.getAllWhere('transactions', 'cardBillId', billId)) {
    await db.put('transactions', { ...t, cardBillId: null });
  }
}

/**
 * Essaie de rattacher automatiquement chaque facture encore vide, de la plus ancienne à la plus récente.
 * @returns {Promise<number>} nombre de factures rattachées.
 */
export async function autoLinkAll(db) {
  const bills = (await listBills(db)).reverse();
  let n = 0;
  // 1) D'abord les fichiers de carte qui correspondent exactement (un fichier = une facture), avec réparation ;
  // 2) ensuite seulement les suites d'achats (factures encore vides), pour ne pas prendre les achats d'un fichier
  //    qui va avec une autre facture ;
  // 3) enfin la recherche « intelligente », seulement quand une seule combinaison est la plus probable.
  const smart = async (bill, list) => {
    const m = findSmartMatch(bill, list, { prevBillDate: await previousBillDate(db, bill) });
    return m && !m.ambiguous ? m.items : null;
  };
  // 0) Réparation : une facture vide ou pas juste reprend le fichier entier qui fait exactement son montant,
  //    y compris des achats restés sur une autre facture pas juste (jamais sur une facture juste ou vérifiée).
  const keyOf = await fileKeyOf(db);
  for (const bill of bills) {
    if (bill.billChecked) continue;
    const st = await billStatus(db, bill);
    if (st.complete) continue;
    const takeable = await looseBillIds(db);
    const run = findImportGroup(bill, await candidates(db, bill, { takeFrom: 'all' }), { keyOf, takeable });
    if (run) {
      await linkBill(db, bill.id, run.map((t) => t.id));
      n++;
    }
  }
  for (const find of [findExactRun, smart]) {
    for (const bill of bills) {
      if (bill.billChecked || await db.countWhere('transactions', 'cardBillId', bill.id)) continue;
      const run = await find(bill, await candidates(db, bill));
      if (run) {
        await linkBill(db, bill.id, run.map((t) => t.id));
        n++;
      }
    }
  }
  return n;
}

/** Marque une facture comme vérifiée sans le détail des achats (ou annule). */
export async function markBillChecked(db, billId, checked = true) {
  const bill = await db.get('transactions', billId);
  if (!bill?.isCardBillPayment) throw new ReglageError('Cette facture n’existe plus.');
  await db.put('transactions', { ...bill, billChecked: checked ? new Date().toISOString() : null });
}

/** Factures pas encore justes (rien rattaché ou écart) : à vérifier. */
export async function billsToCheck(db) {
  const out = [];
  for (const bill of await listBills(db)) {
    const st = await billStatus(db, bill);
    if (!st.complete && !st.checked) out.push(bill);
  }
  return out;
}
