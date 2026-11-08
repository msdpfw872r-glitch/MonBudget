/**
 * app.test.mjs — Tests de la coquille de l'app : versions, fichiers hors ligne, aucune requête externe,
 * affichage des montants et des dates.
 * Lancer : npm test
 *
 * Version : 0.2.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Historique :
 *   0.2.0  FRE (Fidag)  Première version.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { formatCHF, formatAmount, formatDateLong, formatMonth } from '../app/src/core/format.js';
import { APP_VERSION } from '../app/js/version.js';

const root = new URL('../', import.meta.url);
const app = new URL('../app/', import.meta.url);
const read = (rel, base = app) => readFile(new URL(rel, base), 'utf8');

async function listFiles(dir, prefix = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...await listFiles(new URL(e.name + '/', dir), prefix + e.name + '/'));
    else out.push(prefix + e.name);
  }
  return out;
}

test('montants au format suisse', () => {
  assert.equal(formatCHF(1517.4), 'CHF 1’517.40');
  assert.equal(formatCHF(-2550), 'CHF −2’550.00');
  assert.equal(formatCHF(1234567.891), 'CHF 1’234’567.89');
  assert.equal(formatCHF(0.004), 'CHF 0.00');
  assert.equal(formatAmount(2390), '+ 2’390.00');
  assert.equal(formatAmount(-64.8), '− 64.80');
  assert.equal(formatAmount(0), '0.00');
});

test('dates en français', () => {
  assert.equal(formatDateLong('2026-10-14'), 'mercredi 14 octobre');
  assert.equal(formatDateLong('2026-11-08', { capital: true }), 'Dimanche 8 novembre');
  assert.equal(formatMonth('2026-11-08'), 'Novembre 2026');
  assert.equal(formatMonth(new Date(2026, 7, 1)), 'Août 2026');
});

test('même version partout (package.json, app, service worker, CHANGELOG)', async () => {
  const pkg = JSON.parse(await read('package.json', root));
  const sw = await read('sw.js');
  const changelog = await read('CHANGELOG.md', root);
  assert.equal(APP_VERSION, pkg.version);
  assert.match(sw, new RegExp(`const VERSION = '${pkg.version.replaceAll('.', '\\.')}'`));
  assert.match(changelog, new RegExp(`^## ${pkg.version.replaceAll('.', '\\.')} `, 'm'));
});

test('le service worker met en cache tous les fichiers de l’app', async () => {
  const sw = await read('sw.js');
  const listed = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
  for (const f of listed) await stat(new URL(f, app)); // chaque fichier listé existe
  const all = (await listFiles(app)).filter((f) => f !== 'sw.js' && !f.endsWith('.txt'));
  const missing = all.filter((f) => !listed.includes(f));
  assert.deepEqual(missing, [], 'fichiers absents de la liste hors ligne de sw.js');
});

test('aucune requête vers Internet dans l’app', async () => {
  const files = (await listFiles(app)).filter((f) => /\.(html|css|js|webmanifest)$/.test(f));
  for (const f of files) {
    const src = await read(f);
    // Seuls les identifiants de format (espaces de noms XML) sont tolérés, jamais chargés.
    const urls = [...src.matchAll(/https?:\/\/[^\s'"<>)]+/g)].map((m) => m[0])
      .filter((u) => !/^http:\/\/(www\.w3\.org|schemas\.openxmlformats\.org|purl\.oclc\.org)\//.test(u));
    assert.deepEqual(urls, [], `adresse externe dans app/${f}`);
  }
  const html = await read('index.html');
  assert.match(html, /Content-Security-Policy" content="default-src 'self'/);
  assert.doesNotMatch(html, /\sstyle="/, 'pas de style en ligne (bloqué par la CSP)');
});

test('manifeste installable', async () => {
  const m = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(m.name, 'Mon Budget');
  assert.equal(m.display, 'standalone');
  const sizes = m.icons.map((i) => i.sizes);
  for (const s of ['180x180', '192x192', '512x512']) assert.ok(sizes.includes(s), s);
  for (const i of m.icons) await stat(new URL(i.src, app));
});
