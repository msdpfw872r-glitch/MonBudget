/**
 * camt053.test.mjs — Tests du lecteur XML et de l'import camt.053 (versions .04 et .08).
 * Lancer : npm test
 *
 * Version : 0.8.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Fichiers d'exemple INVENTÉS, construits selon la norme (spécification docs/specs/camt053.md) :
 * à confirmer sur un vrai relevé de banque.
 *
 * Historique :
 *   0.8.0  FRE (Fidag)  Première version.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseXml, path, deep, txt, decodeEntities } from '../app/src/core/xml.js';
import * as camt from '../app/src/importers/camt053.js';
import { openMemoryDb } from '../app/src/data/db.js';
import * as R from '../app/src/core/reglages.js';
import * as I from '../app/src/core/import.js';
import * as C from '../app/src/core/cartes.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));
const V08 = await readFile(new URL('./fixtures/camt053-v08-invente.xml', import.meta.url));
const V04 = await readFile(new URL('./fixtures/camt053-v04-invente.xml', import.meta.url));
const byE2E = (res, e2e) => res.transactions.find((t) => t.endToEndId === e2e);

test('lecteur XML : préfixes ignorés, attributs, entités, CDATA, commentaires', () => {
  const doc = parseXml(`<?xml version="1.0"?><!-- c --><ns:A xmlns:ns="x"><ns:B Ccy='CHF'>1&amp;2 &#233;&#xE9;</ns:B><C/><D><![CDATA[<pas une balise>]]></D></ns:A>`);
  assert.equal(doc.name, 'A');
  assert.equal(path(doc, 'B').attrs.Ccy, 'CHF');
  assert.equal(txt(path(doc, 'B')), '1&2 éé');
  assert.ok(path(doc, 'C'));
  assert.equal(txt(deep(doc, 'D')), '<pas une balise>');
  assert.equal(decodeEntities('&lt;&gt;&quot;&apos;&inconnu;'), '<>"\'&inconnu;');
});

test('détection : camt.053 reconnu, autre XML non', () => {
  assert.equal(camt.detect(V08.toString('utf8')), true);
  assert.equal(camt.detect(V04.toString('utf8')), true);
  assert.equal(camt.detect('<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"><CstmrCdtTrfInitn/></Document>'), false);
});

test('v08 : une ligne par TxDtls, montants signés, contreparties (règles 4.1 à 4.3)', async () => {
  const res = await I.readBankFile(V08);
  assert.equal(res.format, 'camt053');
  assert.equal(res.transactions.length, 10, '9 écritures BOOK, dont une groupée en 2 détails');
  assert.equal(res.pendingCount, 1, 'l’écriture PDNG n’est pas importée');
  assert.deepEqual(res.accounts, ['CH0000000000000000001']);

  const avs = byE2E(res, 'E2E-AVS-10');
  assert.equal(avs.amount, 2390);
  assert.deepEqual(avs.counterparty, { name: 'Caisse de compensation Exemple', iban: 'CH0000000000000000099', place: 'Sion, CH', source: 'xml' });
  assert.equal(avs.bankCategory, 'Virement reçu');
  assert.equal(avs.communication, 'RENTE AVS OCTOBRE');
  assert.equal(avs.merchant, 'Caisse de compensation Exemple', 'la règle se fera sur le vrai payeur, pas « Crédit »');

  const cm = byE2E(res, 'E2E-CM-10');
  assert.deepEqual([cm.amount, cm.counterparty.name, cm.reference], [-345.05, 'Caisse Maladie Exemple SA', '210000000003139471430009017']);
  assert.equal(cm.operationCode, 'PMNT/ICDT/DMCT EBILL', 'code propriétaire conservé');

  const g1 = byE2E(res, 'E2E-G1');
  const g2 = byE2E(res, 'E2E-G2');
  assert.deepEqual([g1.amount, g1.counterparty.name], [-120, 'Garage du Centre'], 'bénéficiaire final (UltmtCdtr) d’abord');
  assert.equal(g1.communication, 'Service voiture facture 77', 'plusieurs Ustrd mis bout à bout');
  assert.deepEqual([g2.amount, g2.counterparty.name], [-180, 'Services Industriels Exemple']);
});

test('v08 : groupé sans détail, extourne, frais, bancomat, nom dans le texte, facture de carte', async () => {
  const res = await I.readBankFile(V08);
  const group = res.transactions.find((t) => t.alert === 'GROUPE_SANS_DETAIL');
  assert.equal(group.amount, -450);
  assert.ok(res.warnings.some((w) => /3 paiements groupés sans détail/.test(w)));

  const rv = byE2E(res, 'E2E-RV');
  assert.deepEqual([rv.amount, rv.alert, rv.counterparty.name], [50, 'EXTOURNE', 'Boutique Exemple'], 'extourne : signe inversé, contrepartie = le créancier d’origine');

  const fees = res.transactions.find((t) => t.description === 'Frais de tenue de compte');
  assert.deepEqual([fees.amount, fees.counterparty.source, fees.merchant, fees.bankCategory], [-6, 'banque', null, 'Frais ou intérêts']);
  const atm = res.transactions.find((t) => t.bankCategory === 'Retrait au bancomat');
  assert.deepEqual([atm.amount, atm.counterparty.source], [-200, 'banque']);

  const pos = byE2E(res, 'E2E-POS');
  assert.deepEqual([pos.counterparty.name, pos.counterparty.source, pos.alert, pos.bankCategory], ['Boulangerie Exemple Ville', 'texte', 'NOM_MANQUANT', 'Paiement par carte']);

  const lsv = res.transactions.find((t) => t.isCardBillPayment);
  assert.deepEqual([lsv.amount, lsv.counterparty.name, lsv.bankCategory], [-253.4, 'SWISSCARD AECS GMBH', 'Prélèvement (LSV)']);
});

test('contrôles : soldes rapprochés, rapport final', async () => {
  const res = await I.readBankFile(V08);
  assert.deepEqual(res.notes, ['Soldes vérifiés pour le compte …000001 : le relevé est complet.']);
  assert.deepEqual(res.report.alertes, { GROUPE_SANS_DETAIL: 1, EXTOURNE: 1, NOM_MANQUANT: 1 });
  assert.equal(res.report.lignes, 10);
  assert.equal(res.report.contreparties, 8);
});

test('v04 : Cdtr/Nm, Sts en texte, plusieurs comptes, adresse en lignes, écart de solde signalé', async () => {
  const res = await I.readBankFile(V04);
  assert.deepEqual(res.accounts, ['CH0000000000000000001', 'CH0000000000000000002']);
  const fam = byE2E(res, 'E2E-OP');
  assert.deepEqual([fam.amount, fam.counterparty.name, fam.counterparty.iban, fam.counterparty.place], [-100, 'Famille   Exemple'.replace(/\s+/g, ' '), 'CH0000000000000000077', '1000 Ville']);
  assert.equal(camt.normalizeName('Famille   exemple'), camt.normalizeName('FAMILLE EXEMPLE'), 'un même créancier écrit différemment se regroupe');
  const ass = byE2E(res, 'E2E-EP');
  assert.equal(ass.counterparty.name, 'Assurance Exemple', 'UltmtDbtr d’abord pour une entrée');
  assert.ok(res.notes.some((n) => /…000001 : le relevé est complet/.test(n)));
  assert.ok(res.warnings.some((w) => /…000002 : les soldes ne correspondent pas \(écart de CHF 10\.00\)/.test(w)));
});

test('somme des détails différente du montant de l’écriture : alerte', () => {
  const xml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt><Acct><Id><IBAN>CH01</IBAN></Id></Acct>
    <Ntry><Amt Ccy="CHF">100.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-10-01</Dt></BookgDt><AcctSvcrRef>R1</AcctSvcrRef>
      <NtryDtls><TxDtls><Amt Ccy="CHF">60.00</Amt><RltdPties><Cdtr><Pty><Nm>A</Nm></Pty></Cdtr></RltdPties></TxDtls>
      <TxDtls><Amt Ccy="CHF">30.00</Amt><RltdPties><Cdtr><Pty><Nm>B</Nm></Pty></Cdtr></RltdPties></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`;
  const res = camt.parse(xml);
  assert.equal(res.report.alertes.SOMME_DETAILS, 1);
  assert.ok(res.warnings.some((w) => /somme du détail ne correspond pas/.test(w)));
  assert.deepEqual(res.transactions.map((t) => t.amount), [-60, -30]);
});

test('champs absents : rien ne plante', () => {
  const xml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.04"><BkToCstmrStmt><Stmt><Acct><Id><Othr><Id>K 0000.00.00</Id></Othr></Id></Acct>
    <Ntry><Amt Ccy="CHF">5.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-10-01</Dt></BookgDt></Ntry></Stmt></BkToCstmrStmt></Document>`;
  const res = camt.parse(xml);
  assert.equal(res.transactions.length, 1);
  assert.deepEqual([res.transactions[0].amount, res.transactions[0].accountRef, res.transactions[0].counterparty.name], [5, 'K 0000.00.00', 'Opération bancaire']);
});

test('import dans l’app : compte choisi par IBAN, anti-doublon entre fichiers, facture de carte, règles sur le vrai payeur', async () => {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  const res08 = await I.readBankFile(V08);
  let plan = await I.prepareImport(db, res08);
  // Plusieurs comptes bancaires (UBS, BCVs) : l'app demande lequel.
  assert.equal(plan.needsMapping.length, 1);
  assert.deepEqual(plan.needsMapping[0].choices.filter((a) => a.kind === 'compte').map((a) => a.id), ['ubs', 'bcvs']);
  await R.assignBankRef(db, 'bcvs', 'CH0000000000000000001');
  plan = await I.prepareImport(db, res08);
  assert.equal(plan.counts.nouvelles, 10);
  assert.deepEqual(plan.notes, res08.notes);
  const cm = plan.transactions.find((t) => t.endToEndId === 'E2E-CM-10');
  assert.equal(cm.merchantKey, 'CAISSE MALADIE EXEMPLE SA');
  assert.equal(cm.counterparty.name, 'Caisse Maladie Exemple SA');
  assert.equal(cm.merchant, 'Caisse Maladie Exemple SA', 'nom affiché = la contrepartie');
  const lsv = plan.transactions.find((t) => t.isCardBillPayment);
  assert.equal(lsv.categoryId, 'paiement-facture-carte');
  await I.commitImport(db, plan);
  assert.equal((await C.listBills(db)).length, 1);

  // Le fichier .04 reprend la rente AVS (même référence banque) : pas de doublon.
  await R.assignBankRef(db, 'ubs', 'CH0000000000000000002');
  const p2 = await I.prepareImport(db, await I.readBankFile(V04));
  assert.deepEqual([p2.counts.doublons, p2.counts.nouvelles], [1, 2]);
});
