/**
 * csv.test.mjs — Tests de la lecture CSV et de l'export UBS en CSV.
 * Lancer : npm test
 *
 * Version : 0.4.1
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Les fichiers sont construits ici (données anonymisées). Les variantes « Débit / Crédit »,
 * « Description1…3 » et numéro de carte complet sont construites d'après la structure connue
 * des exports UBS : à confirmer sur un vrai fichier.
 *
 * Historique :
 *   0.4.1  FRE (Fidag)  Première version.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCsv, decodeText, looksLikeText } from '../app/src/core/csv.js';
import { readXlsx } from '../app/src/core/xlsx.js';
import { openMemoryDb } from '../app/src/data/db.js';
import * as R from '../app/src/core/reglages.js';
import * as I from '../app/src/core/import.js';
import * as C from '../app/src/core/cartes.js';
import * as ubs from '../app/src/importers/ubs.js';

const seed = JSON.parse(await readFile(new URL('../app/src/data/seed.json', import.meta.url), 'utf8'));
const enc = (s) => new TextEncoder().encode(s);
/** Encodage Windows-1252 (Excel suisse) pour les caractères utilisés ici. */
const cp1252 = (s) => Uint8Array.from([...s].map((c) => ({ é: 0xE9, è: 0xE8, É: 0xC9, à: 0xE0, ô: 0xF4, '’': 0x92 })[c] ?? c.charCodeAt(0)));

const HEAD = 'Date de transaction;Numéro de compte ou de carte;Description;Revenu ou dépense;Montant;Monnaie;Catégorie';

test('CSV : séparateurs, guillemets, retours à la ligne, ligne « sep= »', () => {
  assert.deepEqual(parseCsv('a;b;c\n1;"x;y";3\n'), [['a', 'b', 'c'], ['1', 'x;y', '3']]);
  assert.deepEqual(parseCsv('a,b\r\n"il dit ""oui""",2\r\n'), [['a', 'b'], ['il dit "oui"', '2']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('sep=,\na;b,c\n'), [['a;b', 'c']]);
  assert.deepEqual(parseCsv('a;b\n"ligne 1\nligne 2";x\n\n'), [['a', 'b'], ['ligne 1\nligne 2', 'x']]);
  // Montant avec virgule décimale et séparateur « ; » : la virgule ne coupe pas la cellule.
  assert.deepEqual(parseCsv('Date;Montant\n01.10.2026;-1 234,50\n02.10.2026;12,00'), [['Date', 'Montant'], ['01.10.2026', '-1 234,50'], ['02.10.2026', '12,00']]);
});

test('encodages : UTF-8 (avec ou sans BOM), Windows-1252, UTF-16', () => {
  assert.equal(decodeText(enc('﻿Dépense')), 'Dépense');
  assert.equal(decodeText(enc('Dépense')), 'Dépense');
  assert.equal(decodeText(cp1252('Dépense')), 'Dépense');
  const u16 = new Uint8Array([0xFF, 0xFE, ...[...'Débit'].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8])]);
  assert.equal(decodeText(u16), 'Débit');
  assert.equal(looksLikeText(enc('a;b\n1;2')), true);
  assert.equal(looksLikeText(new Uint8Array([0, 1, 2, 3, 0, 0, 7])), false);
});

test('export UBS en CSV : même résultat que l’Excel (mêmes empreintes)', async () => {
  const xlsx = await I.readBankFile(await readFile(new URL('./fixtures/ubs-exemple-anonymise.xlsx', import.meta.url)));
  const { sheets } = await readXlsx(await readFile(new URL('./fixtures/ubs-exemple-anonymise.xlsx', import.meta.url)));
  const csvText = sheets[0].rows.map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\r\n');
  for (const bytes of [enc('﻿' + csvText), cp1252(csvText.replace(/’/g, "'"))]) {
    const csv = await I.readBankFile(bytes);
    assert.equal(csv.format, ubs.FORMAT_ID);
    assert.deepEqual(csv.transactions.map((t) => t.id), xlsx.transactions.map((t) => t.id));
    assert.deepEqual(csv.transactions.map((t) => t.amount), xlsx.transactions.map((t) => t.amount));
  }
});

test('Excel puis CSV du même relevé : aucun doublon', async () => {
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  await R.assignBankRef(db, 'carte-ubs-maman', '****0000');
  const xlsxBytes = await readFile(new URL('./fixtures/ubs-exemple-anonymise.xlsx', import.meta.url));
  const p1 = await I.prepareImport(db, await I.readBankFile(xlsxBytes));
  await I.commitImport(db, p1);
  const { sheets } = await readXlsx(xlsxBytes);
  const csv = sheets[0].rows.map((r) => r.join(';')).join('\n');
  const p2 = await I.prepareImport(db, await I.readBankFile(enc(csv)));
  assert.equal(p2.counts.nouvelles, 0);
  assert.equal(p2.counts.doublons, 10);
});

