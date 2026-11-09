/**
 * ecran-sauvegarde.js — Sauvegarder, restaurer (avec confirmation bien visible), rappel sur l'accueil,
 * guide pas à pas pour l'app Raccourcis.
 *
 * Version : 0.11.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Adresses : #/reglages/restaurer, #/reglages/raccourci (affichées dans la fenêtre Réglages).
 *
 * Historique :
 *   0.6.0  FRE (Fidag)  Première version.
 *   0.6.1  FRE (Fidag)  Après le menu Partager, demander « Le fichier a-t-il bien été enregistré ? »
 *                       (un raccourci répond comme une annulation).
 *   0.9.0  FRE (Fidag)  Restauration : avertit que les données remplaceront aussi celles du cloud (synchro).
 *   0.9.1  FRE (Fidag)  Textes « appareil » au lieu de « iPad » (iPhone aussi).
 *   0.10.2 FRE (Fidag)  Restauration : la synchronisation est toujours active (session.js).
 *   0.11.0 FRE (Fidag)  Restaurer et Raccourcis rangés sous Réglages › Copie de sécurité.
 */

import { icon, esc, confirmer } from './ui.js';
import { getDb } from './store.js';
import { APP_VERSION } from './version.js';
import { shareOrDownload } from './partage.js';
import { formatDateLong } from '../src/core/format.js';
import { ReglageError, upgradeSeed } from '../src/core/reglages.js';
import * as session from './session.js';
import { createBackup, markBackupDone, readBackup, restoreBackup, backupReminder, countsOf } from '../src/core/sauvegarde.js';

const fmtN = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '’');

/** « lundi 9 novembre 2026 à 14 h 03 ». */
export function whenText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${formatDateLong(d)} ${d.getFullYear()} à ${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
}

/** « 1’204 opérations, 87 règles, 3 personnes, 5 comptes, 40 catégories ». */
export function countsText(c) {
  const p = (n, one, many) => `${fmtN(n)} ${n > 1 ? many : one}`;
  return [p(c.transactions, 'opération', 'opérations'), p(c.rules, 'règle', 'règles'), p(c.people, 'personne', 'personnes'),
    p(c.accounts, 'compte', 'comptes'), p(c.categories, 'catégorie', 'catégories')].join(', ');
}

/**
 * « Sauvegarder maintenant » : crée le fichier et ouvre le menu Partager (sinon le télécharge).
 * Si l'iPad ne dit pas si le fichier a été enregistré (raccourci ou menu fermé), on le demande.
 * @returns {Promise<{status: 'shared'|'unsure'|'downloaded', fileName: string, at: string}>}
 */
export async function saveNow() {
  const db = await getDb();
  const now = new Date();
  const { text, fileName } = await createBackup(db, { now, appVersion: APP_VERSION });
  const status = await shareOrDownload(text, fileName, 'application/json');
  if (status !== 'unsure') await markBackupDone(db, now);
  return { status, fileName, at: now.toISOString() };
}

/**
 * Affiche le résultat dans la zone [data-message-sauvegarde] ; si c'est incertain, pose la question
 * « Le fichier a-t-il bien été enregistré ? » (Oui → la sauvegarde est notée).
 * @param {HTMLElement} box
 * @param {() => void} [after]  à appeler après la réponse (pour redessiner)
 */
export function showSaveResult(box, r, after) {
  if (!box) return;
  box.hidden = false;
  if (r.status !== 'unsure') {
    box.className = 'flash';
    box.textContent = `Sauvegarde faite : ${r.fileName}`;
    return;
  }
  box.className = 'save-question';
  box.innerHTML = `<span>Le fichier <strong>${esc(r.fileName)}</strong> a-t-il bien été enregistré ?</span>
    <span class="save-question-buttons">
      <button type="button" class="btn btn-primary" data-enregistre="oui">Oui, c’est enregistré</button>
      <button type="button" class="btn btn-secondary" data-enregistre="non">Non</button>
    </span>`;
  box.onclick = async (e) => {
    const b = e.target.closest('[data-enregistre]');
    if (!b) return;
    e.stopPropagation();
    box.onclick = null;
    if (b.dataset.enregistre === 'oui') {
      await markBackupDone(await getDb(), new Date(r.at));
      if (after) { await after(); return; }
      box.className = 'flash';
      box.textContent = `Sauvegarde faite : ${r.fileName}`;
    } else {
      box.className = 'flash';
      box.textContent = 'Rien n’a été enregistré. Vous pouvez réessayer avec « Sauvegarder maintenant ».';
    }
  };
}

