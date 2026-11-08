/**
 * ubs.js — Import de l'export « Transactions » de l'e-banking UBS (Excel .xlsx ou CSV).
 *
 * Version : 0.4.1
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Format reconnu (en-têtes en français, une ligne par opération) :
 *   Date de transaction | Numéro de compte ou de carte | Description |
 *   Revenu ou dépense   | Montant | Monnaie | Catégorie
 * Le même export existe en Excel et en CSV : les deux donnent les mêmes lignes et les mêmes
 * empreintes (importer l'un puis l'autre ne crée pas de doublon).
 *
 * Variantes acceptées (à confirmer sur de vrais fichiers) : en-têtes en anglais / allemand,
 * montant en colonnes « Débit » / « Crédit », description en « Description1…3 » ou « Texte comptable »,
 * numéro de carte complet ou masqué (ramené à ****1234), IBAN lu dans les lignes au-dessus de l'en-tête.
 *
 * Le fichier peut contenir à la fois le compte (IBAN) et des cartes UBS (****1234).
 *
 * Historique :
 *   0.1.0  FRE (Fidag)  Première version, d'après un export anonymisé d'octobre 2026.
 *   0.4.1  FRE (Fidag)  Export CSV accepté ; variantes d'en-têtes ; Débit / Crédit ; cartes ****1234 ;
 *                       paiement reçu sur une carte reconnu (ne compte pas comme une rentrée).
 */

import { fold, parseAmount, parseDateCH, fingerprint } from '../core/text.js';

/** Identifiant gardé tel quel (il est enregistré dans les comptes), même pour le CSV. */
export const FORMAT_ID = 'ubs-transactions-xlsx';
export const FORMAT_LABEL = 'UBS — export des transactions (Excel ou CSV)';

/** Colonnes attendues → noms possibles de l'en-tête (comparés sans accents ni casse). */
const COLUMNS = {
  date: ['Date de transaction', "Date d'achat", 'Trade date', 'Purchase date', 'Transaktionsdatum', 'Abschlussdatum', 'Einkaufsdatum'],
  bookingDate: ['Date de comptabilisation', 'Booking date', 'Buchungsdatum'],
  accountRef: ['Numéro de compte ou de carte', 'Account or card number', 'Konto- oder Kartennummer'],
  cardNumber: ['Numéro de carte', 'Card number', 'Kartennummer'],
  description: ['Description', 'Texte comptable', 'Booking text', 'Beschreibung', 'Buchungstext'],
  description1: ['Description1', 'Description 1', 'Beschreibung1', 'Beschreibung 1'],
  description2: ['Description2', 'Description 2', 'Beschreibung2', 'Beschreibung 2'],
  description3: ['Description3', 'Description 3', 'Beschreibung3', 'Beschreibung 3'],
  direction: ['Revenu ou dépense', 'Income or expense', 'Einnahme oder Ausgabe'],
  amount: ['Montant', 'Amount', 'Betrag'],
  debit: ['Débit', 'Debit', 'Belastung'],
  credit: ['Crédit', 'Credit', 'Gutschrift'],
  currency: ['Monnaie', 'Monn.', 'Currency', 'Ccy.', 'Währung'],
  bankCategory: ['Catégorie', 'Category', 'Kategorie'],
};

/** Catégories UBS qui indiquent un paiement de facture de carte (à ne pas compter deux fois). */
const CARD_BILL_CATEGORIES = ['FACTURES DE CARTE DE CREDIT'];
const CARD_BILL_WORDS = /\bFACTURE CARTE\b|\bDECOMPTE CARTE\b|\bSWISSCARD\b|\bCARD CENTER\b/;
/** Sur une carte : crédit qui règle la facture (pas une rentrée). */
const CARD_PAYMENT_WORDS = /\bPAIEMENT\b|\bVERSEMENT\b|\bVOTRE PAIEMENT\b|\bZAHLUNG\b|\bPAYMENT\b|\bLSV\b|\bDEBIT DIRECT\b/;

function findHeader(rows) {
  const limit = Math.min(rows.length, 25);
  for (let r = 0; r < limit; r++) {
    const cells = (rows[r] || []).map((c) => fold(c));
    const map = {};
    for (const [key, names] of Object.entries(COLUMNS)) {
      const idx = cells.findIndex((c) => names.some((n) => fold(n) === c));
      if (idx >= 0) map[key] = idx;
    }
    const hasDate = 'date' in map || 'bookingDate' in map;
    const hasText = 'description' in map || 'description1' in map;
    const hasAmount = 'amount' in map || 'debit' in map || 'credit' in map;
    const isUbs = 'direction' in map || 'accountRef' in map || 'cardNumber' in map || 'description1' in map;
    if (hasDate && hasText && hasAmount && isUbs) return { row: r, map };
  }
  return null;
}

/** IBAN (sinon numéro de compte) écrit au-dessus du tableau (« IBAN: ; CH… »). */
function metaAccount(rows, headerRow) {
  const find = (labels) => {
    for (let r = 0; r < headerRow; r++) {
      const row = rows[r] || [];
      for (let i = 0; i < row.length; i++) {
        if (!labels.includes(fold(row[i]).replace(/[:\s]+$/, ''))) continue;
        const v = row.slice(i + 1).find((c) => String(c ?? '').trim());
        if (v) return String(v).trim();
      }
    }
    return '';
  };
  return find(['IBAN']) || find(['NUMERO DE COMPTE', 'ACCOUNT NUMBER', 'KONTONUMMER']);
}

