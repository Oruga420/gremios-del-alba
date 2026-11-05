# Les Guildes de l'Aube

[Español](README.md) · [English](README.en.md) · [Português](README.pt.md) · [日本語](README.ja.md) · [العربية](README.ar.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

Un RTS de fantasy **open source**, jouable dans le navigateur, avec des villageois
qui portent un nom, des guildes, de la construction, des ressources, des murailles,
des combats et des ordres en espagnol.

La portée actuelle se limite aux batailles et escarmouches contre l'IA, avec
économie, construction et combat sur des cartes découvertes. Aucune campagne
n'est incluse.

![Gremios del Alba](assets/hero.png)

## Jouer en local

Prérequis : **Node.js 24 ou version ultérieure** et un navigateur moderne. Aucune
dépendance npm à installer.

```sh
git clone https://github.com/Oruga420/gremios-del-alba.git
cd gremios-del-alba
npm start
```

Ouvrez **http://127.0.0.1:4173**. Sous Windows, vous pouvez aussi utiliser `PLAY.cmd`.
Le serveur est conçu pour un usage local et écoute sur l'interface loopback.

## Contenu

- Dix cartes entièrement découvertes et quatre guildes originales.
- Récolte, transport et dépôt ; les villageois cherchent des ressources accessibles
  lorsqu'elles s'épuisent et conservent leur charge s'il manque un entrepôt.
- Construction, réparation, murailles et portes.
- Formations en ligne, en carré et en quinconce, avec destinations individuelles
  et itinéraires partagés. Le choix est conservé lorsque le groupe se déplace.
- Points de ralliement sur les ressources et les potagers : les nouveaux
  travailleurs commencent à récolter dès leur sortie du bâtiment.
- Recrutement, technologies, âges, commerce et limite de 1 000 habitants par cité.
- Chevaliers, archers, assassins, mages, guérisseurs et autres rôles ; animations
  de combat, sang et corps.
- Sauvegarde/chargement JSON, sélection par glisser, groupes et minicarte.
- Analyseur d'ordres en espagnol et outils de page WebMCP.
- Agent vocal facultatif avec un compte et des identifiants propres à l'utilisateur.

Sélectionnez des unités en faisant glisser ; faites un clic droit pour donner un
ordre. Utilisez les cartes du bas pour construire ou entraîner, et la barre
d'espace pour mettre en pause. L'aide du jeu présente d'autres commandes. Avec
plusieurs unités sélectionnées, utilisez les boutons **Ligne**, **Carré** et
**Quinconce** pour les regrouper. Sélectionnez un bâtiment producteur et faites
un clic droit sur une ressource pour y envoyer ses nouveaux travailleurs. Le
panneau de sélection affiche leur charge et indique s'ils récoltent, déposent
ou attendent une ressource ou un entrepôt accessible.

Répéter un ordre de récolte sur la même ressource conserve la tâche,
l'itinéraire et la charge. Pendant une marche offensive, les unités reprennent
leur destination si elles ne peuvent pas atteindre un ennemi détecté
automatiquement. Une attaque explicite conserve la cible que vous avez choisie.

## Voix et WebMCP

Les ordres écrits et le jeu fonctionnent sans clé d'API. La reconnaissance vocale
du navigateur dépend de sa compatibilité et de ses autorisations. Exemples
d'ordres : **« construis une chaumière »**, **« villageois, récoltez du bois »**,
**« forme une ligne »**, **« formation en quinconce »**,
**« déplace les archers en carré vers ma base »** et
**« point de ralliement de la Maison de la Guilde vers la forêt »**. Les
destinations sont résolues d'après le monde actuel. Les ordres s'exécutent
aussitôt, sans confirmation ni besoin de coordonnées ; **« Halte »** arrête
les unités.

Pour l'agent conversationnel, créez votre propre Agent privé sur ElevenLabs et
copiez `.env.example` vers `.env`. Définissez `ELEVENLABS_API_KEY` et
`ELEVENLABS_AGENT_ID`, puis redémarrez le serveur. La clé reste sur le
serveur. L'utilisation du fournisseur est facultative et peut être facturée sur
votre compte. `npm run voice:definition` exporte localement une définition
contenant les outils du jeu ; choisissez votre voix et votre modèle chez le
fournisseur ou via les options de l'exemple. Installer le jeu ne crée aucun
agent et ne passe aucun appel.

La reconnaissance hors ligne est facultative et requiert Python, Vosk, FFmpeg et
un modèle d'espagnol. Configurez `GUILD_PYTHON_PATH`, `GUILD_FFMPEG_PATH` et
`GUILD_VOSK_MODEL_PATH`. Aucun modèle ni enregistrement n'est fourni.

`PLAY-WEBMCP.cmd` lance un Chrome compatible avec le flag WebMCP et un profil
local dédié. Le jeu indique la capacité réellement disponible. Ce profil
possède sa propre sauvegarde : utilisez l'export/import JSON pour transférer une
partie.

## Développement et tests

```sh
npm test
npm run check
npm run build
```

`dist/` contient le client statique généré. Le serveur local inclut les routes
de voix et de reconnaissance hors ligne ; sur Vercel, `api/guild.mjs` sert les
routes de Sota sans dépendre d'un ordinateur allumé. L'inventaire des outils se
trouve dans `docs/voice/clickables.json` ; le contrat du moteur se trouve dans
`docs/engine-interface.md`.

### Déploiement sur Vercel

Importez ce dépôt avec Node 24 et conservez `vercel.json`. Le client est
compilé dans `dist/` ; les routes `/api/*` s'exécutent comme une fonction Node
sans dépendances supplémentaires. Les parties sont sauvegardées dans votre
navigateur ou exportées en JSON. La reconnaissance hors ligne de Vosk reste
disponible dans la version locale ; sur le lien public de Vercel, utilisez la
Voix du navigateur ou écrivez vos ordres.

Activez **Vercel Authentication → Standard Protection** sur le projet. Le
domaine de production permet de jouer sans se connecter. Les adresses uniques
de déploiement restent privées : le Sota personnel n'émet d'autorisations que
depuis l'hôte protégé que Vercel fournit dans `VERCEL_URL`. La voix du navigateur
et les ordres écrits sont disponibles dans le jeu public. Définissez comme variables
de production chiffrées `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`,
`GUILD_PUBLIC_ORIGIN` (l'origine HTTPS exacte), `GUILD_SESSION_SECRET` (aléatoire,
32 caractères au minimum) et `GUILD_DEPLOYMENT_PROTECTION=vercel-auth`.
N'incluez pas leurs valeurs sur GitHub. L'indicateur déclare la protection
configurée ; il ne remplace pas le contrôle d'accès de Vercel. Ne désactivez pas
la protection des adresses uniques si vous activez l'agent payant. Le domaine
public n'émet jamais d'autorisations ElevenLabs, même avec une session et un
CSRF valides.

La session et le CSRF utilisent un cookie signé, HttpOnly, Secure et SameSite.
Les limites d'émission et d'appels simultanés s'appliquent par instance de la
fonction ; elles n'équivalent ni à un quota global ni à une limite de
facturation. Gardez l'accès privé protégé et configurez les limites d'utilisation
chez votre fournisseur. L'appel du client se termine au bout de cinq minutes ou
après 90 secondes d'inactivité.

Il existe deux benchmarks facultatifs de 120 secondes chacun. Exécutez-les
séparément pour ne pas mélanger leur charge :

```sh
npm run benchmark
node scripts/benchmark-formations.mjs
```

Le premier conserve le scénario de combat et d'économie avec 1 000 habitants
par cité ; le second met à l'épreuve les trois formations avec une économie
active. Les rapports locaux générés décrivent le scénario, les mesures et leurs
limites ; aucun résultat privé n'est inclus et les performances sur une autre
machine ne sont pas présumées.

Les tests de navigateur nécessitent d'installer Playwright et son navigateur
séparément ; ce n'est pas une dépendance pour jouer. Il existe des tests de
régression Python du harnais et un runner dans `scripts/run-browser-acceptance.py`.

## État du projet

Il s'agit d'un prototype en développement. La séparation locale pendant les
déplacements est approximative et permet des chevauchements ; l'interpolation
visuelle et l'amélioration du comportement dans les situations denses restent
à faire. Les performances sous forte charge dépendent du scénario et du
matériel. Le harnais complet de navigateur a présenté des problèmes de
fermeture de Chrome/Playwright ; une vérification partielle n'équivaut pas à un
E2E complet.

Le déplacement, les formations et la récolte sont des implémentations
originales. La recherche de référence par REA reste partielle : elle n'a pas
permis de retrouver les algorithmes exacts de navigation, de formation ou de
récolte d'Age of Empires. Aucune équivalence avec son moteur n'est revendiquée.

Ce dépôt contient du code original et des ressources générées. Il ne contient
ni moteur commercial récupéré, ni fichiers d'Age of Empires, ni données de
comptes, ni historique de développement privé, ni clés partagées.

## Licences et contributions

**Code et documentation originaux : MIT. Illustrations incluses : CC BY 4.0**,
avec attribution. Les logiciels tiers conservent leurs licences. Consultez
`LICENSE`, `assets/LICENSE.md` et `THIRD_PARTY_NOTICES.md`.

Vous pouvez utiliser, modifier et redistribuer le projet dans le respect de ces
licences. Les issues et pull requests sont les bienvenues. Pour les modifications
du moteur, incluez un test reproductible et évitez de présenter des mesures
partielles comme une validation complète.
