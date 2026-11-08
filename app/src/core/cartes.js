/**
 * cartes.js — Factures de carte : rattacher les achats des cartes à la facture prélevée sur le compte.
 *
 * Version : 0.4.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Exemple : les cartes UBS de Maman et de Papa ont une facture commune, prélevée par LSV sur
 * le compte UBS. Le prélèvement est une « facture » (catégorie non comptée dans les totaux) ;
 * les achats des deux cartes sont comptés une seule fois, chacun pour sa personne.
 * Chaque achat rattaché porte `cardBillId` = id du prélèvement.
 *
 * Rattachement automatique : on cherche, parmi les achats pas encore rattachés et datés avant le
 * prélèvement, une suite continue (par date) dont le total est exactement celui de la facture.
 * Sinon, la personne coche elle-même les achats ; l'écart éventuel est affiché (frais, etc.).
 *
 * Historique :
 *   0.4.0  FRE (Fidag)  Première version.
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
 */
export async function candidates(db, bill) {
  const cards = await cardsPaidFrom(db, bill.accountId);
  const out = [];
  for (const c of cards) {
    for (const t of await db.getAllWhere('transactions', 'accountId', c.id)) {
      if (t.date <= bill.date && (!t.cardBillId || t.cardBillId === bill.id)) out.push(t);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
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

/** Rattache exactement ces achats à la facture (remplace les rattachements précédents). */
export async function linkBill(db, billId, txIds) {
  const bill = await db.get('transactions', billId);
  if (!bill?.isCardBillPayment) throw new ReglageError('Cette facture n’existe plus.');
  const allowed = new Map((await candidates(db, bill)).map((t) => [t.id, t]));
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
  for (const bill of bills) {
    if (await db.countWhere('transactions', 'cardBillId', bill.id)) continue;
    const run = findExactRun(bill, await candidates(db, bill));
    if (run) {
      await linkBill(db, bill.id, run.map((t) => t.id));
      n++;
    }
  }
  return n;
}

/** Factures pas encore justes (rien rattaché ou écart) : à vérifier. */
export async function billsToCheck(db) {
  const out = [];
  for (const bill of await listBills(db)) {
    if (!(await billStatus(db, bill)).complete) out.push(bill);
  }
  return out;
}