/** Bandeau de rappel pour l'accueil (vide si rien à rappeler). */
export async function reminderBanner(db) {
  const [settings, n] = await Promise.all([db.get('settings', 'app'), db.count('transactions')]);
  const r = backupReminder(settings, { hasData: n > 0 });
  if (!r.due) return '';
  const why = {
    jamais: 'Vos données n’ont encore jamais été sauvegardées.',
    ancienne: `Dernière sauvegarde il y a ${r.days} jours.`,
    import: 'Vous avez importé des opérations depuis la dernière sauvegarde.',
  }[r.reason];
  return `<div class="warn-box warn-action backup-banner" role="status">${icon('sauvegarde')}
      <span><strong>Pensez à sauvegarder.</strong> ${why}</span>
      <button type="button" class="btn btn-primary" data-sauvegarder>${icon('sauvegarde')}Sauvegarder maintenant</button>
    </div>`;
}

/* ---------- Réglages : carte « Sauvegarde » ---------- */

export async function backupCard(db) {
  const s = await db.get('settings', 'app');
  return `<section class="card card-accent">
      <div class="card-line">
        <span class="round-icon">${icon('sauvegarde')}</span>
        <span class="row-text"><span class="row-title">Sauvegarde</span>
          <span class="row-sub">${s?.lastBackupAt ? `Dernière : ${esc(whenText(s.lastBackupAt))}` : 'Jamais sauvegardé'}</span></span>
      </div>
      <p class="flash" data-message-sauvegarde role="status" hidden></p>
      <button type="button" class="btn btn-primary btn-wide" data-sauvegarder>${icon('sauvegarde')}Sauvegarder maintenant</button>
      <a class="btn btn-secondary btn-wide" href="#/reglages/restaurer">Restaurer une sauvegarde</a>
      <a class="row" href="#/reglages/raccourci"><span class="row-text"><span class="row-title">Sauvegarder avec l’app Raccourcis</span>
        <span class="row-sub">Pas à pas : enregistrer la sauvegarde dans votre dossier, rappel chaque semaine</span></span>${icon('suite')}</a>
    </section>`;
}

/* ---------- Restaurer ---------- */

let pending = null; // { fileName, backup }
let done = null;    // résultat de la dernière restauration

