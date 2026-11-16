/**
 * ecran-relancer.js — Réglages › Relancer le classement (sans réimporter) : numéros sans compte,
 * opérations remises sur la bonne carte, règles, factures de carte.
 *
 * Version : 0.21.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-16
 *
 * Adresse : #/reglages/relancer.
 *
 * Historique :
 *   0.21.0 FRE (Fidag)  Première version.
 */

import { icon, esc } from './ui.js';
import { getDb } from './store.js';
import { chooseOption } from './choix.js';
import * as session from './session.js';
import { unknownRefs, reprocessAll } from '../src/core/entretien.js';
import { assignBankRef } from '../src/core/reglages.js';
import { shortRef } from '../src/core/import.js';

let result = null;
const n = (k, one, many) => `${k} ${k > 1 ? many : one}`;

export function relancerView() {
  return {
    title: 'Relancer le classement',
    parent: '#/reglages',
    async render(root) {
      const db = await getDb();
      const [unknown, accounts] = await Promise.all([unknownRefs(db), db.getAll('accounts')]);
      const A = new Map(accounts.map((a) => [a.id, a]));
      root.innerHTML = `<section class="card">
          <p>Sans réimporter les fichiers, l’app :</p>
          <ul class="del-list">
            <li>remet chaque opération sur le compte ou la carte qui porte son numéro (« pour qui » suit la titulaire de la carte) ;</li>
            <li>relance vos règles sur les opérations à trier ;</li>
            <li>rattache les factures de carte qui tombent juste.</li>
          </ul>
          <p class="note">Les opérations triées à la main gardent leur catégorie.</p>
        </section>
        ${result ? `<section class="card del-done"><span class="round-icon ok">${icon('ok')}</span><h2>C’est fait</h2>
            <div class="counts">
              <div class="count-line"><span>Opérations remises sur la bonne carte</span><strong>${result.deplacees}</strong></div>
              <div class="count-line"><span>« Pour qui » mis à jour</span><strong>${result.personnes}</strong></div>
              <div class="count-line"><span>Classées par vos règles</span><strong>${result.classees}</strong></div>
              <div class="count-line"><span>Factures de carte rattachées</span><strong>${result.factures}</strong></div>
            </div></section>` : ''}
        ${unknown.length ? `<h2 class="group-title">Numéros sans compte</h2>
          <p class="note">Ces numéros se trouvent dans vos opérations, mais aucun compte ne les porte (par exemple après « Oublier »).
          Dites à quel compte ou quelle carte chacun appartient :</p>
          <section class="card list">${unknown.map((u, i) => `<div class="row row-static">
              <span class="row-text"><span class="row-title">${u.kind === 'carte' ? 'Carte' : 'Compte'} ${esc(shortRef(u.ref))}</span>
                <span class="row-sub">${n(u.count, 'opération', 'opérations')} · aujourd’hui sur ${esc(u.accountIds.map((id) => A.get(id)?.name ?? 'un compte supprimé').join(', '))}</span></span>
              <button type="button" class="btn btn-secondary btn-small" data-attribuer="${i}">À quel compte ?</button></div>`).join('')}</section>` : ''}
        <p class="form-error" role="alert" tabindex="-1" hidden></p>
        <button type="button" class="btn btn-primary btn-wide btn-big" data-relancer>Relancer le classement maintenant</button>`;
      result = null;
      root.onclick = async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.attribuer) {
          const u = unknown[Number(b.dataset.attribuer)];
          const choices = accounts.filter((a) => a.kind === u.kind).concat(accounts.filter((a) => a.kind !== u.kind));
          const id = await chooseOption({ title: `${u.kind === 'carte' ? 'Carte' : 'Compte'} ${shortRef(u.ref)} : à qui ?`, selected: null,
            options: choices.map((a) => ({ id: a.id, name: a.name, sub: a.kind === 'carte' ? 'Carte' : 'Compte' })) });
          if (!id) return;
          await assignBankRef(db, id, u.ref);
          await this.render(root);
        } else if ('relancer' in b.dataset) {
          b.disabled = true;
          b.textContent = 'Un instant…';
          try {
            result = await reprocessAll(db);
            document.dispatchEvent(new CustomEvent('donnees-modifiees'));
            session.scheduleSync(0);
            await this.render(root);
            root.closest('dialog')?.scrollTo?.(0, 0);
            window.scrollTo(0, 0);
          } catch {
            const err = root.querySelector('.form-error');
            err.textContent = 'Cela n’a pas marché. Réessayez.';
            err.hidden = false;
            b.disabled = false;
          }
        }
      };
    },
  };
}
