/**
 * ecran-importer.js — Écran « Importer un relevé » : choisir le fichier, répondre aux questions
 * (à qui est cette carte ?), voir le résumé, importer ; liste des imports avec annulation.
 *
 * Version : 0.25.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-16
 *
 * Historique :
 *   0.4.0  FRE (Fidag)  Première version (fichier « Transactions » UBS).
 *   0.4.1  FRE (Fidag)  Fichiers CSV acceptés.
 *   0.8.0  FRE (Fidag)  Relevés standard camt.053 (fichiers .xml) ; contrôles affichés (soldes vérifiés…).
 *   0.7.0  FRE (Fidag)  BCVs et Swisscard ; « Une autre carte : l'ajouter » puis « À qui est cette carte ? » ;
 *                       opérations « en suspens » indiquées.
 *   0.15.0 FRE (Fidag)  Réimport : « nom du commerçant corrigé » et bouton « Corriger N opérations ».
 *   0.25.0 FRE (Fidag)  Plusieurs fichiers en une fois : questions une à une (« Fichier 2 sur 8 »), résumé par
 *                       fichier, un seul bouton « Importer » ; un fichier illisible n'arrête pas les autres.
 */

import { icon, esc, confirmer } from './ui.js';
import { getDb } from './store.js';
import { formatPeriod, formatDateLong } from '../src/core/format.js';
import { ReglageError, assignBankRef, createCardAccount, listPeople } from '../src/core/reglages.js';
import { readBankFile, prepareImport, commitImport, listImports, undoImport, bankName, dedupeBatch, sumCounts } from '../src/core/import.js';

// Import en cours (gardé tant que l'app est ouverte).
// { items: [{ fileName, parsed?, plan?, error? }], current, question?, newCard?, ready?, records? }
let session = null;

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

function countsTable(c) {
  const line = (label, value, strong = true) => `<div class="count-line"><span>${label}</span>${strong ? `<strong>${value}</strong>` : `<span>${value}</span>`}</div>`;
  return `<div class="counts">
    ${line('Opérations trouvées', c.trouvees)}
    ${line('Classées toutes seules', c.autoClassees)}
    ${line('À trier par vous', c.aTrier)}
    ${line('Déjà importées (ignorées)', c.doublons, false)}
    ${c.corrigees ? line('Déjà importées, nom du commerçant corrigé', c.corrigees) : ''}
    ${c.enSuspens ? line('En suspens chez la banque (viendront au prochain import)', c.enSuspens, false) : ''}
  </div>`;
}

function errorCard(message) {
  return `<section class="card alert" role="alert"><h2>${icon('attention')}Le fichier n’a pas pu être importé</h2><p>${esc(message)}</p></section>`;
}

const ACCEPT = '.xlsx,.csv,.xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/comma-separated-values,application/vnd.ms-excel,text/xml,application/xml';