export function restaurerView() {
  return {
    title: 'Restaurer une sauvegarde',
    parent: '#/reglages/copie',
    async render(root) {
      const db = await getDb();
      const rerender = () => this.render(root);
      const current = countsOf(Object.fromEntries(await Promise.all(
        ['transactions', 'rules', 'people', 'accounts', 'categories', 'imports'].map(async (s) => [s, await db.getAll(s)]))));

      if (done) {
        const c = done;
        done = null;
        root.innerHTML = `<section class="card">
            <div class="card-line"><span class="round-icon ok">${icon('ok')}</span>
              <span class="row-text"><span class="row-title">Les données ont été remplacées</span>
              <span class="row-sub">${esc(countsText(c))}</span></span></div>
          </section>
          <a class="btn btn-primary btn-wide" href="#/accueil">Aller à l’accueil</a>`;
        return;
      }

      if (!pending) {
        root.innerHTML = `<section class="card">
            <h2>Choisir la sauvegarde</h2>
            <p class="note">Choisissez un fichier « MonBudget_… » enregistré dans l’app Fichiers (par exemple dans iCloud Drive).
            Avant de remplacer quoi que ce soit, l’app vous montrera ce qu’il contient et vous demandera de confirmer.</p>
            <p class="form-error" role="alert" tabindex="-1" hidden></p>
            <label class="btn btn-secondary btn-wide btn-file">${icon('importer')}Ouvrir mes fichiers
              <input type="file" accept=".json,application/json" data-fichier-sauvegarde></label>
          </section>`;
        root.querySelector('[data-fichier-sauvegarde]').addEventListener('change', async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const err = root.querySelector('.form-error');
          try {
            pending = { fileName: f.name, backup: readBackup(await f.text()) };
            rerender();
          } catch (ex) {
            err.textContent = ex instanceof ReglageError ? ex.message : 'Ce fichier n’a pas pu être lu. Choisissez un autre fichier.';
            err.hidden = false;
            err.focus();
          }
        });
        return;
      }

      const b = pending.backup;
      root.innerHTML = `<section class="danger-zone" role="alert" aria-labelledby="danger-titre">
          <div class="danger-head">${icon('attention')}<h2 id="danger-titre">Attention : toutes vos données vont être supprimées et remplacées</h2></div>
          <p>Les opérations, les règles retenues, les comptes, les personnes et les catégories qui sont <strong>aujourd’hui dans l’app</strong>
          seront <strong>effacés</strong> et remplacés par ceux de la sauvegarde. <strong>Cela ne peut pas être annulé.</strong></p>
          <div class="compare">
            <div class="compare-box compare-now"><span class="compare-title">Sera supprimé — aujourd’hui dans l’app</span>
              <span>${esc(countsText(current))}</span></div>
            <div class="compare-box compare-new"><span class="compare-title">Sera remis — dans la sauvegarde</span>
              <span>${b.createdAt ? `Sauvegarde du ${esc(whenText(b.createdAt))}` : esc(pending.fileName)}</span>
              <span>${esc(countsText(b.counts))}</span></div>
          </div>
          <p><strong>Vos autres appareils aussi :</strong> à la prochaine synchronisation,
            ces données remplaceront celles de votre espace en ligne et de vos autres appareils.</p>
          <p class="note">Conseil : si vous n’êtes pas sûre, sauvegardez d’abord les données d’aujourd’hui.</p>
          <p class="flash" data-message-sauvegarde role="status" hidden></p>
          <button type="button" class="btn btn-secondary btn-wide" data-sauvegarder>${icon('sauvegarde')}Sauvegarder d’abord les données d’aujourd’hui</button>
          <label class="choice choice-check danger-check">
            <input type="checkbox" data-compris>
            <span>J’ai compris : <strong>toutes mes données actuelles seront supprimées</strong> et remplacées par la sauvegarde.</span>
          </label>
          <p class="form-error" role="alert" tabindex="-1" hidden></p>
          <button type="button" class="btn btn-danger btn-wide btn-big" data-remplacer disabled>Remplacer toutes mes données</button>
          <button type="button" class="btn btn-secondary btn-wide" data-annuler-restauration>Annuler, ne rien changer</button>
        </section>`;
      const go = root.querySelector('[data-remplacer]');
      root.querySelector('[data-compris]').addEventListener('change', (e) => { go.disabled = !e.target.checked; });
      root.onclick = async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if ('annulerRestauration' in btn.dataset) { pending = null; location.hash = '#/reglages'; }
        else if ('sauvegarder' in btn.dataset) {
          btn.disabled = true;
          const r = await saveNow();
          btn.disabled = false;
          showSaveResult(root.querySelector('[data-message-sauvegarde]'), r);
        }
        else if ('remplacer' in btn.dataset && !btn.disabled) {
          const ok = await confirmer({
            titre: 'Dernière vérification',
            message: `Toutes les données de l’app vont être supprimées et remplacées par la sauvegarde${b.createdAt ? ` du ${whenText(b.createdAt)}` : ''}. Continuer ?`,
            ok: 'Oui, tout remplacer',
            non: 'Non, annuler',
            danger: true,
          });
          if (!ok) return;
          const err = root.querySelector('.form-error');
          try {
            btn.disabled = true;
            const counts = await restoreBackup(db, b);
            // Une sauvegarde d'une ancienne version reçoit les nouveaux éléments de départ.
            const seed = await (await fetch('./src/data/seed.json')).json();
            await upgradeSeed(db, seed);
            pending = null;
            done = counts;
            session.scheduleSync(0);
            document.dispatchEvent(new CustomEvent('donnees-modifiees'));
            rerender();
          } catch (ex) {
            err.textContent = ex instanceof ReglageError ? ex.message : 'La restauration n’a pas marché. Réessayez.';
            err.hidden = false;
            err.focus();
            btn.disabled = false;
          }
        }
      };
    },
  };
}

