/**
 * camt053.js — Import des relevés de compte camt.053 (ISO 20022, Swiss Payment Standards / SIX).
 *
 * Version : 0.8.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Suit la spécification « Lecture des relevés camt.053 » v1.0 (FRE (Fidag), docs/specs/camt053.md) :
 *   - versions camt.053.001.04 et .08 (espace de noms ignoré, noms de balises locaux) ;
 *   - une opération par TxDtls, sinon une par Ntry (4.1) ; montant signé, extourne inversée (4.2) ;
 *   - contrepartie : créancier pour une sortie, débiteur pour une entrée, Ultmt… d'abord, nom à
 *     n'importe quelle profondeur (v04 Cdtr/Nm, v08 Cdtr/Pty/Nm) ; sinon texte de la banque (4.3) ;
 *   - paiement groupé sans détail → alerte GROUPE_SANS_DETAIL (4.4) ; référence QRR/SCOR sinon Ustrd (4.5) ;
 *   - code d'opération Domn/Fmly/SubFmly (+ Prtry) traduit en mots simples (4.6) ;
 *   - contrôles (6) : soldes d'ouverture + écritures = solde de clôture (écritures BOOK seulement),
 *     somme des TxDtls = montant du Ntry, anti-doublon AcctSvcrRef + EndToEndId, rapport final.
 * Les écritures non comptabilisées (PDNG) ne sont pas importées ; INFO est ignorée.
 *
 * Historique :
 *   0.8.0  FRE (Fidag)  Première version.
 */

import { fold, toCents, fingerprint, parseDateCH } from '../core/text.js';
import { parseXml, child, childrenOf, path, deep, deepAll, txt } from '../core/xml.js';

export const FORMAT_ID = 'camt053';
export const FORMAT_LABEL = 'Relevé de compte standard (camt.053)';
export const INPUT = 'text';

/** Prélèvement de la facture d'une carte de crédit (à ne pas compter deux fois). */
const CARD_BILL_WORDS = /\bSWISSCARD\b|\bVISECA\b|\bCORNERCARD\b|\bCORNER BANCA\b|\bCARD CENTER\b|\bFACTURE CARTE\b|\bDECOMPTE CARTE\b|\bCEMBRA\b/;

/** Code d'opération → mots simples (indicatif, spécification 4.6). */
export function operationLabel(code) {
  const c = String(code ?? '').toUpperCase();
  if (/CCRD\/CWDL|\/CWDL\b/.test(c)) return 'Retrait au bancomat';
  if (/CCRD\/POSD|\/POSD\b|\/POSP\b/.test(c)) return 'Paiement par carte';
  if (/\/(IDDT|RDDT)\b/.test(c)) return 'Prélèvement (LSV)';
  if (/\/RCDT\b/.test(c)) return 'Virement reçu';
  if (/\/ICDT\b/.test(c)) return 'Virement émis';
  if (/^ACMT\b|\/CHRG\b|\/FEES\b|\/INTR\b/.test(c)) return 'Frais ou intérêts';
  return null;
}

/** Vrai si le texte est un relevé camt.053. */
export function detect(text) {
  const head = String(text ?? '').slice(0, 4000);
  return /camt\.053\.001\.\d+/.test(head) || (/BkToCstmrStmt/.test(head) && /<(\w+:)?Stmt[\s>]/.test(String(text)));
}

