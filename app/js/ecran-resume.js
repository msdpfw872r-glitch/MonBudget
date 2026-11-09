/**
 * ecran-resume.js — Écran « Résumé du mois » : rentrées, dépenses, reste ; où va l'argent ;
 * dépenses pour qui ; export du mois pour Numbers ou Excel.
 *
 * Version : 0.5.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-09
 *
 * Historique :
 *   0.5.0  FRE (Fidag)  Première version.
 */

import { icon, esc } from './ui.js';
import { getDb } from './store.js';
import { formatCHF } from '../src/core/format.js';
import { monthSummary, exportMonth } from '../src/core/journal.js';
import { currentMonth, setMonth, currentPerson, setPerson, monthSwitch, personFilter, paint } from './mois.js';
import { loadAll } from './ecran-journal.js';

const TOP = 6;

/** Barres horizontales : un libellé, un montant, une barre proportionnelle (jamais la couleur seule). */
export function bars(items, { color } = {}) {
  const max = Math.max(...items.map((i) => i.value), 0.01);
  return `<div class="bars">${items.map((i) => `<div class="bar-line">
      <div class="bar-label"><span class="bar-name">${i.color ? `<span class="swatch swatch-small" data-color="${esc(i.color)}"></span>` : ''}${esc(i.label)}</span>
        <strong>${formatCHF(i.value)}</strong></div>
      <div class="bar-track"><div class="bar-fill" data-w="${Math.max(2, Math.round((i.value / max) * 100))}"
        ${i.color ?? color ? `data-color="${esc(i.color ?? color)}"` : ''}></div></div>
    </div>`).join('')}</div>`;
}

/** Les trois chiffres du mois (Accueil et Résumé). */
export function monthCards(s) {
  return `<div class="stat-row">
      ${s.balance < 0
        ? `<div class="stat stat-main stat-minus"><span>Il manque ce mois-ci</span><strong>${formatCHF(-s.balance)}</strong></div>`
        : `<div class="stat stat-main"><span>Il reste ce mois-ci</span><strong>${formatCHF(s.balance)}</strong></div>`}
      <div class="stat stat-in"><span>Rentrées</span><strong>${formatCHF(s.income)}</strong></div>
      <div class="stat"><span>Dépenses</span><strong>${formatCHF(s.expenses)}</strong></div>
    </div>`;
}

/** Remarques sur ce qui n'est pas compté. */
export function notCountedNote(s) {
  const parts = [];
  if (s.toSort.count) {
    const n = s.toSort.count;
    parts.push(`<div class="warn-box warn-action">${icon('attention')}<span>${n > 1 ? `${n} opérations pas encore triées ne sont pas comptées.` : 'Une opération pas encore triée n’est pas comptée.'}</span>
      <a class="btn btn-secondary" href="#/trier">Trier maintenant</a></div>`);
  }
  if (s.excluded.count) {
    const n = s.excluded.count;
    parts.push(`<p class="note">${n > 1 ? `${n} opérations (virements, épargne ou factures de carte) ne sont pas comptées` : 'Une opération (virement, épargne ou facture de carte) n’est pas comptée'} : les achats faits avec les cartes le sont déjà.</p>`);
  }
  return parts.join('');
}

/** Partage le fichier (« Enregistrer dans Fichiers ») ou, à défaut, le télécharge. */
async function shareOrDownload(text, fileName) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const file = new File([blob], fileName, { type: 'text/csv' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return; // la personne a fermé le partage
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function resumeView() {
  return {
    title: 'Résumé',
    parent: null,
    async render(root) {
      const db = await getDb();
      const data = await loadAll(db);
      const draw = () => {
        const month = currentMonth(data.transactions);
        const personId = currentPerson();
        const s = monthSummary(data.transactions, data.categories, { month, personId });
        const spend = s.byCategory.filter((c) => c.type === 'depense');
        const top = spend.slice(0, TOP).map((c) => ({ label: data.categoriesById.get(c.categoryId)?.name ?? 'Catégorie supprimée', value: c.total }));
        const rest = spend.slice(TOP).reduce((t, c) => t + Math.round(c.total * 100), 0) / 100;
        if (rest > 0) top.push({ label: 'Autres', value: rest });
        const income = s.byCategory.filter((c) => c.type === 'recette')
          .map((c) => ({ label: data.categoriesById.get(c.categoryId)?.name ?? 'Catégorie supprimée', value: c.total }));
        const who = s.byPerson.filter((p) => p.expenses > 0).map((p) => {
          const person = data.peopleById.get(p.personId);
          return { label: person?.name ?? 'Personne supprimée', value: p.expenses, color: person?.color };
        });
        const empty = !s.income && !s.expenses;
        root.innerHTML = `<div class="page-head"><div><h1>Résumé du mois</h1></div>
            <button type="button" class="btn btn-secondary" data-exporter>${icon('exporter')}Exporter le mois</button></div>
          ${monthSwitch(month)}
          ${personFilter(data.people, personId)}
          ${monthCards(s)}
          ${notCountedNote(s)}
          ${empty ? `<section class="card empty"><span class="empty-icon">${icon('resume')}</span><h2>Rien à résumer ce mois-ci</h2>
              <p>Importez un relevé et triez les opérations, ou changez de mois.</p></section>`
            : `<div class="resume-grid">
              ${top.length ? `<section class="card"><h2>Où va l’argent</h2>${bars(top, { color: '#1D6F61' })}</section>` : ''}
              ${!personId && who.length ? `<section class="card"><h2>Dépenses pour qui ?</h2>${bars(who)}</section>` : ''}
              ${income.length ? `<section class="card"><h2>D’où vient l’argent</h2>${bars(income, { color: '#1D6F61' })}</section>` : ''}
            </div>`}
          <p class="note">« Exporter le mois » crée un fichier à ouvrir dans Numbers ou Excel : choisissez « Enregistrer dans Fichiers ».</p>`;
        paint(root);
      };
      draw();
      root.onclick = async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.mois) { setMonth(b.dataset.mois); draw(); }
        else if ('filtrePersonne' in b.dataset) { setPerson(b.dataset.filtrePersonne); draw(); }
        else if ('exporter' in b.dataset) {
          const month = currentMonth(data.transactions);
          const personId = currentPerson();
          const text = exportMonth(data.transactions, {
            month, personId, categories: data.categories, people: data.people, accounts: [...data.accounts.values()],
          });
          const who = personId ? `_${data.peopleById.get(personId)?.name ?? ''}` : '';
          await shareOrDownload(text, `MonBudget_${month}${who}.csv`);
        }
      };
    },
  };
}
