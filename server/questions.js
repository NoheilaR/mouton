// Chargement du fichier de questions et tirage sans doublon dans une partie.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'questions.json');

// Lit questions.json et renvoie [{ id, name, emoji, questions: [texte] }]
function loadCategories(file = FILE) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw.categories.map(c => ({
    id: String(c.id),
    name: String(c.name),
    emoji: String(c.emoji || ''),
    questions: c.questions.map(q => String(q).trim()).filter(Boolean),
  }));
}

function shuffle(list, rng = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Construit la pioche d'une partie : questions des catégories actives + questions des joueurs, mélangées.
// Chaque carte : { text, category, by } (by = pseudo de l'auteur pour une question de joueur).
function buildDeck(categories, activeIds, custom = [], rng = Math.random) {
  const cards = [];
  const seen = new Set();
  const add = card => {
    const k = card.text.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    cards.push(card);
  };
  for (const c of categories) {
    if (!activeIds.includes(c.id)) continue;
    for (const text of c.questions) add({ text, category: c.name, emoji: c.emoji, by: null });
  }
  for (const q of custom) add({ text: q.text, category: 'Proposée par ' + q.byName, emoji: '✍️', by: q.byName });
  return shuffle(cards, rng);
}

module.exports = { loadCategories, buildDeck, shuffle };