const amountOf = (el) => (el ? Number(txt(el).replace(/[\s’']/g, '')) : NaN);
const ccyOf = (el) => el?.attrs.Ccy ?? '';
const dateOf = (el) => {
  const d = txt(child(el, 'Dt')) || txt(child(el, 'DtTm')).slice(0, 10);
  return d ? parseDateCH(d) : '';
};
const status = (ntry) => {
  const s = child(ntry, 'Sts');
  return (txt(child(s, 'Cd')) || txt(s) || 'BOOK').toUpperCase();
};

/** Nom d'une partie : <Nm> à n'importe quelle profondeur (v04 Cdtr/Nm, v08 Cdtr/Pty/Nm). */
function partyName(el) {
  const nm = el && (child(el, 'Nm') ? child(el, 'Nm') : deep(el, 'Nm'));
  return txt(nm);
}
function partyPlace(el) {
  const adr = el && deep(el, 'PstlAdr');
  if (!adr) return '';
  const town = txt(deep(adr, 'TwnNm')) || txt(childrenOf(adr, 'AdrLine').at(-1));
  return [town, txt(deep(adr, 'Ctry'))].filter(Boolean).join(', ');
}
/** Normalise un nom pour regrouper un même créancier (espaces, majuscules). */
export const normalizeName = (s) => fold(s).replace(/\s+/g, ' ').trim();

function bankCode(ntry, tx) {
  const b = child(tx, 'BkTxCd') ?? child(ntry, 'BkTxCd');
  if (!b) return '';
  const domn = child(b, 'Domn');
  const iso = [txt(child(domn, 'Cd')), txt(path(domn ?? { children: [] }, 'Fmly/Cd')), txt(path(domn ?? { children: [] }, 'Fmly/SubFmlyCd'))]
    .filter(Boolean).join('/');
  const prtry = txt(path(b, 'Prtry/Cd'));
  return [iso, prtry].filter(Boolean).join(' ');
}

function reference(tx) {
  const strd = deepAll(child(tx, 'RmtInf'), 'Strd');
  for (const s of strd) {
    const ref = txt(path(s, 'CdtrRefInf/Ref'));
    if (ref) return ref;
  }
  return '';
}
const communication = (tx) => childrenOf(child(tx, 'RmtInf'), 'Ustrd').map(txt).filter(Boolean).join(' ');

/**
 * Lit un relevé camt.053.
 * @returns {{format, transactions, warnings, notes, period, accounts, pendingCount, report}}
 */
export function parse(text) {
  const doc = parseXml(text);
  const stmts = deepAll(doc, 'Stmt');
  if (!stmts.length) throw new Error('Ce fichier ne contient aucun relevé de compte.');
  const transactions = [];
  const warnings = [];
  const notes = [];
  const alerts = { GROUPE_SANS_DETAIL: 0, EXTOURNE: 0, NOM_MANQUANT: 0, SOMME_DETAILS: 0, SOLDE: 0 };
  let pendingCount = 0;
  const seenIds = new Map();

  for (const stmt of stmts) {
    const acct = child(stmt, 'Acct');
    const iban = txt(path(acct, 'Id/IBAN')) || txt(path(acct, 'Id/Othr/Id')) || 'COMPTE';
    const acctCcy = txt(child(acct, 'Ccy')) || 'CHF';
    let bookedSum = 0;

    childrenOf(stmt, 'Ntry').forEach((ntry, ni) => {
      const st = status(ntry);
      if (st === 'PDNG') { pendingCount++; return; }
      if (st !== 'BOOK') return;
      const nAmt = amountOf(child(ntry, 'Amt'));
      const nSign = txt(child(ntry, 'CdtDbtInd')) === 'CRDT' ? 1 : -1;
      const reversal = txt(child(ntry, 'RvslInd')).toLowerCase() === 'true';
      const date = dateOf(child(ntry, 'BookgDt')) || dateOf(child(ntry, 'ValDt'));
      const ntryLabel = txt(child(ntry, 'AddtlNtryInf'));
      const ntryRef = txt(child(ntry, 'AcctSvcrRef'));
      if (!Number.isFinite(nAmt) || !date) { warnings.push(`Écriture ${ni + 1} ignorée : montant ou date illisible.`); return; }
      const nSigned = toCents(nAmt) * nSign * (reversal ? -1 : 1);
      bookedSum += nSigned;
      if (reversal) alerts.EXTOURNE++;

      const details = deepAll(child(ntry, 'NtryDtls') ?? { children: [] }, 'TxDtls');
      const batchCount = Number(txt(deep(child(ntry, 'NtryDtls'), 'NbOfTxs'))) || 0;
      const lines = details.length ? details : [null];
      if (!details.length && batchCount > 1) {
        alerts.GROUPE_SANS_DETAIL++;
        warnings.push(`${ntryLabel || 'Paiement groupé'} du ${date.split('-').reverse().join('.')} : ${batchCount} paiements groupés sans détail par bénéficiaire (le détail se trouve dans l’avis de débit de la banque).`);
      }
      if (details.length > 1 || (details.length === 1 && child(details[0], 'Amt'))) {
        const sum = details.reduce((s, tx) => {
          const a = child(tx, 'Amt') ?? path(tx, 'AmtDtls/TxAmt/Amt');
          return s + (a ? toCents(amountOf(a)) : 0);
        }, 0);
        if (details.every((tx) => child(tx, 'Amt') || path(tx, 'AmtDtls/TxAmt/Amt')) && sum !== toCents(nAmt)) {
          alerts.SOMME_DETAILS++;
          warnings.push(`${ntryLabel || 'Écriture'} du ${date.split('-').reverse().join('.')} : la somme du détail ne correspond pas au montant de l’écriture.`);
        }
      }

      lines.forEach((tx, ti) => {
        const aEl = (tx && (child(tx, 'Amt') ?? path(tx, 'AmtDtls/TxAmt/Amt'))) || child(ntry, 'Amt');
        const ind = (tx && txt(child(tx, 'CdtDbtInd'))) || txt(child(ntry, 'CdtDbtInd'));
        let amount = toCents(amountOf(aEl)) * (ind === 'CRDT' ? 1 : -1);
        if (reversal) amount = -amount;
        const credit = amount > 0;
        const parties = tx && child(tx, 'RltdPties');
        // 4.3 : je paie → le créancier ; je reçois → le débiteur ; le bénéficiaire final d'abord.
        // Le sens d'ORIGINE compte : une extourne d'un paiement garde le créancier du paiement.
        const [ult, main, acctTag] = ind === 'CRDT' ? ['UltmtDbtr', 'Dbtr', 'DbtrAcct'] : ['UltmtCdtr', 'Cdtr', 'CdtrAcct'];
        let name = partyName(child(parties, ult)) || partyName(child(parties, main));
        let source = 'xml';
        const txInfo = tx ? txt(child(tx, 'AddtlTxInf')) : '';
        const code = bankCode(ntry, tx);
        const grouped = !details.length && batchCount > 1;
        if (!name) {
          if (txInfo || (!/CHRG|FEES|INTR|CWDL|^ACMT/.test(code) && ntryLabel)) {
            name = txInfo || ntryLabel;
            source = 'texte';
            if (!grouped) alerts.NOM_MANQUANT++;
          } else {
            name = ntryLabel || 'Opération bancaire';
            source = 'banque';
          }
        }
        const cpIban = txt(path(child(parties, acctTag) ?? { children: [] }, 'Id/IBAN'));
        const place = partyPlace(child(parties, ult)) || partyPlace(child(parties, main));
        const comm = tx ? communication(tx) : '';
        const ref = tx ? reference(tx) : '';
        const e2e = tx ? txt(path(tx, 'Refs/EndToEndId')) : '';
        const bankRef = (tx && txt(path(tx, 'Refs/AcctSvcrRef'))) || ntryRef;
        const description = [ntryLabel, source !== 'banque' && name !== ntryLabel ? name : '', comm].filter(Boolean).join(' · ') || name;
        const isCardBillPayment = !credit && CARD_BILL_WORDS.test(fold(`${name} ${ntryLabel} ${comm}`));
        // 6.4 : identifiant stable par référence banque + EndToEndId (fichiers qui se chevauchent).
        const refKey = bankRef && e2e && e2e !== 'NOTPROVIDED' ? `${bankRef}|${e2e}` : bankRef ? `${bankRef}|${ti}` : '';
        let id = refKey ? `camt|${iban.replace(/\s/g, '')}|${refKey}` : fingerprint({ date, amount: amount / 100, accountRef: iban, description }, 0);
        const occ = seenIds.get(id) ?? 0;
        seenIds.set(id, occ + 1);
        if (occ) id = `${id}|${occ}`;
        transactions.push({
          id,
          source: FORMAT_ID,
          date,
          valueDate: dateOf(child(ntry, 'ValDt')) || null,
          accountRef: iban,
          accountKind: 'compte',
          description,
          merchant: source === 'banque' ? null : name,
          counterparty: { name, iban: cpIban || null, place: place || null, source },
          amount: amount / 100,
          currency: ccyOf(aEl) || acctCcy,
          bankCategory: operationLabel(code) ?? (code || null),
          operationCode: code || null,
          reference: ref || null,
          communication: comm || null,
          bankRef: bankRef || null,
          endToEndId: e2e || null,
          note: [ref ? `Référence : ${ref}` : '', comm ? `Communication : ${comm}` : '', place ? `Lieu : ${place}` : ''].filter(Boolean).join(' · '),
          alert: reversal ? 'EXTOURNE' : grouped ? 'GROUPE_SANS_DETAIL' : source === 'texte' ? 'NOM_MANQUANT' : '',
          isCardBillPayment,
        });
      });
    });

    // 6.1 : solde d'ouverture + écritures comptabilisées = solde de clôture.
    const bal = (cd) => {
      const b = childrenOf(stmt, 'Bal').find((x) => txt(path(x, 'Tp/CdOrPrtry/Cd')) === cd);
      if (!b) return null;
      return toCents(amountOf(child(b, 'Amt'))) * (txt(child(b, 'CdtDbtInd')) === 'DBIT' ? -1 : 1);
    };
    const open = bal('OPBD') ?? bal('PRCD');
    const close = bal('CLBD');
    if (open !== null && close !== null) {
      if (open + bookedSum === close) notes.push(`Soldes vérifiés pour le compte ${shortIban(iban)} : le relevé est complet.`);
      else {
        alerts.SOLDE++;
        warnings.push(`Compte ${shortIban(iban)} : les soldes ne correspondent pas (écart de CHF ${((close - open - bookedSum) / 100).toFixed(2)}). Il manque peut-être des opérations dans ce fichier.`);
      }
    }
  }

  const dates = transactions.map((t) => t.date).sort();
  const report = {
    lignes: transactions.length,
    contreparties: new Set(transactions.filter((t) => t.counterparty.source !== 'banque').map((t) => normalizeName(t.counterparty.name))).size,
    alertes: Object.fromEntries(Object.entries(alerts).filter(([, v]) => v)),
  };
  return {
    format: FORMAT_ID,
    transactions,
    warnings,
    notes,
    period: dates.length ? { from: dates[0], to: dates.at(-1) } : null,
    accounts: [...new Set(transactions.map((t) => t.accountRef))],
    pendingCount,
    report,
  };
}

function shortIban(iban) {
  const s = String(iban).replace(/\s/g, '');
  return s.length > 6 ? `…${s.slice(-6)}` : s;
}