test('CSV avec séparateur virgule et montants entre guillemets', async () => {
  const text = [HEAD.replace(/;/g, ','),
    '03.10.2026,****1111,"MIGROS M SION, 03.10.2026",Dépense,"-1,064.80",CHF,Achats',
    '31.10.2026,CH00 0000 0000 0000 0000 0,RENTE AVS,Revenu,"2,390.00",CHF,Salaire et rentes'].join('\n');
  const res = await I.readBankFile(enc(text));
  assert.deepEqual(res.transactions.map((t) => [t.date, t.amount, t.accountKind]), [['2026-10-03', -1064.8, 'carte'], ['2026-10-31', 2390, 'compte']]);
});

test('variante : Débit / Crédit, Description1…3, IBAN au-dessus du tableau, date avec heure', async () => {
  const text = [
    'Numéro de compte:;0000 00000000.00;',
    'IBAN:;CH00 0000 0000 0000 0000 0;',
    'Du:;01.10.2026;', 'Au:;31.10.2026;', '',
    'Date de transaction;Heure de transaction;Date de comptabilisation;Date de valeur;Monnaie;Débit;Crédit;Sous-montant;Solde;N° de transaction;Description1;Description2;Description3;Notes de bas de page;',
    "02.10.2026;08:15:00;02.10.2026;02.10.2026;CHF;-2'550.00;;;10'000.00;111;ÉMETTEUR 04;LOYER OCTOBRE;;;",
    "26.10.2026;;26.10.2026;26.10.2026;CHF;-238.50;;;7'211.50;112;UBS CARD CENTER;LSV FACTURE CARTE;;;",
    ';;;;;;;-100.00;;;détail d’un ordre groupé;;;;',
    "31.10.2026 09:00;;31.10.2026;31.10.2026;CHF;;2'390.00;;9'601.50;113;CAISSE AVS;RENTE;;;",
  ].join('\n');
  const res = await I.readBankFile(enc(text));
  assert.equal(res.transactions.length, 3, 'la ligne de détail sans date ni montant est ignorée');
  const [loyer, facture, rente] = res.transactions;
  assert.equal(loyer.amount, -2550);
  assert.equal(loyer.description, 'ÉMETTEUR 04 · LOYER OCTOBRE');
  assert.equal(loyer.accountRef, 'CH00 0000 0000 0000 0000 0');
  assert.equal(loyer.accountKind, 'compte');
  assert.equal(facture.isCardBillPayment, true);
  assert.equal(rente.amount, 2390);
  assert.equal(rente.date, '2026-10-31');
});

test('variante carte : numéro complet ramené à ****1234, règlement reçu sur la carte', async () => {
  const text = [
    'sep=;',
    "Numéro de compte;Numéro de carte;Titulaire compte/carte;Date d'achat;Texte comptable;Secteur;Montant;Monnaie originale;Cours;Monnaie;Débit;Crédit;Écriture",
    '0000 0000 0000;5555 66XX XXXX 1111;TITULAIRE A;03.10.2026;MIGROS M SION;Supermarchés;64.80;CHF;;CHF;64.80;;04.10.2026',
    '0000 0000 0000;5555 66XX XXXX 2222;TITULAIRE B;05.10.2026;GARAGE DU CENTRE;Garages;120.00;CHF;;CHF;120.00;;06.10.2026',
    '0000 0000 0000;5555 66XX XXXX 2222;TITULAIRE B;12.10.2026;HOTEL PARIS;Hôtels;30.00;EUR;0.95;CHF;28.50;;13.10.2026',
    '0000 0000 0000;5555 66XX XXXX 1111;TITULAIRE A;27.10.2026;VOTRE PAIEMENT LSV;;;;;CHF;;213.30;27.10.2026',
  ].join('\n');
  const res = await I.readBankFile(enc(text));
  assert.deepEqual(res.transactions.map((t) => [t.accountRef, t.amount]), [['****1111', -64.8], ['****2222', -120], ['****2222', -28.5], ['****1111', 213.3]]);
  assert.equal(res.transactions[3].isCardPaymentReceived, true);
  assert.deepEqual(res.accounts.sort(), ['****1111', '****2222']);

  // À l'import, le règlement reçu sur la carte est classé « facture » : ni rentrée ni dépense.
  const db = openMemoryDb();
  await R.installSeed(db, seed);
  await R.assignBankRef(db, 'carte-ubs-maman', '****1111');
  await R.assignBankRef(db, 'carte-ubs-papa', '****2222');
  const plan = await I.prepareImport(db, res);
  const pay = plan.transactions.find((t) => t.amount > 0);
  assert.equal(pay.categoryId, 'paiement-facture-carte');
  assert.equal(pay.status, 'classee');
  assert.equal(pay.isCardBillPayment, false, 'ce n’est pas une facture à rattacher');
  await I.commitImport(db, plan);
  assert.deepEqual(await C.listBills(db), []);
});

test('un CSV qui ne vient pas d’UBS est refusé en mots simples', async () => {
  await assert.rejects(I.readBankFile(enc('Transaction date,Amount,Currency,Description\n2026-10-03,-10,CHF,Test')), /pas reconnu.*Excel ou CSV/);
  await assert.rejects(I.readBankFile(enc('')), /pas reconnu/);
});
