/**
 * ecran-factures.js — Écran « Factures de carte » : rattacher les achats des cartes au prélèvement
 * de la facture (LSV) sur le compte, pour ne pas les compter deux fois.
 *
 * Version : 0.20.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-08
 *
 * Adresses : #/factures (liste), #/factures/<id> (cocher les achats d'une facture).
 *
 * Historique :
 *   0.4.0  FRE (Fidag)  Première version.
 *   0.18.0 FRE (Fidag)  « Cocher le fichier du … au … » : un fichier de carte importé = une facture.
 *   0.18.1 FRE (Fidag)  Correspondance exacte → enregistrée toute seule (à l'ouverture, en cochant un fichier ou des
 *                       achats) ; barre « Enregistrer » toujours visible en bas avec le total et l'écart.
 *   0.19.0 FRE (Fidag)  « Sans le détail des achats ? » : marquer comme vérifiée ou compter comme une dépense ;
 *                       écart de chaque fichier ; achats du plus récent au plus ancien ; explication des achats proposés.
 *   0.20.0 FRE (Fidag)  « Proposition de l'app » (findSmartMatch) : achats passés sur la facture suivante / repris.
 */

import { icon, esc, confirmer } from './ui.js';
import { getDb } from './store.js';
import { formatCHF, formatAmount, formatDateLong, displayName, opName, formatDateShort } from '../src/core/format.js';
import { ReglageError } from '../src/core/reglages.js';
import { listBills, billStatus, candidates, linkBill, cardsPaidFrom, importGroups, autoLinkAll, markBillChecked, findSmartMatch, previousBillDate, isForeign } from '../src/core/cartes.js';
import { editOperation } from './operation.js';
import { loadAll } from './ecran-journal.js';
import { toCents } from '../src/core/text.js';

function statusText(st) {
  if (st.checked && !st.complete) return 'Vérifiée sans le détail des achats';
  if (st.complete) return `Juste : ${st.count} achat${st.count > 1 ? 's' : ''} rattaché${st.count > 1 ? 's' : ''}`;
  if (!st.count) return 'À vérifier : aucun achat rattaché';
  return `À vérifier : écart de ${formatCHF(Math.abs(st.difference))}`;
}

let flash = ''; // message à afficher une fois sur la liste (« Facture juste : enregistrée »)

function liste() {
  return {
    title: 'Factures de carte',
    parent: null,
    async render(root) {
      const db = await getDb();
      // Correspondance exacte (fichier de carte ou suite d'achats) : rattachée toute seule.
      const auto = await autoLinkAll(db);
      if (auto) document.dispatchEvent(new CustomEvent('donnees-modifiees'));
      const bills = await listBills(db);
      const accounts = new Map((await db.getAll('accounts')).map((a) => [a.id, a]));
      const rows = [];
      for (const b of bills) {
        const st = await billStatus(db, b);
        rows.push(`<a class="row" href="#/factures/${encodeURIComponent(b.id)}">
          <span class="row-text"><span class="row-title">${esc(formatDateLong(b.date, { capital: true }))} · ${formatCHF(Math.abs(b.amount))}</span>
          <span class="row-sub ${st.complete || st.checked ? '' : 'warn'}">${st.complete || st.checked ? '' : icon('attention')}${esc(statusText(st))} · ${esc(accounts.get(b.accountId)?.name ?? '')}</span></span>
          ${icon('suite')}</a>`);
      }
      const msg = [flash, auto ? `${auto} facture${auto > 1 ? 's rattachées' : ' rattachée'} toute${auto > 1 ? 's' : ''} seule${auto > 1 ? 's' : ''} : le montant correspond exactement.` : '']
        .filter(Boolean).map((m) => `<p class="flash" role="status">${icon('ok')}${esc(m)}</p>`).join('');
      flash = '';
      root.innerHTML = `${msg}<p class="note">Le prélèvement de la facture de carte n’est pas compté dans les totaux :
          ce sont les achats faits avec les cartes qui le sont, chacun pour sa personne.
          Ici, vous vérifiez que les achats correspondent bien à chaque facture.</p>
        ${rows.length ? `<section class="card list">${rows.join('')}</section>`
          : `<section class="card empty"><span class="empty-icon">${icon('carte')}</span><h2>Aucune facture pour l’instant</h2>
             <p>Le prélèvement de la facture de carte sera reconnu en important le relevé du compte.</p></section>`}`;
    },
  };
}

