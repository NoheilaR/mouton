const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, keyOf, groupAnswers, mergeGroups, isTypo } = require('../server/grouping');

const labels = groups => groups.map(g => g.members.slice().sort().join(','));

test('normalisation : casse, accents, ponctuation, articles, pluriel', () => {
  assert.equal(normalize('  Le   Chocolat chaud !! '), 'chocolat chaud');
  assert.equal(normalize("L'Été"), 'ete');
  assert.equal(normalize('Les Frites'), 'frite');
  assert.equal(normalize('des chevaux'), 'chevau');
  assert.equal(normalize('Une bière'), 'biere');
  assert.equal(normalize('De la purée'), 'puree');
  assert.equal(normalize('Œufs'), 'oeuf');
  assert.equal(normalize('bus'), 'bus');            // mot court : pas de pluriel retiré
  assert.equal(normalize('le'), 'le');              // juste un article : on le garde
  assert.equal(keyOf('pop-corn'), keyOf('Popcorn'));
});

test('tolérance aux fautes : 0 pour 3 lettres, 1 jusqu’à 6, 2 au delà', () => {
  assert.equal(isTypo('rat', 'rot'), false);
  assert.equal(isTypo('lundi', 'lundu'), true);
  assert.equal(isTypo('lundi', 'mardi'), false);
  assert.equal(isTypo('chocolat', 'chocolta'), true);
  assert.equal(isTypo('vendredi', 'mercredi'), false);
  assert.equal(isTypo('lapin', 'sapin'), false);   // première lettre différente : pas une faute
  assert.equal(isTypo('pomme', 'gomme'), false);
});

test('regroupement : réponses identiques après normalisation et fautes de frappe', () => {
  const groups = groupAnswers([
    { playerId: 'A', text: 'Vendredi' },
    { playerId: 'B', text: 'le vendredi !' },
    { playerId: 'C', text: 'vendredii' },
    { playerId: 'D', text: 'Samedi' },
    { playerId: 'E', text: 'Chocolat chaud' },
  ]);
  assert.deepEqual(labels(groups), ['A,B,C', 'E', 'D']); // ex aequo : ordre alphabétique
  assert.equal(groups[0].id, 'g1');
  assert.equal(groups[0].label, 'Vendredi');
  assert.ok(groups[0].variants.includes('vendredii'));
});

test('fusion manuelle de deux groupes', () => {
  const groups = groupAnswers([
    { playerId: 'A', text: 'chocolat chaud' },
    { playerId: 'B', text: 'chocolat' },
    { playerId: 'C', text: 'thé' },
  ]);
  assert.equal(groups.length, 3);
  const choc = groups.find(g => g.label === 'chocolat chaud');
  const c2 = groups.find(g => g.label === 'chocolat');
  assert.equal(mergeGroups(groups, choc.id, c2.id), true);
  assert.equal(groups.length, 2);
  assert.deepEqual(choc.members.sort(), ['A', 'B']);
  assert.deepEqual(choc.variants, ['chocolat chaud', 'chocolat']);
});
