/**
 * ecran-importer.js — Écran « Importer un relevé » : choisir le fichier, répondre aux questions
 * (à qui est cette carte ?), voir le résumé, importer ; liste des imports avec annulation.
 *
 * Version : 0.4.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Historique :
 *   0.4.0  FRE (Fidag)  Première version (fichier « Transactions » UBS).
 */

import { icon, esc, confirmer } from './ui.js';
import { getDb } from './store.js';
import { formatPeriod, formatDateLong } from '../src/core/format.js';
import { ReglageError, assignBankRef } from '../src/core/reglages.js';
import { readBankFile, prepareImport, commitImport, listImports, undoImport, bankName } from '../src/core/import.js';

// Import en cours (gardé tant que l'app est ouverte).
let session = null; // { parsed, fileName, plan?, record?, question? }

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

function countsTable(c) {
  const line = (label, value, strong = true) => `<div class="count-line"><span>${label}</span>${strong ? `<strong>${value}</strong>` : `<span>${value}</span>`}</div>`;
  return `<div class="counts">
    ${line('Opérations trouvées', c.trouvees)}
    ${line('Classées toutes seules', c.autoClassees)}
    ${line('À trier par vous', c.aTrier)}
    ${line('Déjà importées (ignorées)', c.doublons, false)}
  </div>`;
}

function errorCard(message) {
  return `<section class="card alert" role="alert"><h2>${icon('attention')}Le fichier n’a pas pu être importé</h2><p>${esc(message)}</p></section>`;
}

const ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function chooseFile(error = '') {
  return `${error ? errorCard(error) : ''}
    <section class="card">
      <h2>Choisir le fichier de la banque</h2>
      <p class="note">Le fichier des opérations téléchargé depuis l’e-banking. Pour UBS : « Transactions », en Excel.</p>
      <label class="btn btn-primary btn-wide btn-file">
        ${icon('importer')}Ouvrir mes fichiers
        <input type="file" accept="${ACCEPT}" data-fichier>
      </label>
    </section>`;
}

async function history(db) {
  const imports = (await listImports(db)).slice(0, 6);
  if (!imports.length) return '';
  const accounts = new Map((await db.getAll('accounts')).map((a) => [a.id, a.name]));
  return `<h2 class="group-title">Derniers imports</h2>
    <section class="card list">
      ${imports.map((i) => `<div class="row row-static">
        <span class="row-text"><span class="row-title">${esc((i.accountIds ?? [i.accountId]).map((id) => accounts.get(id) ?? '').filter(Boolean).join(', ') || bankName(i.format))}</span>
          <span class="row-sub">Importé le ${esc(formatDateLong(i.date))} · ${esc(formatPeriod(i.period))} · ${plural(i.counts.nouvelles, 'opération', 'opérations')}</span></span>
        <button type="button" class="btn btn-danger-outline btn-small" data-annuler-import="${esc(i.id)}">Annuler cet import</button>
      </div>`).join('')}
    </section>`;
}

/** Une question à la fois : « À qui est la carte ****1111 ? ». */
function question(q) {
  const what = q.kind === 'carte' ? `la carte ${esc(q.label)}` : `le compte ${esc(q.label)}`;
  return `<section class="card">
      <h2>Ce fichier contient ${what}</h2>
      <p class="note">${plural(q.count, 'opération', 'opérations')}. ${q.kind === 'carte' ? 'De quelle carte s’agit-il ?' : 'De quel compte s’agit-il ?'}
      L’app s’en souviendra pour les prochains fichiers.</p>
      <div class="picks picks-1">
        ${q.choices.map((a) => `<button type="button" class="pick pick-big" data-compte="${esc(a.id)}">${esc(a.name)}</button>`).join('')}
      </div>
    </section>
    <button type="button" class="btn btn-secondary btn-wide" data-recommencer>Choisir un autre fichier</button>`;
}

