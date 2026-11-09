/**
 * ecran-supprimer.js — Réglages › Supprimer des données (choisir, vérifier, taper SUPPRIMER, valider),
 * Réglages › Imports (supprimer un import), Réglages › Copies de sécurité (en ligne et fichier).
 *
 * Version : 0.12.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Adresses : #/reglages/supprimer, #/reglages/supprimer/<groupe>, #/reglages/supprimer/verifier,
 *            #/reglages/imports, #/reglages/copie. Maquette : docs/maquette/supprimer-donnees.html.
 *
 * Historique :
 *   0.11.0 FRE (Fidag)  Première version.
 *   0.12.0 FRE (Fidag)  Copies de sécurité en ligne (10, commentaire, remettre, supprimer), copie automatique avant
 *                       une suppression ; toutes les catégories supprimables ; « Remettre les catégories d'exemple ».
 */

import { icon, esc, confirmer } from './ui.js';
import { getDb } from './store.js';
import * as session from './session.js';
import * as D from '../src/core/suppression.js';
import { formatMonth } from '../src/core/format.js';
import { saveNow, showSaveResult, whenText, setPendingRestore } from './ecran-sauvegarde.js';
import { MAX_COPIES as D_MAX } from '../src/core/copies.js';
import { restoreSampleCategories } from '../src/core/reglages.js';

let selection = {};   // { groupe: 'all' | [ids] }
let done = null;      // résultat de la dernière suppression
let autoCopied = false; // une copie en ligne a été faite juste avant
let seedCache = null;
const seed = async () => (seedCache ??= await (await fetch('./src/data/seed.json')).json());
const opts = async () => ({ seed: await seed() });
const go = (h) => { location.hash = h; };

/** État d'un groupe : 'none' | 'all' | 'some', et le nombre choisi. */
function stateOf(groupId, total) {
  const s = selection[groupId];
  if (!s || (Array.isArray(s) && !s.length) || !total) return { st: 'none', n: 0 };
  if (s === 'all' || s.length >= total) return { st: 'all', n: total };
  return { st: 'some', n: s.length };
}

const boxSvg = (st) => (st === 'all' ? icon('ok') : st === 'some' ? '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 12h12"/></svg>' : '');
const ariaChecked = (st) => (st === 'all' ? 'true' : st === 'some' ? 'mixed' : 'false');
const fmtN = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '’');

/* ---------- 1. Choisir ---------- */

function chooseView() {
  return {
    title: 'Supprimer des données',
    parent: '#/reglages',
    async render(root) {
      const db = await getDb();
      const o = await opts();
      if (done) return doneView(root);
      const totals = {};
      for (const g of D.GROUPS) totals[g.id] = (await D.listGroup(db, g.id, o)).length;
      const chosen = D.GROUPS.filter((g) => stateOf(g.id, totals[g.id]).st !== 'none').length;
      root.innerHTML = `<p class="steps"><strong>1. Choisir</strong> › 2. Vérifier › 3. Confirmer</p>
        <p class="note">Pour chaque genre de données : rien, tout, ou seulement certains éléments.</p>
        ${D.GROUPS.map((g) => {
          const { st, n } = stateOf(g.id, totals[g.id]);
          const pill = st === 'none' ? 'Rien' : st === 'all' ? `Tout · ${fmtN(n)}` : `${fmtN(n)} sur ${fmtN(totals[g.id])}`;
          return `<section class="del-group${st !== 'none' ? ' on' : ''}">
            <button type="button" class="tbox ${st}" role="checkbox" aria-checked="${ariaChecked(st)}" data-toggle="${g.id}"
              aria-label="${esc(g.title)} : ${esc(pill)}"${totals[g.id] ? '' : ' disabled'}>${boxSvg(st)}</button>
            <span class="row-text"><span class="row-title">${esc(g.title)}</span><span class="row-sub">${esc(g.help)}</span></span>
            <span class="del-pill ${st}">${totals[g.id] ? esc(pill) : 'Aucun'}</span>
            ${totals[g.id] ? `<a class="btn btn-secondary btn-small" href="#/reglages/supprimer/${g.id}">Choisir</a>` : ''}
          </section>`;
        }).join('')}
        <button type="button" class="btn btn-danger btn-wide btn-big" data-next${chosen ? '' : ' disabled'}>
          ${chosen ? `Continuer : vérifier (${chosen} choix)` : 'Choisissez d’abord quoi supprimer'}</button>`;
      root.onclick = (e) => {
        const t = e.target.closest('[data-toggle]');
        if (t) {
          const id = t.dataset.toggle;
          selection[id] = stateOf(id, totals[id]).st === 'all' ? null : 'all';
          this.render(root);
        } else if (e.target.closest('[data-next]')) go('#/reglages/supprimer/verifier');
      };
    },
  };
}

