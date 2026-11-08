/**
 * csv.js — Lecture des fichiers texte des banques (CSV), sans dépendance, dans Safari et Node.
 *
 * Version : 0.4.1
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * - Encodage : UTF-8 (avec ou sans BOM), UTF-16 (avec BOM), sinon Windows-1252 (accents d'Excel).
 * - Séparateur : « ; », « , » ou tabulation, deviné sur les premières lignes ; ligne « sep=; » acceptée.
 * - Guillemets "…" avec "" pour un guillemet, retours à la ligne dans un champ.
 * Renvoie des lignes de cellules (texte), comme le lecteur Excel.
 *
 * Historique :
 *   0.4.1  FRE (Fidag)  Première version (export UBS en CSV).
 */

/** Décode les octets d'un fichier texte. */
export function decodeText(data) {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder('utf-8').decode(b.subarray(3));
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return new TextDecoder('windows-1252').decode(b);
  }
}

/** Vrai si les octets ressemblent à du texte (pas un fichier binaire). */
export function looksLikeText(data) {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  const n = Math.min(b.length, 2048);
  if (!n) return false;
  if ((b[0] === 0xFF && b[1] === 0xFE) || (b[0] === 0xFE && b[1] === 0xFF)) return true;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 13)) bad++;
  }
  return bad / n < 0.01;
}

/** Découpe un texte CSV avec un séparateur donné. */
function split(text, sep) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (c === sep) {
      row.push(cell); cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim()));
}

/** Devine le séparateur : celui qui donne le plus de colonnes, de façon régulière, sur les premières lignes. */
function guessSeparator(text) {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30).join('\n');
  let best = ';';
  let bestScore = -1;
  for (const sep of [';', ',', '\t']) {
    const rows = split(sample, sep).filter((r) => r.length > 1);
    if (!rows.length) continue;
    const widths = rows.map((r) => r.length);
    const max = Math.max(...widths);
    const regular = widths.filter((w) => w === max).length;
    const score = max * 10 + regular;
    if (max > 1 && score > bestScore) { best = sep; bestScore = score; }
  }
  return best;
}

/**
 * Lit un fichier CSV.
 * @param {string} text
 * @returns {string[][]} lignes de cellules
 */
export function parseCsv(text) {
  let t = String(text ?? '').replace(/^﻿/, '');
  let sep = null;
  const m = /^sep=(.)\r?\n/i.exec(t);
  if (m) { sep = m[1]; t = t.slice(m[0].length); }
  sep ??= guessSeparator(t);
  return split(t, sep).filter((r) => r.some((c) => c !== ''));
}
