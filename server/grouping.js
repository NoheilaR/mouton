// Regroupement des réponses : normalisation, rapprochement des fautes de frappe.
// Module pur (aucun état), utilisé par le moteur de jeu et par les tests.

// Articles retirés en début de réponse (après normalisation, donc sans accents)
const ARTICLES = ['de la ', 'de l ', 'le ', 'la ', 'les ', 'un ', 'une ', 'du ', 'des ', 'l ', 'd '];

// Met une réponse sous une forme comparable :
// minuscules, sans accents ni ponctuation, sans article en tête, pluriel simple retiré.
function normalize(text) {
  let s = String(text ?? '')
    .toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // accents
    .replace(/[^a-z0-9]+/g, ' ')                          // ponctuation, apostrophes, emojis
    .replace(/\s+/g, ' ')
    .trim();
  const full = s;
  // Plusieurs articles possibles ("de la", puis rien d'autre), on boucle par sécurité
  for (let again = true; again;) {
    again = false;
    for (const a of ARTICLES) {
      if (s.startsWith(a) && s.length > a.length) { s = s.slice(a.length); again = true; break; }
    }
  }
  // Pluriel simple : s ou x final sur les mots d'au moins 4 lettres ("bus" et "prix" restent intacts)
  s = s.split(' ').map(w => (w.length >= 4 && /[sx]$/.test(w) ? w.slice(0, -1) : w)).join(' ');
  return s || full;
}

// Clé de comparaison : la forme normalisée sans espaces ("pop corn" = "popcorn")
const keyOf = text => normalize(text).replace(/ /g, '');

// Distance de Levenshtein classique (deux lignes de la matrice suffisent)
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Nombre de fautes tolérées selon la longueur du mot le plus court :
// rien jusqu'à 3 lettres (sinon "rat" = "rot"), 1 jusqu'à 6 lettres, 2 au delà.
function tolerance(len) {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

// Une faute de frappe touche rarement la première lettre : on l'exige identique,
// sinon "lapin" et "sapin" ou "pomme" et "gomme" finiraient dans le même tas.
const isTypo = (a, b) => a[0] === b[0] && levenshtein(a, b) <= tolerance(Math.min(a.length, b.length));

// Regroupe des réponses. Entrée : [{ playerId, text }]. Sortie : groupes triés du plus gros au plus petit,
// chacun { id, key, label, variants, members }. Les ids sont stables pour un même tirage (g1, g2...).
function groupAnswers(answers) {
  // 1. Une "boîte" par clé normalisée identique
  const boxes = new Map();
  for (const a of answers) {
    const key = keyOf(a.text);
    if (!boxes.has(key)) boxes.set(key, { key, items: [] });
    boxes.get(key).items.push(a);
  }
  // 2. Union-find : on rapproche les boîtes dont les clés sont à une faute de frappe près
  const list = [...boxes.values()];
  const parent = list.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (isTypo(list[i].key, list[j].key)) parent[find(j)] = find(i);
    }
  }
  const merged = new Map();
  list.forEach((box, i) => {
    const root = find(i);
    if (!merged.has(root)) merged.set(root, []);
    merged.get(root).push(...box.items);
  });
  // 3. Mise en forme : libellé = variante la plus fréquente (la première en cas d'égalité)
  const groups = [...merged.values()].map(items => makeGroup(items));
  groups.sort((a, b) => b.members.length - a.members.length || a.label.localeCompare(b.label, 'fr'));
  groups.forEach((g, i) => { g.id = 'g' + (i + 1); });
  return groups;
}

function makeGroup(items) {
  const counts = new Map();
  for (const it of items) {
    const t = String(it.text).trim();
    const k = t.toLowerCase();
    if (!counts.has(k)) counts.set(k, { text: t, n: 0 });
    counts.get(k).n++;
  }
  const variants = [...counts.values()].sort((a, b) => b.n - a.n).map(v => v.text);
  return {
    id: null,
    key: keyOf(items[0].text),
    label: variants[0],
    variants,
    members: items.map(it => it.playerId),
  };
}

// Fusionne le groupe `fromId` dans `intoId` (en place). Renvoie true si la fusion a eu lieu.
function mergeGroups(groups, intoId, fromId) {
  if (intoId === fromId) return false;
  const into = groups.find(g => g.id === intoId);
  const from = groups.find(g => g.id === fromId);
  if (!into || !from) return false;
  into.members.push(...from.members);
  for (const v of from.variants) if (!into.variants.some(x => x.toLowerCase() === v.toLowerCase())) into.variants.push(v);
  groups.splice(groups.indexOf(from), 1);
  return true;
}

module.exports = { normalize, keyOf, levenshtein, tolerance, isTypo, groupAnswers, mergeGroups };