/* ---------- Choisir parmi les éléments d'un groupe ---------- */

function pickView(groupId) {
  const g = D.groupById(groupId);
  return {
    title: g.title,
    parent: '#/reglages/supprimer',
    async render(root) {
      const db = await getDb();
      const items = await D.listGroup(db, groupId, await opts());
      const cur = selection[groupId];
      const picked = new Set(cur === 'all' ? items.map((i) => i.id) : cur ?? []);
      const byMonth = groupId === 'operations' || groupId === 'tri';
      let html = '';
      let lastMonth = null;
      for (const it of items) {
        if (byMonth && it.month !== lastMonth) {
          if (lastMonth !== null) html += '</section>';
          lastMonth = it.month;
          html += `<section class="card list del-month" data-month="${it.month}">
            <label class="del-item del-month-head"><input type="checkbox" data-month-box="${it.month}">
            <span class="row-title">${esc(formatMonth(`${it.month}-01`))}</span></label>`;
        }
        html += `<label class="del-item" data-search="${esc(`${it.label} ${it.sub}`.toLowerCase())}">
          <input type="checkbox" value="${esc(it.id)}"${picked.has(it.id) ? ' checked' : ''}${byMonth ? ` data-in-month="${it.month}"` : ''}>
          <span class="row-text"><span class="row-title">${esc(it.label)}</span><span class="row-sub">${esc(it.sub)}</span></span></label>`;
      }
      if (byMonth && lastMonth !== null) html += '</section>';
      root.innerHTML = `<div class="del-quick">
          <button type="button" class="btn btn-secondary" data-all>Tout cocher</button>
          <button type="button" class="btn btn-secondary" data-none>Tout décocher</button></div>
        <label class="search">${icon('loupe')}<input type="search" placeholder="Chercher" aria-label="Chercher" data-search-input></label>
        ${byMonth ? html : `<section class="card list">${html}</section>`}
        <div class="del-bar"><button type="button" class="btn btn-primary btn-wide" data-keep></button></div>`;
      const boxes = () => [...root.querySelectorAll('input[type=checkbox][value]')];
      const refresh = () => {
        const n = boxes().filter((b) => b.checked).length;
        root.querySelector('[data-keep]').textContent = `Garder ce choix (${fmtN(n)} sur ${fmtN(items.length)})`;
        for (const mb of root.querySelectorAll('[data-month-box]')) {
          const inMonth = boxes().filter((b) => b.dataset.inMonth === mb.dataset.monthBox);
          const c = inMonth.filter((b) => b.checked).length;
          mb.checked = c === inMonth.length && c > 0;
          mb.indeterminate = c > 0 && c < inMonth.length;
        }
      };
      refresh();
      root.onchange = (e) => {
        const mb = e.target.closest('[data-month-box]');
        if (mb) for (const b of boxes()) if (b.dataset.inMonth === mb.dataset.monthBox) b.checked = mb.checked;
        refresh();
      };
      root.querySelector('[data-search-input]').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        for (const el of root.querySelectorAll('[data-search]')) el.hidden = Boolean(q) && !el.dataset.search.includes(q);
      });
      root.onclick = (e) => {
        const visible = boxes().filter((b) => !b.closest('[data-search]').hidden);
        if (e.target.closest('[data-all]')) { for (const b of visible) b.checked = true; refresh(); }
        else if (e.target.closest('[data-none]')) { for (const b of visible) b.checked = false; refresh(); }
        else if (e.target.closest('[data-keep]')) {
          const ids = boxes().filter((b) => b.checked).map((b) => b.value);
          selection[groupId] = ids.length === items.length && ids.length ? 'all' : ids;
          go('#/reglages/supprimer');
        }
      };
    },
  };
}