function facture(id) {
  let checked = null; // Set des achats cochés (gardé pendant qu'on coche)
  return {
    title: 'Facture de carte',
    parent: '#/factures',
    async render(root) {
      const db = await getDb();
      const bill = await db.get('transactions', id);
      if (!bill?.isCardBillPayment) { location.hash = '#/factures'; return; }
      const list = await candidates(db, bill);
      const cards = await cardsPaidFrom(db, bill.accountId);
      const people = new Map((await db.getAll('people')).map((p) => [p.id, p]));
      if (!checked) checked = new Set(list.filter((t) => t.cardBillId === bill.id).map((t) => t.id));

      // Les fichiers importés dont les achats sont encore libres (ou déjà rattachés à cette facture).
      const files = importGroups(list).filter((g) => g.items.every((t) => !t.cardBillId || t.cardBillId === bill.id));
      const sum = list.filter((t) => checked.has(t.id)).reduce((s, t) => s + toCents(t.amount), 0);
      const diff = toCents(bill.amount) - sum;
      const diffText = diff === 0
        ? `<p class="flash">${icon('ok')}Le total des achats cochés est exactement celui de la facture.</p>`
        : `<p class="warn-box">${icon('attention')}${diff < 0 ? 'Il manque' : 'Il y a trop de'} ${formatCHF(Math.abs(diff) / 100)} par rapport à la facture.
           ${diff < 0 ? 'Il peut s’agir de frais de la carte ou d’achats pas encore importés.' : 'Décochez les achats qui appartiennent à la facture suivante.'}</p>`;

      // Proposition de l'app (combinaison exacte la plus probable), si la facture n'est pas encore juste.
      const linkedNow = list.filter((t) => t.cardBillId === bill.id).reduce((x, t) => x + toCents(t.amount), 0);
      const smart = linkedNow === toCents(bill.amount) ? null
        : findSmartMatch(bill, list.map((t) => (t.cardBillId === bill.id ? { ...t, cardBillId: null } : t)), { prevBillDate: await previousBillDate(db, bill) });
      const line = (t) => `<li>${esc(opName(t))} · ${esc(formatDateShort(t.date))} · ${formatCHF(Math.abs(t.amount))}${isForeign(t) ? ' · <strong>monnaie étrangère</strong>' : ''}</li>`;
      const smartHtml = smart ? `<section class="card smart-card">
          <h2>${icon('ok')}Proposition de l’app</h2>
          <p><strong>${smart.items.length} achats font exactement ${formatCHF(Math.abs(bill.amount))}.</strong>
            ${smart.ambiguous ? 'D’autres combinaisons sont possibles : vérifiez avant de l’utiliser.' : ''}</p>
          ${smart.removed.length ? `<p class="note">Passent sur la facture suivante (comptabilisés après la clôture) :</p><ul class="smart-list">${smart.removed.map(line).join('')}</ul>` : ''}
          ${smart.added.length ? `<p class="note">Repris (restés ouverts ou comptabilisés plus tard) :</p><ul class="smart-list">${smart.added.map(line).join('')}</ul>` : ''}
          <button type="button" class="btn btn-primary btn-wide" data-proposition>Utiliser cette proposition</button>
        </section>` : '';
      // Les plus récents en haut.
      const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
      const group = (card) => {
        const items = list.filter((t) => t.accountId === card.id).sort(newestFirst);
        if (!items.length) return '';
        const owner = people.get(card.personId);
        return `<h2 class="group-title">${esc(card.name)}${owner ? ` · ${esc(owner.name)}` : ''}</h2>
          <section class="card list">
            ${items.map((t) => `<label class="row check-row">
              <input type="checkbox" data-achat="${esc(t.id)}"${checked.has(t.id) ? ' checked' : ''}>
              <span class="row-text"><span class="row-title">${esc(opName(t))}</span>
                <span class="row-sub">${esc(formatDateLong(t.date))}</span></span>
              <span class="row-title">${formatAmount(t.amount)}</span>
            </label>`).join('')}
          </section>`;
      };

      root.innerHTML = `${smartHtml}<section class="card">
          <div class="card-line"><span class="round-icon">${icon('carte')}</span>
            <span class="row-text"><span class="row-title">Prélevée le ${esc(formatDateLong(bill.date))}</span>
            <span class="row-sub">${esc(bill.description)}</span></span></div>
          <div class="counts">
            <div class="count-line"><span>Montant de la facture</span><strong>${formatCHF(Math.abs(bill.amount))}</strong></div>
            <div class="count-line"><span>Achats cochés (${checked.size})</span><strong>${formatCHF(Math.abs(sum) / 100)}</strong></div>
          </div>
          ${diffText}
        </section>
        ${files.length ? `<h2 class="group-title">Un fichier de carte = une facture</h2>
          <section class="card list">${files.map((g, i) => `<button type="button" class="row file-pick" data-fichier="${i}">
              <span class="row-text"><span class="row-title">Cocher le fichier du ${esc(formatDateShort(g.from))} au ${esc(formatDateShort(g.to))}</span>
              <span class="row-sub">${g.items.length} achat${g.items.length > 1 ? 's' : ''} · ${formatCHF(Math.abs(g.cents) / 100)}${g.cents === toCents(bill.amount)
                ? ' · exactement le montant de la facture' : ` · écart de ${formatCHF(Math.abs(g.cents - toCents(bill.amount)) / 100)} avec la facture`}</span></span>
              ${icon('ok')}</button>`).join('')}</section>` : ''}
        <p class="note">${files.length ? 'Ou cochez vous-même' : 'Cochez'} les achats payés par cette facture. Sont proposés : les achats des cartes
          ${esc(cards.map((c) => c.name).join(', ') || '—')}, datés au plus tard le jour du prélèvement et pas encore rattachés à une
          autre facture — les plus récents en haut.</p>
        ${list.length ? '' : `<section class="card"><p class="note">Aucun achat de carte importé jusqu’à cette date. Importez le fichier de la carte
          pour cette période, ou classez la facture sans le détail (ci-dessous).</p></section>`}
        ${cards.length ? cards.map(group).join('') : '<p class="note">Aucune carte n’est payée depuis ce compte. Réglez-le dans Réglages, « Mes comptes ».</p>'}
        <section class="card no-detail">
          <h2>Sans le détail des achats ?</h2>
          ${bill.billChecked ? `<p class="flash">${icon('ok')}Vérifiée sans le détail le ${esc(formatDateLong(bill.billChecked.slice(0, 10)))}.</p>
              <button type="button" class="btn btn-secondary btn-wide" data-sans-detail-annuler>Ne plus la marquer comme vérifiée</button>`
            : `<p class="note">Si vous n’importez pas le fichier de la carte pour cette facture :</p>
              <button type="button" class="btn btn-secondary btn-wide" data-sans-detail>${icon('ok')}La marquer comme vérifiée</button>
              <p class="note">Elle ne sera plus signalée. Elle reste hors des totaux : les achats de cette facture n’y figurent pas.</p>
              <button type="button" class="btn btn-secondary btn-wide" data-comme-depense>Compter la facture comme une dépense</button>
              <p class="note">Elle est alors classée comme une seule dépense (pour qui, quelle catégorie) et comptée dans les totaux.</p>`}
        </section>
        <div class="save-bar"${list.length ? '' : ' hidden'}>
          <p class="form-error" role="alert" tabindex="-1" hidden></p>
          <span class="save-bar-text">${checked.size} coché${checked.size > 1 ? 's' : ''} · ${formatCHF(Math.abs(sum) / 100)}
            ${diff === 0 ? '<strong>· juste</strong>' : `· écart ${formatCHF(Math.abs(diff) / 100)}`}</span>
          <button type="button" class="btn btn-primary" data-enregistrer>Enregistrer</button>
        </div>`;

      // Total coché = montant de la facture ?
      const exact = () => checked.size > 0 && list.filter((t) => checked.has(t.id)).reduce((x, t) => x + toCents(t.amount), 0) === toCents(bill.amount);
      const save = async () => {
        const err = root.querySelector('.form-error');
        try {
          const wasExact = exact();
          await linkBill(db, bill.id, [...checked]);
          document.dispatchEvent(new CustomEvent('donnees-modifiees'));
          flash = wasExact ? `Facture du ${formatDateLong(bill.date)} : juste, enregistrée.` : `Facture du ${formatDateLong(bill.date)} : enregistrée.`;
          location.hash = '#/factures';
        } catch (ex) {
          err.textContent = ex instanceof ReglageError ? ex.message : 'L’enregistrement n’a pas marché. Réessayez.';
          err.hidden = false;
          err.focus();
        }
      };
      root.onchange = (e) => {
        const box = e.target.closest('[data-achat]');
        if (!box) return;
        if (box.checked) checked.add(box.dataset.achat); else checked.delete(box.dataset.achat);
        if (exact()) { save(); return; }
        const y = root.closest('dialog')?.scrollTop ?? window.scrollY;
        this.render(root).then(() => {
          const d = root.closest('dialog');
          if (d) d.scrollTop = y; else window.scrollTo(0, y);
          root.querySelector(`[data-achat="${CSS.escape(box.dataset.achat)}"]`)?.focus();
        });
      };
      root.onclick = async (e) => {
        if (e.target.closest('[data-proposition]') && smart) {
          checked = new Set(smart.items.map((t) => t.id));
          save();
          return;
        }
        const f = e.target.closest('[data-fichier]');
        if (f) {
          checked = new Set(files[Number(f.dataset.fichier)].items.map((t) => t.id));
          if (exact()) { save(); return; }
          await this.render(root);
          return;
        }
        if (e.target.closest('[data-enregistrer]')) { save(); return; }
        if (e.target.closest('[data-sans-detail]')) {
          const ok = await confirmer({ titre: 'Marquer la facture comme vérifiée ?', ok: 'Oui, vérifiée', non: 'Annuler',
            message: `Facture du ${formatDateLong(bill.date)} (${formatCHF(Math.abs(bill.amount))}) : elle ne sera plus signalée, sans le détail des achats.` });
          if (!ok) return;
          await markBillChecked(db, bill.id, true);
          document.dispatchEvent(new CustomEvent('donnees-modifiees'));
          flash = `Facture du ${formatDateLong(bill.date)} : vérifiée sans le détail.`;
          location.hash = '#/factures';
        } else if (e.target.closest('[data-sans-detail-annuler]')) {
          await markBillChecked(db, bill.id, false);
          document.dispatchEvent(new CustomEvent('donnees-modifiees'));
          await this.render(root);
        } else if (e.target.closest('[data-comme-depense]')) {
          const data = await loadAll(db);
          if (await editOperation(db, bill, { ...data, categories: data.activeCategories })) {
            document.dispatchEvent(new CustomEvent('donnees-modifiees'));
            const now = await db.get('transactions', bill.id);
            if (!now?.isCardBillPayment) { flash = `Facture du ${formatDateLong(bill.date)} : comptée comme une dépense.`; location.hash = '#/factures'; return; }
            await this.render(root);
          }
        }
      };
    },
  };
}

/** @param {string[]} path segments après « factures » */
export function facturesView(path) {
  const [id] = path.map(decodeURIComponent);
  return id ? facture(id) : liste();
}
