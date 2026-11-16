/**
 * reclasser.js — Question commune après qu'une règle a changé : reclasser les opérations existantes ou non.
 *
 * Version : 0.22.0
 * Auteur  : FRE (Fidag)
 * Date    : 2026-11-15
 *
 * Posée depuis Réglages › Règles retenues, depuis « Modifier l'opération » (« Changer aussi la règle ? »)
 * et depuis « À trier » (« Toujours classer… » qui modifie une règle existante).
 * Choix : celles classées par la règle (et celles à trier) / toutes celles du commerce, même triées à la
 * main / laisser comme ça. Rien n'est demandé s'il n'y a rien à changer.
 *
 * Historique :
 *   0.17.0 FRE (Fidag)  Première version.
 *   0.22.0 FRE (Fidag)  Règle « titulaire de la carte ».
 */

import { chooseOption } from './choix.js';
import { reclassifyPreview, reclassifyMatching, CARD_HOLDER, CARD_HOLDER_LABEL } from '../src/core/regles.js';

const n = (k, one, many) => `${k} ${k > 1 ? many : one}`;

/**
 * @returns {Promise<number>} nombre d'opérations reclassées
 */
export async function askReclassify(db, ruleId, { exceptId = null } = {}) {
  const rule = await db.get('rules', ruleId);
  if (!rule) return 0;
  const p = await reclassifyPreview(db, rule, { exceptId });
  const auto = p.byRule.length + p.pending.length;
  const manual = p.manual.length;
  if (!auto && !manual) return 0;
  const [cat, who] = await Promise.all([db.get('categories', rule.categoryId), db.get('people', rule.personId)]);
  const target = `→ ${cat?.name ?? '?'}, pour ${rule.personId === CARD_HOLDER ? CARD_HOLDER_LABEL.toLowerCase() : who?.name ?? '?'}`;
  const options = [];
  if (auto) {
    options.push({ id: 'auto', name: `Oui, reclasser ${n(auto, 'opération', 'opérations')}`,
      sub: [p.byRule.length ? `${p.byRule.length} classée${p.byRule.length > 1 ? 's' : ''} par cette règle` : '',
        p.pending.length ? `${p.pending.length} à trier` : ''].filter(Boolean).join(' et ') + ` ${target}` });
  }
  if (manual) {
    options.push({ id: 'toutes', name: `Oui, reclasser toutes les ${auto + manual} opérations de ce commerce`,
      sub: `Y compris ${n(manual, 'opération triée', 'opérations triées')} à la main ${target}` });
  }
  options.push({ id: 'non', name: 'Non, laisser comme ça', sub: 'Seules les prochaines opérations suivront la règle' });
  const id = await chooseOption({
    title: `Reclasser les opérations «\u00a0${rule.merchantKey}\u00a0»\u00a0?`,
    options, selected: null,
  });
  if (id !== 'auto' && id !== 'toutes') return 0;
  const done = await reclassifyMatching(db, rule.id, { includeManual: id === 'toutes', exceptId });
  document.dispatchEvent(new CustomEvent('donnees-modifiees'));
  return done;
}
