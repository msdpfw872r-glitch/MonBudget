/**
 * import.js — Import d'un fichier de banque de bout en bout (sans dépendre du navigateur).
 *
 * Version : 0.4.1
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Étapes :
 *   1. readBankFile()   : reconnaît le format (UBS…) et lit les opérations ;
 *   2. prepareImport()  : rattache chaque compte ou carte du fichier à un compte de l'app
 *                         (demande à la personne si besoin), écarte les doublons, applique les règles ;
 *   3. commitImport()   : enregistre, puis rattache les achats par carte aux factures ;
 *   4. undoImport()     : annule un import entier.
 *
 * Historique :
 *   0.4.0  FRE (Fidag)  Première version (UBS).
 *   0.4.1  FRE (Fidag)  Fichiers CSV acceptés (UBS) ; règlement reçu sur une carte classé « facture ».
 */

import { readXlsx, looksLikeZip } from './xlsx.js';
import { decodeText, looksLikeText, parseCsv } from './csv.js';
import { merchantKey } from './text.js';
import { ReglageError, normRef, assignBankRef } from './reglages.js';
import { findRule, applyRule } from './regles.js';
import { autoLinkAll, unlinkBill } from './cartes.js';
import * as ubs from '../importers/ubs.js';

/** Importateurs connus (même interface : FORMAT_ID, FORMAT_LABEL, detect, parse). */
export const IMPORTERS = [ubs];

const BANK_NAMES = { 'ubs-transactions-xlsx': 'UBS', camt053: 'BCVs', 'swisscard-csv': 'Mastercard (Swisscard)' };
export const bankName = (format) => BANK_NAMES[format] ?? 'cette banque';

/**
 * Lit un fichier de banque.
 * @param {Uint8Array|ArrayBuffer} data
 * @returns {Promise<{format: string, label: string, transactions: object[], warnings: string[], period: object|null, accounts: string[]}>}
 */
export async function readBankFile(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let sheets = [];
  if (looksLikeZip(bytes)) {
    try {
      sheets = (await readXlsx(bytes)).sheets.map((s) => s.rows);
    } catch {
      throw new ReglageError('Ce fichier n’a pas pu être ouvert. Téléchargez-le à nouveau depuis votre banque.');
    }
  } else if (looksLikeText(bytes)) {
    sheets = [parseCsv(decodeText(bytes))];
  }
  for (const rows of sheets) {
    for (const imp of IMPORTERS) {
      if (imp.detect(rows)) {
        const res = imp.parse(rows);
        if (!res.transactions.length) throw new ReglageError('Ce fichier ne contient aucune opération.');
        return { ...res, format: imp.FORMAT_ID, label: imp.FORMAT_LABEL };
      }
    }
  }
  throw new ReglageError('Ce fichier n’est pas reconnu. Choisissez le fichier des opérations téléchargé depuis votre banque (pour UBS : « Transactions », en Excel ou en CSV).');
}