/**
 * Numéro de carte → « ****1234 ». Masqué (* ou X) : toujours ; en clair (12 chiffres ou plus) :
 * seulement s'il vient de la colonne « Numéro de carte ». IBAN et numéros de compte inchangés.
 */
export function cardRef(value, { isCardColumn = false } = {}) {
  const raw = String(value ?? '').trim();
  const compact = raw.replace(/\s+/g, '');
  if (/^[A-Z]{2}\d{2}/i.test(compact)) return raw; // IBAN
  const digits = compact.replace(/\D/g, '');
  const masked = /[*Xx]/.test(compact);
  if ((masked || (isCardColumn && digits.length >= 12)) && digits.length >= 4) return `****${digits.slice(-4)}`;
  return raw;
}

/** Vrai si ces lignes ressemblent à un export UBS. */
export function detect(rows) {
  return findHeader(rows) !== null;
}

function isBlank(row) {
  return !row || row.every((c) => c == null || String(c).trim() === '');
}

/**
 * Transforme les lignes d'un export UBS en opérations normalisées.
 * @param {any[][]} rows  lignes de la première feuille
 * @returns {{format: string, transactions: object[], warnings: string[], period: {from: string, to: string}|null, accounts: string[]}}
 */
export function parse(rows) {
  const header = findHeader(rows);
  if (!header) throw new Error("Ce fichier ne ressemble pas à un export UBS (colonnes « Date de transaction », « Description », « Montant » introuvables).");
  const { row: headerRow, map } = header;
  const get = (row, key) => (key in map ? row[map[key]] : null);

  const transactions = [];
  const warnings = [];
  const seen = new Map();

  const fallbackRef = metaAccount(rows, headerRow);
  const text = (row) => {
    if ('description' in map && String(get(row, 'description') ?? '').trim()) return String(get(row, 'description')).trim();
    return ['description1', 'description2', 'description3']
      .map((k) => String(get(row, k) ?? '').trim()).filter(Boolean).join(' · ');
  };
  const cell = (row, key) => {
    const v = get(row, key);
    return v === null || v === undefined || String(v).trim() === '' ? null : v;
  };

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (isBlank(row)) continue;
    const line = r + 1;
    try {
      const date = parseDateCH(cell(row, 'date') ?? get(row, 'bookingDate'));
      const description = text(row);
      let amount;
      const debit = cell(row, 'debit');
      const credit = cell(row, 'credit');
      if (debit !== null || credit !== null) {
        amount = credit !== null && parseAmount(credit) !== 0 ? Math.abs(parseAmount(credit)) : -Math.abs(parseAmount(debit ?? 0));
      } else if (cell(row, 'amount') !== null) {
        amount = parseAmount(get(row, 'amount'));
      } else {
        // Ligne de détail d'un ordre groupé (sans montant propre) : rien à compter.
        continue;
      }
      const direction = fold(get(row, 'direction'));
      if (direction.startsWith('DEPENSE') && amount > 0) {
        amount = -amount;
        warnings.push(`Ligne ${line} : dépense avec un montant positif, signe corrigé.`);
      } else if (direction.startsWith('REVENU') && amount < 0) {
        amount = -amount;
        warnings.push(`Ligne ${line} : revenu avec un montant négatif, signe corrigé.`);
      }
      const accountRef = cell(row, 'accountRef') !== null ? cardRef(get(row, 'accountRef'))
        : cell(row, 'cardNumber') !== null ? cardRef(get(row, 'cardNumber'), { isCardColumn: true })
        : fallbackRef;
      const accountKind = /^\*+\d+$|\*{2,}/.test(accountRef.replace(/\s/g, '')) ? 'carte' : 'compte';
      const currency = String(get(row, 'currency') ?? 'CHF').trim() || 'CHF';
      const bankCategory = String(get(row, 'bankCategory') ?? '').trim() || null;
      const isCardBillPayment =
        accountKind === 'compte' &&
        amount < 0 &&
        (CARD_BILL_CATEGORIES.includes(fold(bankCategory)) || CARD_BILL_WORDS.test(fold(description)));
      // Côté carte, le règlement de la facture apparaît comme un crédit : ce n'est pas une rentrée.
      const isCardPaymentReceived = accountKind === 'carte' && amount > 0 && CARD_PAYMENT_WORDS.test(fold(description));

      const base = { date, amount, accountRef, description };
      const key = fingerprint(base, 0);
      const occurrence = seen.get(key) || 0;
      seen.set(key, occurrence + 1);

      transactions.push({
        id: fingerprint(base, occurrence),
        source: FORMAT_ID,
        date,
        accountRef,
        accountKind,
        description,
        amount,
        currency,
        bankCategory,
        isCardBillPayment,
        isCardPaymentReceived,
        sourceLine: line,
      });
    } catch (err) {
      warnings.push(`Ligne ${line} ignorée : ${err.message}`);
    }
  }

  const dates = transactions.map((t) => t.date).sort();
  return {
    format: FORMAT_ID,
    transactions,
    warnings,
    period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    accounts: [...new Set(transactions.map((t) => t.accountRef))],
  };
}

/**
 * Garde seulement les opérations pas encore importées.
 * @param {Iterable<string>} existingIds  empreintes déjà enregistrées
 */
export function onlyNew(transactions, existingIds) {
  const known = new Set(existingIds);
  return transactions.filter((t) => !known.has(t.id));
}