/* ---------- 2–3. Vérifier et confirmer ---------- */

function verifyView() {
  return {
    title: 'Vérifier',
    parent: '#/reglages/supprimer',
    async render(root) {
      const db = await getDb();
      const o = await opts();
      const plan = await D.planDeletion(db, selection, o);
      if (!plan.lines.length) { go('#/reglages/supprimer'); return; }
      root.innerHTML = `<p class="steps">1. Choisir › <strong>2. Vérifier › 3. Confirmer</strong></p>
        <section class="danger-zone" aria-labelledby="del-titre">
          <div class="danger-head">${icon('attention')}<h2 id="del-titre">Ceci sera supprimé</h2></div>
          <ul class="del-list">${plan.lines.map((l) => `<li>${esc(l.text)}</li>`).join('')}</ul>
          <p><strong>Aussi sur vos autres appareils.</strong> Cela ne peut pas être annulé.</p>
          <label class="field"><span>Pour confirmer, tapez SUPPRIMER</span>
            <input type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" data-mot class="del-word"></label>
          <p class="form-error" role="alert" tabindex="-1" hidden></p>
          <button type="button" class="btn btn-danger btn-wide btn-big" data-valider disabled>${icon('corbeille')}Valider la suppression</button>
          <button type="button" class="btn btn-secondary btn-wide" data-annuler>Annuler, ne rien supprimer</button>
        </section>`;
      const btn = root.querySelector('[data-valider]');
      root.querySelector('[data-mot]').addEventListener('input', (e) => {
        btn.disabled = e.target.value.trim().toUpperCase() !== 'SUPPRIMER';
      });
      root.onclick = async (e) => {
        if (e.target.closest('[data-annuler]')) { selection = {}; go('#/reglages'); return; }
        if (!e.target.closest('[data-valider]') || btn.disabled) return;
        const ok = await confirmer({ titre: 'Supprimer maintenant ?', message: plan.lines.map((l) => l.text).join(' · '), ok: 'Oui, supprimer', non: 'Non', danger: true });
        if (!ok) return;
        // Copie en ligne automatique avant de supprimer (pour pouvoir revenir en arrière).
        btn.disabled = true;
        btn.textContent = 'Copie de sécurité…';
        autoCopied = false;
        try {
          await session.makeCloudCopy('Automatique : avant une suppression');
          autoCopied = true;
        } catch {
          const goOn = await confirmer({ titre: 'Pas de copie de sécurité', message: 'La copie automatique n’a pas pu être faite (pas d’Internet ?). Supprimer quand même, sans pouvoir revenir en arrière ?', ok: 'Supprimer quand même', non: 'Annuler', danger: true });
          if (!goOn) { btn.disabled = false; btn.innerHTML = `${icon('corbeille')}Valider la suppression`; return; }
        }
        try {
          btn.disabled = true;
          btn.textContent = 'Suppression…';
          done = await D.applyDeletion(db, selection, o);
          selection = {};
          document.dispatchEvent(new CustomEvent('donnees-modifiees'));
          session.scheduleSync(0);
          go('#/reglages/supprimer');
        } catch {
          const err = root.querySelector('.form-error');
          err.textContent = 'La suppression n’a pas pu se terminer. Vérifiez ce qui reste, puis réessayez.';
          err.hidden = false;
          err.focus();
        }
      };
    },
  };
}

