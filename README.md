# Moutons

Jeu multijoueur en temps réel à jouer entre potes, chacun sur son téléphone ou son PC.
Une question s'affiche, chacun répond en secret : le but est d'écrire la même chose que le plus de monde possible.
Ceux qui sont hors du plus gros troupeau perdent un cœur. Le dernier mouton en vie gagne.

## Lancer en local

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # redémarre à chaque modification
npm test           # tests du regroupement, du moteur et d'une partie à plusieurs clients
```

Pour tester à plusieurs, ouvrez plusieurs onglets (ou une fenêtre privée par joueur, car l'id du joueur est stocké en localStorage).

## Variables d'environnement

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | `3000` | Port HTTP du serveur |

Pas de base de données : les rooms vivent en mémoire. Un redémarrage du serveur efface les parties en cours.

## Déploiement sur Coolify

1. Nouvelle ressource, à partir du dépôt Git, build pack **Dockerfile**.
2. Port exposé : `3000` (ou définissez `PORT` et mettez le même port dans Coolify).
3. Healthcheck possible sur `/healthz`.
4. Une seule instance : l'état étant en mémoire, ne pas mettre plusieurs réplicas.

Les WebSockets passent par le proxy de Coolify sans réglage particulier.

## Organisation

```
server/index.js      Express + Socket.IO, reçoit les actions et diffuse l'état
server/rooms.js      rooms, joueurs, réglages, vue filtrée envoyée à chaque joueur
server/game.js       déroulé des manches, cœurs, boucliers, Loup
server/grouping.js   normalisation et regroupement des réponses
server/questions.js  chargement des questions et pioche sans doublon
data/questions.json  224 questions en 8 catégories
public/              front (HTML, CSS, JS vanilla, moutons en SVG)
test/                tests (node --test)
```