/* ---------- Guide Raccourcis ---------- */

export function raccourciView() {
  return {
    title: 'Sauvegarder avec Raccourcis',
    parent: '#/reglages/copie',
    render(root) {
      root.innerHTML = `<section class="card guide">
          <h2>1. Créer le dossier</h2>
          <ol>
            <li>Ouvrez l’app <strong>Fichiers</strong>, puis <strong>iCloud Drive</strong>.</li>
            <li>Créez un dossier <strong>Mon Budget</strong> (touchez les trois points, puis « Nouveau dossier »).</li>
          </ol>
        </section>
        <section class="card guide">
          <h2>2. Créer le raccourci « Sauvegarder Mon Budget »</h2>
          <ol>
            <li>Ouvrez l’app <strong>Raccourcis</strong> et touchez <strong>+</strong> pour un nouveau raccourci.</li>
            <li>Nommez-le <strong>Sauvegarder Mon Budget</strong>.</li>
            <li>Dans les détails du raccourci (bouton ⓘ ou menu du nom), activez <strong>Afficher dans la feuille de partage</strong>
              et choisissez de recevoir des <strong>Fichiers</strong>.</li>
            <li>Ajoutez l’action <strong>Enregistrer le fichier</strong> : le fichier est l’<em>Entrée du raccourci</em>.
              Désactivez <strong>Demander où enregistrer</strong> et choisissez le dossier <strong>iCloud Drive › Mon Budget</strong>.</li>
            <li>(Facultatif) Ajoutez <strong>Afficher la notification</strong> : « Sauvegarde Mon Budget enregistrée ».</li>
          </ol>
          <p class="note">Chaque sauvegarde a un nom unique (date et heure jusqu’à la milliseconde) : aucune n’en écrase une autre.</p>
        </section>
        <section class="card guide">
          <h2>3. Sauvegarder</h2>
          <ol>
            <li>Dans Mon Budget : <strong>Réglages › Sauvegarder maintenant</strong>.</li>
            <li>Dans le menu Partager qui s’ouvre, touchez <strong>Sauvegarder Mon Budget</strong>.</li>
            <li>De retour dans Mon Budget, l’app demande <strong>« Le fichier a-t-il bien été enregistré ? »</strong> :
              touchez <strong>Oui, c’est enregistré</strong> (l’iPad ne le dit pas à l’app quand un raccourci est utilisé).</li>
          </ol>
        </section>
        <section class="card guide">
          <h2>4. Un rappel chaque semaine (facultatif)</h2>
          <ol>
            <li>Dans Raccourcis, onglet <strong>Automatisation</strong>, touchez <strong>+</strong>.</li>
            <li>Choisissez <strong>Heure de la journée</strong>, par exemple le dimanche à 10 h, chaque semaine, et <strong>Exécuter immédiatement</strong>.</li>
            <li>Ajoutez l’action <strong>Afficher la notification</strong> : « Pensez à sauvegarder Mon Budget ».</li>
          </ol>
          <p class="note">Une web app ne peut pas être lancée en arrière-plan par Raccourcis : la sauvegarde elle-même se fait toujours
          en touchant « Sauvegarder maintenant ». Les noms des menus peuvent varier un peu selon la version de l’iPad.</p>
        </section>
        <section class="card guide">
          <h2>Remettre une sauvegarde</h2>
          <p>Réglages › <strong>Restaurer une sauvegarde</strong>, puis choisissez le fichier dans iCloud Drive › Mon Budget.
          L’app montre ce qu’il contient et demande de confirmer avant de remplacer quoi que ce soit.</p>
        </section>`;
    },
  };
}