function doneView(root) {
  const labels = [['imports', 'Imports supprimés'], ['operations', 'Opérations supprimées'], ['tri', 'Opérations remises à trier'],
    ['regles', 'Règles supprimées'], ['rattachements', 'Factures détachées de leurs achats'], ['numeros', 'Numéros oubliés'],
    ['categories', 'Catégories supprimées'], ['personnes', 'Personnes supprimées']];
  root.innerHTML = `<section class="card del-done">
      <span class="round-icon ok">${icon('ok')}</span>
      <h2>C’est supprimé</h2>
      <div class="counts">${labels.filter(([k]) => done[k]).map(([k, t]) => `<div class="count-line"><span>${t}</span><strong>${fmtN(done[k])}</strong></div>`).join('')}</div>
      <p class="note">Vos autres appareils seront mis à jour à la prochaine synchronisation.
      ${autoCopied ? 'Une copie en ligne des données d’avant a été faite (Réglages › Copies de sécurité).' : ''}</p>
    </section>
    ${done.categories ? `<button type="button" class="btn btn-secondary btn-wide" data-exemple>Remettre les catégories d’exemple</button>
      <p class="flash" data-exemple-ok role="status" hidden></p>` : ''}
    <a class="btn btn-primary btn-wide" href="#/reglages" data-fini>Retour aux Réglages</a>`;
  root.onclick = async (e) => {
    if (e.target.closest('[data-fini]')) done = null;
    const ex = e.target.closest('[data-exemple]');
    if (ex) {
      ex.disabled = true;
      const n = await restoreSampleCategories(await getDb(), await seed());
      const ok = root.querySelector('[data-exemple-ok]');
      ok.textContent = n ? `${n} catégories d’exemple remises.` : 'Les catégories d’exemple sont déjà là.';
      ok.hidden = false;
      document.dispatchEvent(new CustomEvent('donnees-modifiees'));
    }
  };
}

export function supprimerView(sub) {
  if (sub === 'verifier') return verifyView();
  if (sub && D.groupById(sub)) return pickView(sub);
  return chooseView();
}

/* ---------- Réglages › Imports ---------- */

export function importsView() {
  return {
    title: 'Imports',
    parent: '#/reglages',
    async render(root) {
      const db = await getDb();
      const items = await D.listGroup(db, 'imports', await opts());
      root.innerHTML = items.length
        ? `<p class="note">Les fichiers de banque importés, du plus récent au plus ancien.</p>
           <section class="card list">${items.map((i) => `<div class="row row-static">
             <span class="row-text"><span class="row-title">${esc(i.label)}</span><span class="row-sub">${esc(i.sub)}</span></span>
             <button type="button" class="btn btn-secondary btn-small" data-del="${esc(i.id)}">${icon('corbeille')}Supprimer</button></div>`).join('')}</section>
           <a class="btn btn-secondary btn-wide" href="#/reglages/supprimer/imports">Supprimer plusieurs imports</a>`
        : '<section class="card"><p class="note">Aucun fichier importé pour l’instant.</p></section>';
      root.onclick = (e) => {
        const b = e.target.closest('[data-del]');
        if (!b) return;
        selection = { imports: [b.dataset.del] };
        go('#/reglages/supprimer/verifier');
      };
    },
  };
}

/* ---------- Réglages › Copie de sécurité ---------- */

export async function copieRow() {
  return `<a class="row" href="#/reglages/copie"><span class="row-text"><span class="row-title">Copies de sécurité</span>
    <span class="row-sub">En ligne (10 dernières) ou dans un fichier : revenir en arrière</span></span>${icon('suite')}</a>`;
}

const fmtCounts = (c) => (c ? `${fmtN(c.transactions)} opérations, ${fmtN(c.rules)} règles, ${fmtN(c.categories)} catégories` : '');