/** Comptes de l'app qui reçoivent ce format de fichier. */
async function accountsForFormat(db, format) {
  return (await db.getAll('accounts')).filter((a) => a.importFormat === format).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Masque une référence pour l'affichage : IBAN → « …0000 0 », carte → « ****1234 ». */
export function shortRef(ref) {
  const r = normRef(ref);
  if (r.startsWith('*')) return `****${r.replace(/\*/g, '')}`;
  return r.length > 6 ? `…${r.slice(-6)}` : r;
}

/**
 * Prépare un import. Si des comptes ou cartes du fichier ne sont pas encore connus,
 * renvoie `needsMapping` (une question par référence) au lieu du plan.
 */
export async function prepareImport(db, parsed, { fileName = '' } = {}) {
  const accounts = await accountsForFormat(db, parsed.format);
  if (!accounts.length) {
    throw new ReglageError(`Ce fichier vient de ${bankName(parsed.format)}, mais aucun de vos comptes n’utilise ce fichier. Ajoutez le compte dans Réglages, « Mes comptes ».`);
  }

  // 1. À quel compte appartient chaque référence du fichier ?
  const refs = new Map(); // ref normalisée → { ref, kind, count }
  for (const t of parsed.transactions) {
    const r = normRef(t.accountRef);
    const e = refs.get(r) ?? { ref: r, kind: t.accountKind ?? 'compte', count: 0 };
    e.count++;
    refs.set(r, e);
  }
  const byRef = new Map();
  const newRefs = []; // références reconnues sans question, à retenir à l'enregistrement
  const needsMapping = [];
  for (const e of refs.values()) {
    let acc = accounts.find((a) => (a.bankRefs ?? []).includes(e.ref));
    if (!acc) {
      const sameKind = accounts.filter((a) => a.kind === e.kind);
      // Un seul compte possible et encore sans numéro : on le prend sans poser de question.
      if (sameKind.length === 1 && !(sameKind[0].bankRefs ?? []).length) {
        acc = sameKind[0];
        newRefs.push({ ref: e.ref, accountId: acc.id });
      }
    }
    if (acc) byRef.set(e.ref, acc);
    else needsMapping.push({ ...e, label: shortRef(e.ref), choices: accounts.filter((a) => a.kind === e.kind).concat(accounts.filter((a) => a.kind !== e.kind)) });
  }
  if (needsMapping.length) return { needsMapping, autoAssigned: newRefs };

  // 2. Doublons, règles, factures de carte.
  const rules = await db.getAll('rules');
  const billCategory = (await db.getAll('categories')).find((c) => c.isCardBill && !c.archived);
  const importId = `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const counts = { trouvees: parsed.transactions.length, nouvelles: 0, autoClassees: 0, aTrier: 0, doublons: 0 };
  const transactions = [];
  const ruleHits = new Map();

  for (const t of parsed.transactions) {
    const acc = byRef.get(normRef(t.accountRef));
    if (await db.get('transactions', t.id)) { counts.doublons++; continue; }
    let tx = {
      id: t.id,
      accountId: acc.id,
      date: t.date,
      description: t.description,
      merchantKey: merchantKey(t.description),
      amount: t.amount,
      currency: t.currency ?? 'CHF',
      bankCategory: t.bankCategory ?? null,
      personId: null,
      categoryId: null,
      status: 'a-trier',
      ruleId: null,
      importId,
      isCardBillPayment: Boolean(t.isCardBillPayment) && acc.kind === 'compte',
      cardBillId: null,
      note: '',
    };
    if (tx.isCardBillPayment && billCategory) {
      tx = { ...tx, categoryId: billCategory.id, personId: null, status: 'classee' };
    } else if (t.isCardPaymentReceived && acc.kind === 'carte' && billCategory) {
      // Règlement de la facture vu du côté de la carte : ni une rentrée, ni une dépense.
      tx = { ...tx, isCardBillPayment: false, categoryId: billCategory.id, personId: null, status: 'classee' };
    } else {
      tx.isCardBillPayment = false;
      const rule = findRule(rules, tx.merchantKey);
      if (rule) {
        tx = applyRule(tx, rule);
        ruleHits.set(rule.id, (ruleHits.get(rule.id) ?? 0) + 1);
      }
    }
    if (tx.status === 'classee') counts.autoClassees++; else counts.aTrier++;
    counts.nouvelles++;
    transactions.push(tx);
  }

  return {
    importId,
    format: parsed.format,
    fileName,
    period: parsed.period,
    accountIds: [...new Set([...byRef.values()].map((a) => a.id))],
    warnings: parsed.warnings ?? [],
    counts,
    transactions,
    ruleHits: [...ruleHits.entries()],
    newRefs,
  };
}

/** Enregistre un import préparé. */
export async function commitImport(db, plan, now = new Date()) {
  const record = {
    id: plan.importId,
    accountId: plan.accountIds[0] ?? null,
    accountIds: plan.accountIds,
    fileName: plan.fileName,
    format: plan.format,
    date: now.toISOString(),
    period: plan.period,
    counts: { ...plan.counts },
  };
  for (const { ref, accountId } of plan.newRefs ?? []) await assignBankRef(db, accountId, ref);
  if (plan.transactions.length) await db.putMany('transactions', plan.transactions);
  for (const [ruleId, n] of plan.ruleHits) {
    const r = await db.get('rules', ruleId);
    if (r) await db.put('rules', { ...r, hits: (r.hits ?? 0) + n, lastUsedAt: now.toISOString() });
  }
  record.counts.facturesRattachees = await autoLinkAll(db);
  await db.put('imports', record);
  const settings = await db.get('settings', 'app');
  await db.put('settings', { ...(settings ?? { id: 'app' }), lastImportAt: now.toISOString() });
  return record;
}

/** Imports, du plus récent au plus ancien. */
export async function listImports(db) {
  return (await db.getAll('imports')).sort((a, b) => b.date.localeCompare(a.date));
}

/** Annule un import entier : ses opérations sont retirées (les règles restent). */
export async function undoImport(db, importId) {
  const rec = await db.get('imports', importId);
  if (!rec) throw new ReglageError('Cet import n’existe plus.');
  const txs = await db.getAllWhere('transactions', 'importId', importId);
  for (const t of txs) if (t.isCardBillPayment) await unlinkBill(db, t.id);
  for (const t of txs) await db.delete('transactions', t.id);
  await db.delete('imports', importId);
  return txs.length;
}
