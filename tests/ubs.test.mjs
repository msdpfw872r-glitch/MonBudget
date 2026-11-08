/**
 * ubs.test.mjs — Tests de l'import UBS et des outils communs.
 * Lancer : node --test tests/
 *
 * Version : 0.1.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readXlsx, looksLikeZip } from '../src/core/xlsx.js';
import { parseAmount, parseDateCH, merchantKey } from '../src/core/text.js';
import * as ubs from '../src/importers/ubs.js';

const fixture = (name) => readFile(new URL('./fixtures/' + name, import.meta.url));

test('montants suisses', () => {
  assert.equal(parseAmount("8'700.00"), 8700);
  assert.equal(parseAmount('-2’550.00'), -2550);
  assert.equal(parseAmount('1 234,50'), 1234.5);
  assert.equal(parseAmount('125.00-'), -125);
  assert.equal(parseAmount(-64.8), -64.8);
  assert.throws(() => parseAmount('abc'));
});

test('dates suisses', () => {
  assert.equal(parseDateCH('31.10.2026'), '2026-10-31');
  assert.equal(parseDateCH('1.2.26'), '2026-02-01');
  assert.equal(parseDateCH('2026-10-05'), '2026-10-05');
  assert.equal(parseDateCH(46300), "2026-10-05");
  assert.throws(() => parseDateCH('31.02.2026'));
});

test('clé commerçant stable', () => {
  assert.equal(merchantKey('MIGROS M SION 05.10.2026 CARTE 1234'), 'MIGROS M SION CARTE');
  assert.equal(merchantKey('Migros M Sion 12.11.2026 carte 9876'), 'MIGROS M SION CARTE');
});

test('lecture xlsx avec chaînes partagées (export FiQu)', async () => {
  const { sheets } = await readXlsx(await fixture('fiqu-shared-strings.xlsx'));
  assert.equal(sheets[0].name, 'Accounts');
  assert.deepEqual(sheets[0].rows[0], ['Account Name', 'Account Type', 'Currency Code']);
  assert.equal(ubs.detect(sheets[0].rows), false);
});

test('export UBS anonymisé : 10 opérations', async () => {
  const data = await fixture('ubs-exemple-anonymise.xlsx');
  assert.ok(looksLikeZip(data));
  const { sheets } = await readXlsx(data);
  assert.ok(ubs.detect(sheets[0].rows));
  const res = ubs.parse(sheets[0].rows);
  assert.equal(res.transactions.length, 10);
  assert.deepEqual(res.warnings, []);
  assert.deepEqual(res.period, { from: '2026-10-14', to: '2026-10-31' });

  const [salaire, , , loyer] = res.transactions;
  assert.equal(salaire.date, '2026-10-31');
  assert.equal(salaire.amount, 8700);
  assert.equal(salaire.bankCategory, 'Salaire et rentes');
  assert.equal(loyer.amount, -2550);

  const facture = res.transactions.find((t) => t.description.includes('FACTURE CARTE'));
  assert.equal(facture.isCardBillPayment, true);
  const achatCarte = res.transactions.find((t) => t.accountRef === '****0000');
  assert.equal(achatCarte.accountKind, 'carte');
  assert.equal(achatCarte.isCardBillPayment, false);

  const total = res.transactions.reduce((s, t) => s + Math.round(t.amount * 100), 0) / 100;
  assert.equal(total, 1700.6);

  const ids = new Set(res.transactions.map((t) => t.id));
  assert.equal(ids.size, 10, 'empreintes uniques');
  assert.equal(ubs.onlyNew(res.transactions, ids).length, 0, 'réimport : aucun doublon');
});

test('export UBS avec vraies cellules Excel (dates et nombres), lignes avant l’en-tête, doublons le même jour', async () => {
  const { sheets } = await readXlsx(await fixture('ubs-cellules-numeriques.xlsx'));
  const res = ubs.parse(sheets[0].rows);
  assert.equal(res.transactions.length, 3);
  assert.equal(res.transactions[0].date, '2026-10-05');
  assert.equal(res.transactions[0].amount, -64.8);
  assert.notEqual(res.transactions[0].id, res.transactions[1].id, 'deux achats identiques restent distincts');
  assert.equal(res.transactions[2].amount, 1234.5);
  assert.equal(res.transactions[2].bankCategory, null);
});