export function copieView() {
  return {
    title: 'Copies de sécurité',
    parent: '#/reglages',
    async render(root) {
      const rerender = () => { if (root.isConnected) this.render(root); };
      root.innerHTML = '<p class="note">Un instant…</p>';
      let copies = null;
      let loadError = '';
      try { copies = await session.cloudCopies(); } catch (e) { loadError = session.messageOf(e); }
      root.innerHTML = `<section class="card card-accent form">
          <h2>Copies en ligne</h2>
          <p class="note">Une photo de toutes vos données, chiffrée, gardée dans votre espace en ligne. Les ${D_MAX} dernières sont gardées :
          la plus ancienne part quand une nouvelle arrive. Elle sert à <strong>revenir en arrière</strong>, par exemple après une suppression par erreur.</p>
          <label class="field"><span>Commentaire (facultatif)</span>
            <input type="text" maxlength="200" placeholder="Par exemple : avant le tri de novembre" data-comment></label>
          <p class="flash" data-copie-ok role="status" hidden></p>
          <p class="form-error" role="alert" tabindex="-1" hidden></p>
          <button type="button" class="btn btn-primary btn-wide" data-copie>${icon('sauvegarde')}Faire une copie maintenant</button>
        </section>
        ${loadError ? `<p class="warn-box">${icon('attention')}<span>${esc(loadError)}</span></p>`
          : copies.length ? `<section class="card list">${copies.map((c, i) => `<div class="row row-static copie-row">
              <span class="row-text"><span class="row-title">${esc(whenText(new Date(c.createdAt).toISOString()))}</span>
                <span class="row-sub">${c.readable ? (c.comment ? `« ${esc(c.comment)} »` : 'Sans commentaire') : 'Illisible avec la clé actuelle'}</span>
                ${c.readable ? `<span class="row-sub">${esc(fmtCounts(c.counts))}${c.device ? ` · ${esc(c.device)}` : ''}</span>` : ''}</span>
              <span class="copie-actions">
                ${c.readable ? `<button type="button" class="btn btn-secondary btn-small" data-remettre="${i}">Remettre cette copie</button>` : ''}
                <button type="button" class="btn btn-secondary btn-small" data-supprimer-copie="${i}">${icon('corbeille')}Supprimer</button>
              </span></div>`).join('')}</section>`
          : '<section class="card"><p class="note">Aucune copie en ligne pour l’instant.</p></section>'}
        <section class="card">
          <h2>Copie dans un fichier</h2>
          <p class="note">Pour garder une copie ailleurs (iCloud Drive…).</p>
          <p class="flash" data-message-sauvegarde role="status" hidden></p>
          <button type="button" class="btn btn-secondary btn-wide" data-sauvegarder>${icon('sauvegarde')}Enregistrer une copie dans un fichier</button>
          <a class="btn btn-secondary btn-wide" href="#/reglages/restaurer">Remettre une copie depuis un fichier</a>
          <a class="row" href="#/reglages/raccourci"><span class="row-text"><span class="row-title">Avec l’app Raccourcis</span>
            <span class="row-sub">Enregistrer le fichier dans votre dossier</span></span>${icon('suite')}</a>
        </section>`;
      const err = (e) => {
        const box = root.querySelector('.form-error');
        box.textContent = session.messageOf(e);
        box.hidden = false;
        box.focus();
      };
      root.onclick = async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if ('copie' in b.dataset) {
          b.disabled = true;
          b.textContent = 'Copie en cours…';
          try {
            const c = await session.makeCloudCopy(root.querySelector('[data-comment]').value);
            await this.render(root);
            const ok = root.querySelector('[data-copie-ok]');
            ok.textContent = `Copie faite : ${fmtCounts(c.counts)}.${c.removed.length ? ' La plus ancienne a été supprimée.' : ''}`;
            ok.hidden = false;
          } catch (ex) { b.disabled = false; b.innerHTML = `${icon('sauvegarde')}Faire une copie maintenant`; err(ex); }
        } else if ('remettre' in b.dataset) {
          const c = copies[Number(b.dataset.remettre)];
          b.disabled = true;
          b.textContent = 'Lecture…';
          try {
            setPendingRestore(await session.readCloudCopy(c), `Copie du ${whenText(new Date(c.createdAt).toISOString())}`);
            go('#/reglages/restaurer');
          } catch (ex) { b.disabled = false; b.textContent = 'Remettre cette copie'; err(ex); }
        } else if ('supprimerCopie' in b.dataset) {
          const c = copies[Number(b.dataset.supprimerCopie)];
          const ok = await confirmer({ titre: 'Supprimer cette copie ?', message: `Copie du ${whenText(new Date(c.createdAt).toISOString())}${c.comment ? ` (« ${c.comment} »)` : ''}. Vos données actuelles ne changent pas.`, ok: 'Supprimer la copie', non: 'Annuler', danger: true });
          if (!ok) return;
          try { await session.deleteCloudCopy(c); rerender(); } catch (ex) { err(ex); }
        } else if ('sauvegarder' in b.dataset) {
          b.disabled = true;
          const r = await saveNow();
          b.disabled = false;
          showSaveResult(root.querySelector('[data-message-sauvegarde]'), r);
        }
      };
    },
  };
}
