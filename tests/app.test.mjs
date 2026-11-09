/**
 * app.test.mjs — Tests de la coquille de l'app : versions, fichiers hors ligne, aucune requête externe,
 * affichage des montants et des dates.
 * Lancer : npm test
 *
 * Version : 0.8.5
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Historique :
 *   0.2.0  FRE (Fidag)  Première version.
 *   0.4.0  FRE (Fidag)  Noms lisibles des opérations et périodes des relevés.
 *   0.8.5  FRE (Fidag)  Réseau : CSP limitée à Firebase ; SDK Firebase copié vérifié.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { formatCHF, formatAmount, formatDateLong, formatMonth, formatPeriod, displayName } from '../app/src/core/format.js';
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

test('noms lisibles et périodes', () => {
  assert.equal(displayName('MIGROS M SION 03.10.2026 CARTE XXXX4567'), 'Migros M Sion');
  assert.equal(displayName('ÉMETTEUR 04 - LOYER'), 'Émetteur 04 - Loyer');
  assert.equal(displayName('PHARMACIE DE LA GARE'), 'Pharmacie de la Gare');
  assert.equal(displayName('Coop City'), 'Coop City');
  assert.equal(displayName('12345678'), '12345678');
  assert.equal(formatPeriod({ from: '2026-10-01', to: '2026-10-31' }), 'du 1er au 31 octobre');
  assert.equal(formatPeriod({ from: '2026-09-28', to: '2026-10-04' }), 'du 28 septembre au 4 octobre');
  assert.equal(formatPeriod({ from: '2026-10-04', to: '2026-10-04' }), 'le 4 octobre');
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
  // Le SDK Firebase copié (vendor/) contient les adresses des services Google : seule la CSP compte pour lui.
  const files = (await listFiles(app)).filter((f) => /\.(html|css|js|webmanifest)$/.test(f) && !f.startsWith('vendor/'));
  for (const f of files) {
    const src = await read(f);
    // Seuls les identifiants de format (espaces de noms XML) sont tolérés, jamais chargés.
    // La CSP de index.html nomme les services Firebase autorisés : vérifiée à part ci-dessous.
    const code = f === 'index.html' ? src.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '') : src;
    const urls = [...code.matchAll(/https?:\/\/[^\s'"<>)]+/g)].map((m) => m[0])
      .filter((u) => !/^http:\/\/(www\.w3\.org|schemas\.openxmlformats\.org|purl\.oclc\.org)\//.test(u));
    assert.deepEqual(urls, [], `adresse externe dans app/${f}`);
  }
  const html = await read('index.html');
  assert.match(html, /Content-Security-Policy" content="default-src 'self'/);
  assert.doesNotMatch(html, /\sstyle="/, 'pas de style en ligne (bloqué par la CSP)');
  // Réseau : uniquement la synchronisation chiffrée Firebase, aucun script externe.
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  const dir = (name) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' '));
  assert.equal(dir('script-src'), "script-src 'self'");
  assert.equal(dir('connect-src'), "connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com");
});

test('SDK Firebase copié : version 13.2.0, aucun import depuis Internet', async () => {
  const dir = 'vendor/firebase/13.2.0/';
  for (const f of ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore-lite.js']) {
    const src = await read(dir + f);
    assert.doesNotMatch(src, /(from|import)\s*\(?\s*["']https?:/, `${f} : import externe`);
    assert.doesNotMatch(src, /sourceMappingURL/);
  }
  assert.match(await read(dir + 'firebase-auth.js'), /from"\.\/firebase-app\.js"/);
  assert.match(await read(dir + 'firebase-app.js'), /13\.2\.0/);
  assert.match(await read('js/cloud.js'), /'\.\.\/vendor\/firebase\/13\.2\.0\/'/);
});

test('manifeste installable', async () => {
  const m = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(m.name, 'Mon Budget');
  assert.equal(m.display, 'standalone');
  const sizes = m.icons.map((i) => i.sizes);
  for (const s of ['180x180', '192x192', '512x512']) assert.ok(sizes.includes(s), s);
  for (const i of m.icons) await stat(new URL(i.src, app));
});