function chooseFile(error = '') {
  return `${error ? errorCard(error) : ''}
    <section class="card">
      <h2>Choisir le fichier de la banque</h2>
      <p class="note">Le fichier des opérations téléchargé depuis l’e-banking : UBS « Transactions », relevé BCVs, transactions Swisscard, ou relevé de compte standard de n’importe quelle banque.</p>
      <p class="note"><strong>Plusieurs fichiers en une fois :</strong> dans Fichiers, touchez « Sélectionner », touchez chaque fichier, puis « Ouvrir ».</p>
      <label class="btn btn-primary btn-wide btn-file">
        ${icon('importer')}Ouvrir mes fichiers
        <input type="file" accept="${ACCEPT}" multiple data-fichier>
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
function question(q, which = '') {
  const what = q.kind === 'carte' ? `la carte ${esc(q.label)}` : `le compte ${esc(q.label)}`;
  return `${which}<section class="card">
      <h2>Ce fichier contient ${what}</h2>
      <p class="note">${plural(q.count, 'opération', 'opérations')}. ${q.kind === 'carte' ? 'De quelle carte s’agit-il ?' : 'De quel compte s’agit-il ?'}
      L’app s’en souviendra pour les prochains fichiers.</p>
      <div class="picks picks-1">
        ${q.choices.map((a) => `<button type="button" class="pick pick-big" data-compte="${esc(a.id)}">${esc(a.name)}</button>`).join('')}
        ${q.kind === 'carte' ? `<button type="button" class="pick pick-big pick-new" data-nouvelle-carte>${icon('plus')}Une autre carte : l’ajouter</button>` : ''}
      </div>
    </section>
    <button type="button" class="btn btn-secondary btn-wide" data-recommencer>${session?.items?.length > 1 ? 'Annuler' : 'Choisir un autre fichier'}</button>`;
}

/** « Fichier 2 sur 8 : nom » (seulement quand plusieurs fichiers sont importés ensemble). */
function whichFile() {
  if (!session || session.items.length < 2) return '';
  return `<p class="note" role="status"><strong>Fichier ${session.current + 1} sur ${session.items.length}</strong> · ${esc(session.items[session.current].fileName)}</p>`;
}

/** Résumé de plusieurs fichiers avant l'import. */
function batchPreview(items) {
  const plans = items.filter((i) => i.plan).map((i) => i.plan);
  const c = sumCounts(plans.map((p) => p.counts));
  const todo = plans.filter((p) => p.counts.nouvelles || p.counts.corrigees);
  const row = (i) => {
    if (i.error) {
      return `<div class="row row-static"><span class="row-text"><span class="row-title">${esc(i.fileName)}</span>
        <span class="row-sub warn">${icon('attention')}Pas importé : ${esc(i.error)}</span></span></div>`;
    }
    const k = i.plan.counts;
    const what = k.nouvelles ? `${plural(k.nouvelles, 'nouvelle opération', 'nouvelles opérations')}${k.aTrier ? ` · ${k.aTrier} à trier` : ''}`
      : k.corrigees ? plural(k.corrigees, 'opération à corriger', 'opérations à corriger') : 'Rien de nouveau (déjà importé)';
    return `<div class="row row-static"><span class="row-text"><span class="row-title">${esc(cap(bankName(i.plan.format)))} · ${esc(formatPeriod(i.plan.period))}</span>
      <span class="row-sub">${esc(what)}</span><span class="row-sub">${esc(i.fileName)}</span></span></div>`;
  };
  return `<section class="card">
      <div class="card-line"><span class="round-icon ok">${icon('ok')}</span>
        <span class="row-text"><span class="row-title">${plural(items.length, 'fichier lu', 'fichiers lus')}</span>
        <span class="row-sub">${plans.length === items.length ? 'Tous les fichiers ont bien été lus.' : `${items.length - plans.length > 1 ? `${items.length - plans.length} n’ont pas pu être lus` : '1 n’a pas pu être lu'} (voir la liste).`}</span></span></div>
      ${plans.length ? countsTable(c) : ''}
    </section>
    <h2 class="group-title">Les fichiers</h2>
    <section class="card list">${items.map(row).join('')}</section>
    ${todo.length
      ? `<button type="button" class="btn btn-primary btn-wide btn-import" data-importer>${c.nouvelles
          ? `Importer ${plural(c.nouvelles, 'opération', 'opérations')}${todo.length > 1 ? ` de ${todo.length} fichiers` : ''}`
          : `Corriger ${plural(c.corrigees, 'opération', 'opérations')}`}</button>
         <button type="button" class="btn btn-secondary btn-wide" data-recommencer>Annuler</button>`
      : `<p class="flash">Il n’y a rien de nouveau à importer dans ces fichiers.</p>
         <button type="button" class="btn btn-secondary btn-wide" data-recommencer>Choisir d’autres fichiers</button>`}`;
}

/** « À qui est la carte ****2222 ? » (nouvelle carte). */
function whoseCard(q, people, which = '') {
  return `${which}<section class="card">
      <h2>À qui est la carte ${esc(q.label)} ?</h2>
      <p class="note">Cette personne sera proposée d’avance pour trier les achats de cette carte. Vous pourrez changer le nom
      de la carte dans Réglages, « Mes comptes ».</p>
      <div class="picks picks-1">
        ${people.map((p) => `<button type="button" class="pick pick-big" data-titulaire="${esc(p.id)}">${esc(p.name)}</button>`).join('')}
        <button type="button" class="pick pick-big" data-titulaire="">Personne en particulier (carte commune)</button>
      </div>
    </section>
    <button type="button" class="btn btn-secondary btn-wide" data-retour-question>Retour</button>`;
}

function preview(plan) {
  const c = plan.counts;
  const nothing = c.nouvelles === 0 && !c.corrigees;
  return `<section class="card">
      <div class="card-line"><span class="round-icon ok">${icon('ok')}</span>
        <span class="row-text"><span class="row-title">Relevé bien lu</span>
        <span class="row-sub">${esc(bankName(plan.format))} · ${esc(formatPeriod(plan.period))}</span></span></div>
      ${countsTable(c)}
      ${(plan.notes ?? []).map((n) => `<p class="flash">${icon('ok')}${esc(n)}</p>`).join('')}
      ${plan.warnings.length ? `<details class="note"><summary>${plural(plan.warnings.length, 'remarque sur ce fichier', 'remarques sur ce fichier')}</summary>
        <ul>${plan.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
    </section>
    ${nothing
      ? `<p class="flash">${c.enSuspens && !c.trouvees ? 'Toutes les opérations de ce fichier sont encore en suspens chez la banque : elles viendront au prochain import.' : 'Toutes ces opérations sont déjà dans l’app. Il n’y a rien de nouveau à importer.'}</p>
         <button type="button" class="btn btn-secondary btn-wide" data-recommencer>Choisir un autre fichier</button>`
      : `<button type="button" class="btn btn-primary btn-wide btn-import" data-importer>${c.nouvelles
          ? `Importer ${plural(c.nouvelles, 'opération', 'opérations')}${c.corrigees ? ` et corriger ${c.corrigees}` : ''}`
          : `Corriger ${plural(c.corrigees, 'opération', 'opérations')}`}</button>
         <button type="button" class="btn btn-secondary btn-wide" data-recommencer>Annuler</button>`}`;
}

function done(records) {
  const c = sumCounts(records.map((r) => r.counts));
  const sub = records.length === 1 ? formatPeriod(records[0].period) : plural(records.length, 'fichier', 'fichiers');
  return `<section class="card">
      <div class="card-line"><span class="round-icon ok">${icon('ok')}</span>
        <span class="row-text"><span class="row-title">C’est importé</span>
        <span class="row-sub">${esc(sub)}</span></span></div>
      ${countsTable(c)}
      ${c.facturesRattachees ? `<p class="note">${plural(c.facturesRattachees, 'facture de carte a été vérifiée', 'factures de carte ont été vérifiées')} : les achats correspondent au montant prélevé.</p>` : ''}
    </section>
    ${c.aTrier ? `<a class="btn btn-primary btn-wide btn-import" href="#/trier">${c.aTrier > 1 ? `Trier les ${c.aTrier} opérations` : 'Trier l’opération'}</a>` : ''}
    <a class="btn btn-secondary btn-wide" href="#/factures">Voir les factures de carte</a>
    <button type="button" class="btn btn-secondary btn-wide" data-recommencer>Importer d’autres fichiers</button>`;
}

const READ_ERROR = 'Le fichier n’a pas pu être lu. Téléchargez-le à nouveau depuis votre banque, puis réessayez.';
const message = (ex) => (ex instanceof ReglageError ? ex.message : READ_ERROR);

/** Lit tous les fichiers choisis ; un fichier illisible n'empêche pas les autres. */
async function readFiles(db, files) {
  const items = [];
  for (const file of files) {
    try {
      items.push({ fileName: file.name, parsed: await readBankFile(await file.arrayBuffer()) });
    } catch (ex) {
      if (!(ex instanceof ReglageError)) console.error(ex);
      items.push({ fileName: file.name, error: message(ex) });
    }
  }
  // Dans l'ordre des dates (le plus ancien d'abord), les fichiers illisibles à la fin.
  const from = (i) => i.parsed?.period?.from ?? '9999';
  items.sort((a, b) => from(a).localeCompare(from(b)));
  session = { items, current: 0 };
  await plan(db);
}

/**
 * Prépare les fichiers un par un ; s'arrête à la première question (« À qui est la carte … ? »).
 * Les numéros reconnus sans question sont retenus tout de suite, pour que les fichiers suivants en tiennent compte.
 */
async function plan(db) {
  session.question = null;
  for (let i = 0; i < session.items.length; i++) {
    const item = session.items[i];
    if (item.plan || item.error) continue;
    let p;
    try {
      p = await prepareImport(db, item.parsed, { fileName: item.fileName });
    } catch (ex) {
      if (!(ex instanceof ReglageError)) console.error(ex);
      item.error = message(ex);
      continue;
    }
    for (const { ref, accountId } of p.autoAssigned ?? p.newRefs ?? []) await assignBankRef(db, accountId, ref);
    if (p.needsMapping) {
      session.current = i;
      session.question = p.needsMapping[0];
      return;
    }
    item.plan = { ...p, newRefs: [] };
  }
  // Une opération présente dans deux fichiers du lot n'est importée qu'une fois.
  const planned = session.items.filter((i) => i.plan);
  dedupeBatch(planned.map((i) => i.plan)).forEach((p, k) => { planned[k].plan = p; });
  session.ready = true;
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
        await show(chooseFile(message(ex)));
        if (!(ex instanceof ReglageError)) console.error(ex);
      };

      function bind() {
        root.querySelector('[data-fichier]')?.addEventListener('change', async (e) => {
          const files = [...(e.target.files ?? [])];
          if (!files.length) return;
          root.innerHTML = `<section class="card"><p class="note" role="status">${files.length > 1 ? `Lecture des ${files.length} fichiers…` : 'Lecture du fichier…'}</p></section>`;
          try { await readFiles(db, files); await rerender(); } catch (ex) { await fail(ex); }
        });
        root.onclick = async (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          try {
            if (b.dataset.compte && session?.question) {
              await assignBankRef(db, b.dataset.compte, session.question.ref);
              await plan(db);
              await rerender();
            } else if ('nouvelleCarte' in b.dataset && session?.question) {
              session.newCard = true;
              await rerender();
            } else if ('retourQuestion' in b.dataset) {
              session.newCard = false;
              await rerender();
            } else if ('titulaire' in b.dataset && session?.question) {
              await createCardAccount(db, {
                name: `${bankName(session.items[session.current].parsed.format)} ${session.question.label}`,
                ref: session.question.ref,
                importFormat: session.items[session.current].parsed.format,
                personId: b.dataset.titulaire || null,
              });
              session.newCard = false;
              await plan(db);
              await rerender();
            } else if ('importer' in b.dataset && session?.ready) {
              b.disabled = true;
              const todo = session.items.filter((i) => i.plan && (i.plan.counts.nouvelles || i.plan.counts.corrigees));
              const records = [];
              for (const [k, item] of todo.entries()) {
                if (todo.length > 1) b.textContent = `Import du fichier ${k + 1} sur ${todo.length}…`;
                records.push(await commitImport(db, item.plan));
              }
              session.records = records;
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

      if (session?.records) return show(done(session.records));
      if (session?.question && session.newCard) return show(whoseCard(session.question, await listPeople(db), whichFile()));
      if (session?.question) return show(question(session.question, whichFile()));
      if (session?.ready) {
        const { items } = session;
        if (items.length === 1) {
          // Un seul fichier : comme avant.
          if (items[0].error) { const err = items[0].error; session = null; return show(chooseFile(err)); }
          return show(preview(items[0].plan));
        }
        if (items.every((i) => i.error)) { session = null; return show(chooseFile('Aucun de ces fichiers n’a pu être lu. Téléchargez-les à nouveau depuis votre banque, puis réessayez.')); }
        return show(batchPreview(items));
      }
      return show(chooseFile());
    },
  };
}

/** Oublie un import terminé quand on quitte l'écran (le prochain affichage repart du début). */
export function resetImporterIfDone() {
  if (session?.records) session = null;
}
