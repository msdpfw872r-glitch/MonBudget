/**
 * xlsx.js — Lecture minimale de fichiers Excel (.xlsx) sans dépendance externe.
 *
 * Version : 0.1.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Fonctionne dans Safari (iOS/iPadOS 16.4+) et Node 18+ : utilise
 * DecompressionStream('deflate-raw') pour décompresser le zip.
 * Ne lit que les valeurs des cellules (pas de formules ni de styles).
 *
 * Historique :
 *   0.1.0  FRE (Fidag)  Première version : zip, sharedStrings, inlineStr, nombres.
 */

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** Lit la liste des fichiers d'une archive zip. */
function readZipDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Ce fichier n'est pas un fichier Excel valide.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== SIG_CENTRAL) throw new Error('Archive Excel endommagée.');
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { view, entries };
}

async function inflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(bytes, zip, name) {
  const e = zip.entries.get(name);
  if (!e) return null;
  const v = zip.view;
  if (v.getUint32(e.localOffset, true) !== SIG_LOCAL) throw new Error('Archive Excel endommagée.');
  const start = e.localOffset + 30 + v.getUint16(e.localOffset + 26, true) + v.getUint16(e.localOffset + 28, true);
  const raw = bytes.subarray(start, start + e.compSize);
  let out;
  if (e.method === 0) out = raw;
  else if (e.method === 8) out = await inflateRaw(raw);
  else throw new Error('Compression Excel non prise en charge (' + e.method + ').');
  return new TextDecoder('utf-8').decode(out);
}

/** Décode les entités XML. */
export function decodeXml(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, g) => {
    if (g[0] === '#') return String.fromCodePoint(g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[g];
  });
}

/** Concatène le texte de tous les <t> d'un fragment (texte enrichi compris), sans les <rPh>. */
function textOf(fragment) {
  const clean = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += m[1] ? decodeXml(m[1]) : '';
  return out;
}

function attr(tag, name) {
  const m = tag.match(new RegExp('\\s' + name + '="([^"]*)"'));
  return m ? decodeXml(m[1]) : null;
}

function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml, shared) {
  const rows = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const rowTag = rm[1] ?? rm[3];
    const rIdx = attr(rowTag, 'r');
    const rowNum = rIdx ? parseInt(rIdx, 10) - 1 : rows.length;
    const cells = [];
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = cm[1];
      const body = cm[2] || '';
      const ref = attr(tag, 'r');
      const idx = ref ? colIndex(ref) : cells.length;
      const type = attr(tag, 't');
      const vm = body.match(/<v>([\s\S]*?)<\/v>/);
      const v = vm ? decodeXml(vm[1]) : null;
      let value = null;
      if (type === 's') value = v == null ? null : shared[parseInt(v, 10)] ?? null;
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'b') value = v === '1';
      else if (type === 'str' || type === 'e') value = v;
      else if (v != null && v !== '') value = Number(v);
      cells[idx] = value;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
    rows[rowNum] = cells;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/**
 * Lit un classeur .xlsx.
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Promise<{sheets: {name: string, rows: any[][]}[]}>}
 */
export async function readXlsx(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const zip = readZipDirectory(bytes);
  const workbook = await readEntry(bytes, zip, 'xl/workbook.xml');
  if (!workbook) throw new Error("Ce fichier n'est pas un classeur Excel.");
  const rels = (await readEntry(bytes, zip, 'xl/_rels/workbook.xml.rels')) || '';
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1], 'Id');
    const target = attr(m[1], 'Target');
    if (id && target) relMap[id] = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  }
  const ssXml = await readEntry(bytes, zip, 'xl/sharedStrings.xml');
  const shared = ssXml ? [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], 'name');
    const rid = attr(m[1], 'r:id');
    const path = relMap[rid];
    const xml = path ? await readEntry(bytes, zip, path) : null;
    sheets.push({ name, rows: xml ? parseSheet(xml, shared) : [] });
  }
  return { sheets };
}

/** Indique si les octets ressemblent à un zip (donc potentiellement à un .xlsx). */
export function looksLikeZip(data) {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}