function preview(plan) {
  const c = plan.counts;
  const nothing = c.nouvelles === 0;
  return `<section class="card">
      <div class="card-line"><span class="round-icon ok">${icon('ok')}</span>
        <span class="row-text"><span class="row-title">Relevé bien lu</span>
        <span class="row-sub">${esc(bankName(plan.format))} · ${esc(formatPeriod(plan.period))}</span></span></div>
      ${countsTable(c)}
      ${plan.warnings.length ? `<details class="note"><summary>${plural(plan.warnings.length, 'ligne n’a pas pu être lue', 'lignes n’ont pas pu être lues')}</summary>
        <ul>${plan.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
    </section>
    ${nothing
      ? `<p class="flash">Toutes ces opérations sont déjà dans l’app. Il n’y a rien de nouveau à importer.</p>
         <button type="button" class="btn btn-secondary btn-wide" data-recommencer>Choisir un autre fichier</button>`
      : `<button type="button" class="btn btn-primary btn-wide btn-import" data-importer>Importer ${plural(c.nouvelles, 'opération', 'opérations')}</button>
         <button type="button" class="btn btn-secondary btn-wide" data-recommencer>Annuler</button>`}`;
}

function done(record) {
  const c = record.counts;
  return `<section class="card">
      <div class="card-line"><span class="round-icon ok">${icon('ok')}</span>
        <span class="row-text"><span class="row-title">C’est importé</span>
        <span class="row-sub">${esc(formatPeriod(record.period))}</span></span></div>
      ${countsTable(c)}
      ${c.facturesRattachees ? `<p class="note">${plural(c.facturesRattachees, 'facture de carte a été vérifiée', 'factures de carte ont été vérifiées')} : les achats correspondent au montant prélevé.</p>` : ''}
    </section>
    ${c.aTrier ? `<a class="btn btn-primary btn-wide btn-import" href="#/trier">${c.aTrier > 1 ? `Trier les ${c.aTrier} opérations` : 'Trier l’opération'}</a>` : ''}
    <a class="btn btn-secondary btn-wide" href="#/factures">Voir les factures de carte</a>
    <button type="button" class="btn btn-secondary btn-wide" data-recommencer>Importer un autre fichier</button>`;
}

async function readFile(db, file) {
  const parsed = await readBankFile(await file.arrayBuffer());
  session = { parsed, fileName: file.name };
  await plan(db);
}

async function plan(db) {
  const p = await prepareImport(db, session.parsed, { fileName: session.fileName });
  if (p.needsMapping) {
    session.question = p.needsMapping[0];
    session.plan = null;
  } else {
    session.question = null;
    session.plan = p;
  }
}

/** Écran « Importer un relevé ». */
export function importerView() {
  return {
    title: 'Importer un relevé',
    parent: null,
    async render(root) {
      const db = await getDb();
      const rerender = () => this.render(root);
      const show = async (body) => { root.innerHTML = body + (session ? '' : await history(db)); bind(); };

      const fail = async (ex) => {
        session = null;
        await show(chooseFile(ex instanceof ReglageError ? ex.message : 'Le fichier n’a pas pu être lu. Téléchargez-le à nouveau depuis votre banque, puis réessayez.'));
        if (!(ex instanceof ReglageError)) console.error(ex);
      };

      function bind() {
        root.querySelector('[data-fichier]')?.addEventListener('change', async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          root.innerHTML = '<section class="card"><p class="note" role="status">Lecture du fichier…</p></section>';
          try { await readFile(db, file); await rerender(); } catch (ex) { await fail(ex); }
        });
        root.onclick = async (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          try {
            if (b.dataset.compte && session?.question) {
              await assignBankRef(db, b.dataset.compte, session.question.ref);
              await plan(db);
              await rerender();
            } else if ('importer' in b.dataset && session?.plan) {
              b.disabled = true;
              session.record = await commitImport(db, session.plan);
              session.plan = null;
              document.dispatchEvent(new CustomEvent('donnees-modifiees'));
              await rerender();
            } else if ('recommencer' in b.dataset) {
              session = null;
              await rerender();
            } else if (b.dataset.annulerImport) {
              const ok = await confirmer({ titre: 'Annuler cet import ?', message: 'Les opérations de ce fichier seront retirées de l’app. Vous pourrez l’importer à nouveau.', ok: 'Annuler l’import', danger: true });
              if (!ok) return;
              await undoImport(db, b.dataset.annulerImport);
              document.dispatchEvent(new CustomEvent('donnees-modifiees'));
              await rerender();
            }
          } catch (ex) { await fail(ex); }
        };
      }

      if (session?.record) return show(done(session.record));
      if (session?.question) return show(question(session.question));
      if (session?.plan) return show(preview(session.plan));
      return show(chooseFile());
    },
  };
}

/** Oublie un import terminé quand on quitte l'écran (le prochain affichage repart du début). */
export function resetImporterIfDone() {
  if (session?.record) session = null;
}
