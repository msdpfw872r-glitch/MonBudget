/**
 * xml.js — Petit lecteur XML sans dépendance (Safari et Node), pour les relevés camt.053.
 *
 * Version : 0.8.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Construit un arbre { name, attrs, children, text } où `name` est le nom LOCAL de la balise
 * (le préfixe et l'espace de noms sont ignorés : camt.053.001.04 et .08 se lisent pareil).
 * Gère : déclaration <?xml?>, commentaires, CDATA, attributs "…" ou '…', balises auto-fermantes,
 * entités (&amp; &lt; &#233; &#xE9;…). Pas de DTD.
 *
 * Historique :
 *   0.8.0  FRE (Fidag)  Première version.
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const local = (qname) => qname.slice(qname.indexOf(':') + 1);

/**
 * Lit un texte XML.
 * @returns {{name: string, attrs: Object<string,string>, children: object[], text: string}} élément racine
 */
export function parseXml(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) { top.text += decodeEntities(src.slice(i)); break; }
    if (lt > i) top.text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      top.text += src.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
    } else if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const end = src.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
    } else if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      const name = local(src.slice(lt + 2, end).trim());
      // Ferme jusqu'à la balise correspondante (tolère un fichier légèrement mal formé).
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) { stack.length = k; break; }
      }
      i = end < 0 ? n : end + 1;
    } else {
      // Balise ouvrante : chercher le « > » final en sautant les valeurs entre guillemets.
      let j = lt + 1;
      let quote = null;
      while (j < n) {
        const c = src[j];
        if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break;
        j++;
      }
      let body = src.slice(lt + 1, j);
      const selfClosing = body.endsWith('/');
      if (selfClosing) body = body.slice(0, -1);
      const m = /^\s*([^\s/>]+)/.exec(body);
      const el = { name: local(m ? m[1] : ''), attrs: {}, children: [], text: '' };
      const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a;
      const rest = m ? body.slice(m[0].length) : '';
      while ((a = attrRe.exec(rest))) el.attrs[local(a[1])] = decodeEntities(a[3] ?? a[4] ?? '');
      top.children.push(el);
      if (!selfClosing) stack.push(el);
      i = j + 1;
    }
  }
  return root.children.find((c) => c.name) ?? root;
}

/** Premier enfant direct portant ce nom. */
export const child = (el, name) => el?.children.find((c) => c.name === name) ?? null;
/** Enfants directs portant ce nom. */
export const childrenOf = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);

/** Suit un chemin « A/B/C » d'enfants directs. */
export function path(el, p) {
  let cur = el;
  for (const part of p.split('/')) {
    cur = child(cur, part);
    if (!cur) return null;
  }
  return cur;
}

/** Premier descendant (à n'importe quelle profondeur) portant ce nom. */
export function deep(el, name) {
  if (!el) return null;
  for (const c of el.children) {
    if (c.name === name) return c;
    const d = deep(c, name);
    if (d) return d;
  }
  return null;
}

/** Tous les descendants portant ce nom. */
export function deepAll(el, name, out = []) {
  if (!el) return out;
  for (const c of el.children) {
    if (c.name === name) out.push(c);
    deepAll(c, name, out);
  }
  return out;
}

/** Texte d'un élément (espaces nettoyés), ou '' s'il est absent. */
export const txt = (el) => (el ? el.text.replace(/\s+/g, ' ').trim() : '');
