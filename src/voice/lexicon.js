/**
 * Multilingual command lexicon. Rewrites common orders spoken or typed in en, pt, ja, ar, de
 * and fr into the equivalent Spanish phrasing understood by spanish.js. Anything that does not
 * fully match a foreign rule (including every Spanish sentence) is returned untouched.
 * Unit/building names come from a hand-written table plus, at runtime, the localized names in
 * src/i18n/dict/<lang>/data.js, all mapped back to stable Spanish aliases.
 */
import { DICTIONARIES, getLocale } from '../i18n/index.js';

// Spanish output vocabulary. Every alias is accepted by registry.js (unitKind/buildingKind) or semantic.js.
const ES_UNIT = { villager: ['aldeano', 'aldeanos'], infantry: ['lancero', 'lanceros'], scout: ['explorador', 'exploradores'], archer: ['arquero', 'arqueros'], cavalry: ['jinete', 'jinetes'], heavy_knight: ['caballero pesado', 'caballeros pesados'], assassin: ['asesino', 'asesinos'], mage: ['mago', 'magos'], healer: ['sanador', 'sanadores'], wizard: ['hechicero', 'hechiceros'], siege_engine: ['catapulta', 'catapultas'], fishing_boat: ['barca pesquera', 'barcas pesqueras'], war_boat: ['navio', 'navios'] };
const ES_BUILDING = { house: 'casa', guildhall: 'centro urbano', farm: 'granja', lumber_camp: 'aserradero', mill: 'molino', mining_camp: 'mina', barracks: 'cuartel', archery: 'arqueria', stable: 'establo', arcane_tower: 'torre arcana', sanctuary: 'santuario', forge: 'forja', market: 'mercado', academy: 'academia', watchtower: 'atalaya', fortress: 'fortaleza', palisade: 'empalizada', wall: 'muralla', gate: 'puerta', dock: 'puerto', wonder: 'maravilla', siege_workshop: 'taller de asedio', granary: 'granero', university: 'universidad' };
const ES_RESOURCE = { wood: 'madera', food: 'alimento', gold: 'oro', stone: 'piedra', fish: 'pesca' };
const ES_PLACE = { base: 'mi base', enemyBase: 'base enemiga', forest: 'bosque', nearestEnemy: 'enemigo mas cercano', enemy: 'enemigo', wounded: 'heridos' };
const ES_FORMATION = { line: 'linea', box: 'caja', staggered: 'escalonada' };
const ES_RELATION = { behind: 'detras del', beside: 'junto al', near: 'cerca del', front: 'delante del', north: 'al norte', south: 'al sur', east: 'al este', west: 'al oeste' };
const ES_PHRASE = { stop: 'alto', pause: 'pausa', resume: 'reanuda', save: 'guarda la partida', load: 'carga la partida', status: 'estado', help: 'ayuda', confirm: 'confirma', advanceAge: 'avanza de era', market: 'abre el mercado', research: 'abre el saber', residents: 'habitantes', zoomIn: 'acerca la camara', zoomOut: 'aleja la camara', closePanel: 'cierra el panel' };

/*
 * Word-order languages (en, pt, de, fr, ar). Entries are written naturally and normalized at load.
 * verbs.*: imperative forms only; words that are also Spanish command words are deliberately absent.
 */
const LATIN = {
  en: {
    phrases: { stop: ['stop', 'halt', 'stop all', 'stop everyone', 'stop everything', 'cancel', 'hold'], pause: ['pause', 'pause the game', 'pause game'], resume: ['resume', 'unpause', 'continue', 'resume the game', 'continue the game', 'resume game'], save: ['save', 'save the game', 'save game', 'quick save'], load: ['load', 'load the game', 'load game'], status: ['status', 'report', 'how are we doing', 'city status'], help: ['help', 'controls', 'how to play'], confirm: ['confirm', 'yes', 'do it'], advanceAge: ['advance age', 'next age', 'age up', 'advance to the next age'], market: ['open the market', 'open market'], research: ['open research', 'research'], residents: ['residents', 'population list'], zoomIn: ['zoom in'], zoomOut: ['zoom out'], closePanel: ['close panel', 'close the panel'] },
    verbs: { build: ['build', 'construct', 'erect', 'put up'], gather: ['gather', 'collect', 'harvest', 'chop', 'cut', 'get', 'farm'], move: ['move', 'go', 'walk', 'march', 'send', 'head', 'retreat', 'return'], attack: ['attack', 'assault', 'charge', 'raid'], train: ['train', 'recruit', 'produce', 'make', 'create'], halt: ['stop', 'halt'], select: ['select', 'choose', 'pick'], form: ['form', 'arrange', 'line up', 'group'] },
    articles: ['the', 'a', 'an', 'some', 'all', 'all the', 'every', 'our', 'more'], my: ['my', 'our'], to: ['to', 'toward', 'towards', 'into', 'at', 'in', 'on', 'onto', 'over to'], with: ['with', 'using'],
    of: ['of', 'for', 'from'], inWord: ['in', 'into'], formationWord: ['formation'],
    modifiers: { enemy: ['enemy', 'enemies', 'hostile', 'red'], nearest: ['nearest', 'closest', 'nearby'], idle: ['idle', 'lazy'] },
    relations: { behind: ['behind'], beside: ['next to', 'beside', 'by'], near: ['near', 'close to', 'around'], front: ['in front of'], north: ['north', 'north of', 'to the north', 'to the north of'], south: ['south', 'south of', 'to the south', 'to the south of'], east: ['east', 'east of', 'to the east', 'to the east of'], west: ['west', 'west of', 'to the west', 'to the west of'] },
    rally: ['rally point', 'rally', 'gathering point', 'set rally point', 'set the rally point'],
    formations: { line: ['line', 'a line', 'row'], box: ['box', 'a box', 'square', 'a square', 'block'], staggered: ['staggered', 'zigzag', 'checkerboard'] },
    numbers: { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 },
    places: { base: ['base', 'my base', 'home', 'my town', 'my city', 'our base', 'town'], enemyBase: ['enemy base', 'enemy town', 'enemy city'], forest: ['forest', 'woods', 'trees'], nearestEnemy: ['nearest enemy', 'closest enemy'], enemy: ['enemy', 'enemies'], wounded: ['wounded', 'injured'] },
    units: { villager: ['villager', 'villagers', 'worker', 'workers', 'peasant', 'peasants', 'builder', 'builders'], infantry: ['spearman', 'spearmen', 'infantry', 'guard', 'guards', 'pikeman', 'pikemen', 'soldier', 'soldiers'], scout: ['scout', 'scouts'], archer: ['archer', 'archers', 'bowman', 'bowmen'], cavalry: ['cavalry', 'rider', 'riders', 'horseman', 'horsemen'], heavy_knight: ['heavy knight', 'heavy knights', 'knight', 'knights'], assassin: ['assassin', 'assassins'], mage: ['mage', 'mages'], healer: ['healer', 'healers', 'medic', 'medics'], wizard: ['wizard', 'wizards', 'sorcerer', 'sorcerers'], siege_engine: ['catapult', 'catapults', 'siege engine', 'siege engines'], fishing_boat: ['fishing boat', 'fishing boats', 'fisherman', 'fishermen'], war_boat: ['warship', 'warships', 'war boat', 'war boats'] },
    buildings: { house: ['house', 'houses', 'home'], guildhall: ['town center', 'town centre', 'town hall', 'guild hall', 'guildhall'], farm: ['farm', 'farms', 'field'], lumber_camp: ['lumber camp', 'sawmill', 'lumberyard'], mill: ['mill', 'windmill'], mining_camp: ['mining camp', 'mine'], barracks: ['barracks'], archery: ['archery range', 'archery'], stable: ['stable', 'stables'], arcane_tower: ['arcane tower', 'mage tower'], sanctuary: ['sanctuary', 'temple'], forge: ['forge', 'blacksmith', 'smithy'], market: ['market', 'marketplace'], academy: ['academy'], watchtower: ['watchtower', 'watch tower', 'tower'], fortress: ['fortress', 'castle', 'fort'], palisade: ['palisade', 'wooden wall', 'fence'], wall: ['wall', 'stone wall', 'walls'], gate: ['gate'], dock: ['dock', 'harbor', 'harbour', 'port'], wonder: ['wonder'], siege_workshop: ['siege workshop'], granary: ['granary'], university: ['university'] },
    resources: { wood: ['wood', 'lumber', 'timber', 'trees', 'logs'], food: ['food', 'berries', 'crops'], gold: ['gold'], stone: ['stone', 'stones', 'rock', 'rocks'], fish: ['fish', 'fishing'] },
  },
  pt: {
    phrases: { stop: ['pare', 'parem', 'parar', 'pare tudo', 'cancele', 'cancelar'], pause: ['pausar o jogo', 'pause', 'pause o jogo', 'pausar jogo'], resume: ['retomar', 'retome', 'retome o jogo', 'despausar', 'continue', 'continue o jogo', 'continuar o jogo'], save: ['salvar', 'salve', 'salvar o jogo', 'salve o jogo', 'salvar jogo', 'grave o jogo'], load: ['carregar', 'carregue', 'carregar o jogo', 'carregue o jogo'], status: ['situacao', 'relatorio', 'recursos da cidade', 'como estamos'], help: ['ajuda', 'controles', 'como jogar'], confirm: ['confirme', 'confirmo', 'sim', 'faca isso'], advanceAge: ['avance de era', 'avancar de era', 'proxima era'], market: ['abra o mercado'], research: ['abra a pesquisa', 'pesquisas'], residents: ['moradores', 'lista de moradores'], zoomIn: ['aproxime', 'aproximar'], zoomOut: ['afaste', 'afastar'], closePanel: ['feche o painel', 'fechar painel'] },
    verbs: { build: ['construa', 'construam', 'constroi', 'construa um', 'erga', 'ergam', 'edifique', 'edifiquem', 'levante'], gather: ['colete', 'coletem', 'colha', 'colham', 'recolha', 'recolham', 'junte', 'juntem', 'corte', 'cortem', 'pegue', 'peguem', 'minere'], move: ['mova', 'movam', 'mexa', 'va', 'vao', 'leve', 'levem', 'envie', 'enviem', 'mande', 'marche', 'marchem', 'volte', 'voltem', 'recue'], attack: ['ataque', 'ataquem', 'ataquem a', 'invada', 'invadam'], train: ['treine', 'treinem', 'treinar', 'recrute', 'recrutem', 'produza', 'faca'], halt: ['pare', 'parem'], select: ['selecione', 'selecionar', 'escolha'], form: ['forme', 'formem', 'organize', 'organizem', 'alinhe', 'alinhem'] },
    articles: ['o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'todos', 'todas', 'todos os', 'todas as', 'mais'], my: ['meu', 'minha', 'meus', 'minhas', 'nosso', 'nossa'], to: ['para', 'pra', 'ate', 'ao', 'aos', 'a', 'na', 'no', 'em', 'para o', 'para a', 'rumo a', 'em direcao a'], with: ['com'],
    of: ['do', 'da', 'de', 'dos', 'das'], inWord: ['em', 'na', 'no'], formationWord: ['formacao'],
    modifiers: { enemy: ['inimigo', 'inimiga', 'inimigos', 'inimigas', 'rival', 'vermelho', 'vermelha'], nearest: ['mais proximo', 'mais proxima', 'proximo', 'proxima'], idle: ['ociosos', 'ociosas', 'ocioso', 'ociosa', 'parados', 'desocupados'] },
    relations: { behind: ['atras do', 'atras da', 'atras de'], beside: ['ao lado do', 'ao lado da', 'junto ao', 'junto a'], near: ['perto do', 'perto da', 'perto de', 'proximo ao', 'proximo a'], front: ['na frente do', 'na frente da', 'em frente ao', 'em frente a', 'diante do'], north: ['ao norte', 'ao norte do', 'ao norte da', 'norte'], south: ['ao sul', 'ao sul do', 'ao sul da', 'sul'], east: ['ao leste', 'a leste', 'ao leste do', 'a leste do', 'leste'], west: ['ao oeste', 'a oeste', 'ao oeste do', 'a oeste do', 'oeste'] },
    rally: ['ponto de encontro', 'ponto de reuniao', 'ponto de reagrupamento', 'defina o ponto de encontro', 'coloque o ponto de encontro'],
    formations: { line: ['linha', 'uma linha', 'fila'], box: ['caixa', 'uma caixa', 'quadrado', 'um quadrado', 'bloco'], staggered: ['escalonada', 'escalonado', 'zigue zague', 'xadrez'] },
    numbers: { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, doze: 12, quinze: 15, vinte: 20 },
    places: { base: ['base', 'minha base', 'nossa base', 'casa', 'minha cidade', 'cidade'], enemyBase: ['base inimiga', 'cidade inimiga'], forest: ['floresta', 'mata', 'bosque', 'arvores'], nearestEnemy: ['inimigo mais proximo'], enemy: ['inimigo', 'inimigos'], wounded: ['feridos'] },
    units: { villager: ['aldeao', 'aldeoes', 'aldeaos', 'aldea', 'aldeas', 'trabalhador', 'trabalhadores', 'camponeses', 'campones', 'construtores', 'construtor'], infantry: ['lanceiro', 'lanceiros', 'infantaria', 'guarda', 'guardas', 'soldado', 'soldados'], scout: ['batedor', 'batedores', 'explorador', 'exploradores'], archer: ['arqueiro', 'arqueiros', 'arqueira', 'arqueiras'], cavalry: ['cavaleiro', 'cavaleiros', 'cavalaria', 'ginete', 'ginetes'], heavy_knight: ['cavaleiro pesado', 'cavaleiros pesados'], assassin: ['assassino', 'assassinos', 'assassina', 'assassinas'], mage: ['mago', 'magos', 'maga', 'magas'], healer: ['curandeiro', 'curandeiros', 'curandeira', 'curandeiras', 'curador', 'curadores'], wizard: ['feiticeiro', 'feiticeiros', 'bruxo', 'bruxos'], siege_engine: ['catapulta', 'catapultas'], fishing_boat: ['barco de pesca', 'barcos de pesca', 'pescador', 'pescadores'], war_boat: ['navio de guerra', 'navios de guerra', 'navio', 'navios'] },
    buildings: { house: ['casa', 'casas'], guildhall: ['centro da cidade', 'centro urbano', 'prefeitura', 'sede da guilda'], farm: ['fazenda', 'fazendas', 'horta', 'granja'], lumber_camp: ['serraria', 'acampamento madeireiro'], mill: ['moinho'], mining_camp: ['mina', 'acampamento de mineracao'], barracks: ['quartel'], archery: ['campo de tiro', 'arquearia'], stable: ['estabulo', 'estrebaria'], arcane_tower: ['torre arcana'], sanctuary: ['santuario', 'templo'], forge: ['forja', 'ferraria'], market: ['mercado'], academy: ['academia'], watchtower: ['torre de vigia', 'atalaia', 'torre'], fortress: ['fortaleza', 'castelo', 'forte'], palisade: ['palicada', 'cerca'], wall: ['muralha', 'muro', 'muralha de pedra'], gate: ['portao'], dock: ['porto', 'doca', 'cais'], wonder: ['maravilha'], siege_workshop: ['oficina de cerco'], granary: ['celeiro'], university: ['universidade'] },
    resources: { wood: ['madeira', 'lenha', 'arvores'], food: ['comida', 'alimento', 'alimentos', 'frutas'], gold: ['ouro'], stone: ['pedra', 'pedras'], fish: ['peixe', 'peixes', 'pesca'] },
  },
  de: {
    phrases: { stop: ['halt', 'stopp', 'stop', 'anhalten', 'abbrechen', 'stehen bleiben', 'alle anhalten'], pause: ['pause', 'pausieren', 'spiel pausieren', 'pausiere das spiel'], resume: ['weiter', 'fortsetzen', 'weiterspielen', 'setze das spiel fort', 'spiel fortsetzen'], save: ['speichern', 'speichere', 'spiel speichern', 'speichere das spiel'], load: ['laden', 'lade', 'spiel laden', 'lade das spiel'], status: ['status', 'bericht', 'wie stehen wir', 'lage'], help: ['hilfe', 'steuerung'], confirm: ['bestatigen', 'bestatige', 'ja', 'mach es'], advanceAge: ['nachstes zeitalter', 'zeitalter aufsteigen', 'steige ins nachste zeitalter auf'], market: ['offne den markt', 'markt offnen'], research: ['forschung offnen', 'offne die forschung'], residents: ['bewohner', 'bewohnerliste'], zoomIn: ['heranzoomen', 'zoom rein'], zoomOut: ['herauszoomen', 'zoom raus'], closePanel: ['schliesse das fenster', 'fenster schliessen'] },
    verbs: { build: ['baue', 'bau', 'baut', 'errichte', 'errichtet', 'bauen', 'errichten'], gather: ['sammle', 'sammel', 'sammelt', 'hole', 'hol', 'holt', 'ernte', 'erntet', 'fall', 'falle', 'fallt', 'baue ab', 'sammeln', 'ernten', 'holen'], move: ['bewege', 'beweg', 'bewegt', 'geh', 'gehe', 'geht', 'lauf', 'lauft', 'marschiere', 'marschiert', 'schicke', 'schick', 'schickt', 'zieh', 'zieht', 'kehre zuruck', 'bewegen', 'gehen'], attack: ['greif', 'greife', 'greift', 'attackiere', 'attackiert', 'angreifen', 'sturme', 'sturmt'], train: ['trainiere', 'trainier', 'trainiert', 'bilde aus', 'rekrutiere', 'rekrutiert', 'produziere', 'trainieren', 'rekrutieren'], halt: ['stoppe', 'stopp', 'halte', 'halt'], select: ['wahle', 'wahl', 'wahlt', 'markiere', 'selektiere', 'auswahlen'], form: ['bilde', 'bildet', 'formiere', 'formiert', 'stelle', 'stellt', 'ordne', 'ordnet'] },
    articles: ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines', 'alle', 'all', 'mehr'], my: ['mein', 'meine', 'meinen', 'meinem', 'meiner', 'unser', 'unsere', 'unseren', 'unserem'], to: ['zu', 'zur', 'zum', 'nach', 'in', 'ins', 'in die', 'in den', 'auf', 'an', 'ans', 'bei', 'beim', 'richtung'], with: ['mit'],
    of: ['von', 'vom', 'der', 'des'], inWord: ['in', 'im', 'als'], formationWord: ['formation', 'aufstellung'],
    modifiers: { enemy: ['feindliche', 'feindlichen', 'feindlicher', 'feindliches', 'gegnerische', 'gegnerischen', 'feind', 'rote', 'roten'], nearest: ['nachste', 'nachsten', 'nachster', 'nachstes', 'nahe', 'nahen'], idle: ['untatige', 'untatigen', 'unbeschaftigte', 'unbeschaftigten', 'freie', 'freien', 'mussige'] },
    relations: { behind: ['hinter', 'hinter der', 'hinter dem', 'hinter die', 'hinter den'], beside: ['neben', 'neben der', 'neben dem', 'neben die', 'neben den'], near: ['nahe', 'nahe der', 'nahe dem', 'bei', 'beim', 'in der nahe von', 'in der nahe der', 'in der nahe des'], front: ['vor', 'vor der', 'vor dem', 'vor die', 'vor den'], north: ['im norden', 'nordlich', 'nordlich von', 'nordlich der', 'nordlich des'], south: ['im suden', 'sudlich', 'sudlich von', 'sudlich der', 'sudlich des'], east: ['im osten', 'ostlich', 'ostlich von', 'ostlich der', 'ostlich des'], west: ['im westen', 'westlich', 'westlich von', 'westlich der', 'westlich des'] },
    rally: ['sammelpunkt', 'setze den sammelpunkt', 'sammelpunkt setzen', 'treffpunkt'],
    formations: { line: ['linie', 'eine linie', 'reihe', 'eine reihe'], box: ['block', 'einen block', 'quadrat', 'ein quadrat', 'kasten', 'karree'], staggered: ['gestaffelt', 'gestaffelte', 'gestaffelter', 'staffel', 'zickzack', 'schachbrett'] },
    numbers: { ein: 1, eine: 1, einen: 1, eins: 1, zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, zwolf: 12, funfzehn: 15, zwanzig: 20 },
    places: { base: ['basis', 'meine basis', 'unsere basis', 'stadt', 'meine stadt', 'heimat', 'zuhause', 'hause'], enemyBase: ['feindliche basis', 'feindbasis', 'gegnerische basis', 'basis des feindes', 'feindliche stadt'], forest: ['wald', 'den wald', 'baume'], nearestEnemy: ['nachsten feind', 'nachste feind', 'nachster feind'], enemy: ['feind', 'feinde', 'gegner'], wounded: ['verwundete', 'verwundeten', 'verletzte', 'verletzten'] },
    units: { villager: ['dorfbewohner', 'dorfler', 'arbeiter', 'bauer', 'bauern', 'baumeister', 'siedler'], infantry: ['speertrager', 'lanzentrager', 'infanterie', 'wache', 'wachen', 'soldat', 'soldaten', 'pikenier', 'pikeniere'], scout: ['spaher', 'kundschafter'], archer: ['bogenschutze', 'bogenschutzen', 'bogenschutzin', 'bogenschutzinnen'], cavalry: ['reiter', 'reiterin', 'kavallerie'], heavy_knight: ['schwerer ritter', 'schwere ritter', 'schweren ritter', 'ritter'], assassin: ['assassine', 'assassinen', 'attentater', 'meuchler'], mage: ['magier', 'magierin', 'magierinnen'], healer: ['heiler', 'heilerin', 'heilerinnen', 'sanitater'], wizard: ['zauberer', 'hexer', 'hexenmeister'], siege_engine: ['katapult', 'katapulte', 'belagerungswaffe', 'belagerungswaffen'], fishing_boat: ['fischerboot', 'fischerboote', 'fischer'], war_boat: ['kriegsschiff', 'kriegsschiffe'] },
    buildings: { house: ['haus', 'hauser', 'wohnhaus'], guildhall: ['dorfzentrum', 'stadtzentrum', 'rathaus', 'gildenhaus', 'gildenhalle'], farm: ['farm', 'bauernhof', 'feld', 'acker', 'garten'], lumber_camp: ['holzfallerlager', 'sagewerk'], mill: ['muhle', 'windmuhle'], mining_camp: ['bergbaulager', 'mine', 'bergwerk'], barracks: ['kaserne'], archery: ['schiessstand', 'bogenschiessstand'], stable: ['stall', 'pferdestall'], arcane_tower: ['arkaner turm', 'arkanen turm', 'magierturm'], sanctuary: ['heiligtum', 'tempel'], forge: ['schmiede'], market: ['markt', 'marktplatz'], academy: ['akademie'], watchtower: ['wachturm', 'turm'], fortress: ['festung', 'burg'], palisade: ['palisade', 'holzwall', 'zaun'], wall: ['mauer', 'steinmauer', 'wall'], gate: ['tor'], dock: ['hafen', 'dock', 'anlegestelle'], wonder: ['weltwunder', 'wunder'], siege_workshop: ['belagerungswerkstatt'], granary: ['kornspeicher', 'speicher'], university: ['universitat'] },
    resources: { wood: ['holz', 'baume', 'baumstamme'], food: ['nahrung', 'essen', 'lebensmittel', 'beeren'], gold: ['gold'], stone: ['stein', 'steine'], fish: ['fisch', 'fische'] },
  },
  fr: {
    phrases: { stop: ['arrete', 'arretez', 'arreter', 'halte', 'stop', 'stoppe', 'annule', 'annuler', 'arretez tout'], pause: ['pause', 'mets en pause', 'mettre en pause', 'mets le jeu en pause', 'pause le jeu'], resume: ['reprends', 'reprenez', 'reprendre', 'reprends la partie', 'continue', 'continuez', 'continue la partie', 'relance'], save: ['sauvegarde', 'sauvegarder', 'sauvegarde la partie', 'enregistre', 'enregistrer la partie', 'enregistre la partie'], load: ['charge', 'charger', 'charge la partie', 'charger la partie'], status: ['statut', 'etat', 'rapport', 'ou en sommes nous'], help: ['aide', 'commandes', 'comment jouer'], confirm: ['confirme', 'confirmer', 'oui', 'fais le'], advanceAge: ['passe a l age suivant', 'age suivant', 'avance d age'], market: ['ouvre le marche'], research: ['ouvre la recherche', 'recherches'], residents: ['habitants du village', 'liste des habitants'], zoomIn: ['zoome', 'rapproche la camera'], zoomOut: ['dezoome', 'eloigne la camera'], closePanel: ['ferme le panneau', 'fermer le panneau'] },
    verbs: { build: ['construis', 'construisez', 'construire', 'bati', 'batis', 'batissez', 'batir', 'erige', 'erigez', 'eleve'], gather: ['recolte', 'recoltez', 'recolter', 'ramasse', 'ramassez', 'collecte', 'collectez', 'coupe', 'coupez', 'cueille', 'cueillez', 'extrais', 'va chercher', 'allez chercher'], move: ['deplace', 'deplacez', 'deplacer', 'bouge', 'bougez', 'va', 'allez', 'aller', 'envoie', 'envoyez', 'marche', 'marchez', 'avance', 'avancez', 'retourne', 'retournez', 'rentre', 'rentrez', 'replie toi'], attack: ['attaque', 'attaquez', 'attaquer', 'charge', 'chargez', 'assaille', 'assaillez'], train: ['entraine', 'entrainez', 'entrainer', 'recrute', 'recrutez', 'recruter', 'produis', 'produisez', 'cree', 'creez'], halt: ['arrete', 'arretez', 'stoppe', 'stoppez'], select: ['selectionne', 'selectionnez', 'selectionner', 'choisis', 'choisissez'], form: ['forme', 'formez', 'mets', 'mettez', 'range', 'rangez', 'aligne', 'alignez', 'dispose'] },
    articles: ['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd', 'tous', 'toutes', 'tous les', 'toutes les', 'plus de'], my: ['mon', 'ma', 'mes', 'notre', 'nos'], to: ['a', 'au', 'aux', 'vers', 'jusqu a', 'dans', 'sur', 'en direction de', 'a la', 'chez'], with: ['avec'],
    of: ['du', 'de', 'de la', 'des', 'd'], inWord: ['en'], formationWord: ['formation'],
    modifiers: { enemy: ['ennemi', 'ennemie', 'ennemis', 'ennemies', 'adverse', 'adverses', 'rouge', 'rouges'], nearest: ['plus proche', 'le plus proche', 'la plus proche', 'proche'], idle: ['inactif', 'inactifs', 'inactive', 'inactives', 'oisifs', 'oisif'] },
    relations: { behind: ['derriere', 'derriere le', 'derriere la', 'derriere les'], beside: ['a cote de', 'a cote du', 'pres de la', 'a cote de la', 'le long de'], near: ['pres de', 'pres du', 'proche de', 'proche du', 'aupres de', 'aupres du'], front: ['devant', 'devant le', 'devant la', 'en face de', 'en face du'], north: ['au nord', 'au nord de', 'au nord du', 'nord'], south: ['au sud', 'au sud de', 'au sud du', 'sud'], east: ['a l est', 'a l est de', 'a l est du', 'est'], west: ['a l ouest', 'a l ouest de', 'a l ouest du', 'ouest'] },
    rally: ['point de ralliement', 'point de rassemblement', 'place le point de ralliement', 'mets le point de ralliement', 'definis le point de ralliement'],
    formations: { line: ['ligne', 'une ligne', 'rang', 'un rang'], box: ['carre', 'un carre', 'bloc', 'un bloc', 'boite'], staggered: ['quinconce', 'echelonnee', 'echelonne', 'zigzag', 'damier'] },
    numbers: { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12, quinze: 15, vingt: 20 },
    places: { base: ['base', 'ma base', 'notre base', 'maison', 'ma ville', 'ville', 'village'], enemyBase: ['base ennemie', 'ville ennemie', 'base adverse'], forest: ['foret', 'bois', 'arbres'], nearestEnemy: ['ennemi le plus proche', 'ennemi plus proche'], enemy: ['ennemi', 'ennemis'], wounded: ['blesses'] },
    units: { villager: ['villageois', 'villageoise', 'villageoises', 'ouvrier', 'ouvriers', 'paysan', 'paysans', 'travailleur', 'travailleurs', 'batisseur', 'batisseurs'], infantry: ['lancier', 'lanciers', 'infanterie', 'garde', 'gardes', 'soldat', 'soldats', 'piquier', 'piquiers'], scout: ['eclaireur', 'eclaireurs', 'eclaireuse'], archer: ['archer', 'archers', 'archere', 'archeres'], cavalry: ['cavalier', 'cavaliers', 'cavalerie'], heavy_knight: ['chevalier lourd', 'chevaliers lourds', 'chevalier', 'chevaliers'], assassin: ['assassin', 'assassins', 'assassine'], mage: ['mage', 'mages'], healer: ['guerisseur', 'guerisseurs', 'guerisseuse', 'guerisseuses', 'soigneur', 'soigneurs', 'soigneuse'], wizard: ['sorcier', 'sorciers', 'sorciere', 'enchanteur'], siege_engine: ['catapulte', 'catapultes', 'engin de siege', 'engins de siege'], fishing_boat: ['bateau de peche', 'bateaux de peche', 'pecheur', 'pecheurs'], war_boat: ['navire de guerre', 'navires de guerre', 'navire', 'navires'] },
    buildings: { house: ['maison', 'maisons'], guildhall: ['centre ville', 'hotel de ville', 'forum', 'maison de la guilde', 'centre urbain'], farm: ['ferme', 'fermes', 'potager', 'champ'], lumber_camp: ['camp de bucherons', 'scierie', 'camp forestier'], mill: ['moulin'], mining_camp: ['camp minier', 'mine'], barracks: ['caserne'], archery: ['champ de tir', 'archerie'], stable: ['ecurie', 'ecuries'], arcane_tower: ['tour arcanique', 'tour des arcanes'], sanctuary: ['sanctuaire', 'temple'], forge: ['forge'], market: ['marche'], academy: ['academie'], watchtower: ['tour de guet', 'tour'], fortress: ['forteresse', 'chateau', 'fort'], palisade: ['palissade'], wall: ['muraille', 'mur', 'mur de pierre', 'rempart'], gate: ['porte'], dock: ['port', 'quai', 'embarcadere'], wonder: ['merveille'], siege_workshop: ['atelier de siege'], granary: ['grenier'], university: ['universite'] },
    resources: { wood: ['bois', 'arbres'], food: ['nourriture', 'vivres', 'baies'], gold: ['or'], stone: ['pierre', 'pierres'], fish: ['poisson', 'poissons', 'peche'] },
  },
  ar: {
    phrases: { stop: ['توقف', 'توقفوا', 'قف', 'قفوا', 'الغاء', 'الغ', 'اوقف الكل', 'توقفوا جميعا'], pause: ['ايقاف مؤقت', 'توقف مؤقتا', 'اوقف اللعبه مؤقتا', 'اوقف اللعبه'], resume: ['استئناف', 'استانف', 'استانف اللعبه', 'تابع', 'تابع اللعبه', 'استمر', 'واصل'], save: ['احفظ', 'حفظ', 'احفظ اللعبه', 'حفظ اللعبه'], load: ['حمل', 'تحميل', 'حمل اللعبه', 'تحميل اللعبه'], status: ['الحاله', 'حاله المدينه', 'الموارد', 'تقرير'], help: ['مساعده', 'ساعدني', 'التحكم'], confirm: ['تاكيد', 'اكد', 'نعم', 'افعل ذلك'], advanceAge: ['تقدم عصرا', 'العصر التالي', 'انتقل الى العصر التالي'], market: ['افتح السوق'], research: ['افتح الابحاث', 'الابحاث'], residents: ['السكان', 'قائمه السكان'], zoomIn: ['قرب الكاميرا', 'تكبير'], zoomOut: ['ابعد الكاميرا', 'تصغير'], closePanel: ['اغلق اللوحه'] },
    verbs: { build: ['ابن', 'ابني', 'ابنوا', 'شيد', 'شيدوا', 'انشئ', 'انشئوا', 'اقم', 'اقيموا'], gather: ['اجمع', 'اجمعوا', 'اجمعي', 'احصد', 'احصدوا', 'اقطع', 'اقطعوا', 'احتطب', 'احتطبوا', 'التقط', 'استخرج', 'اجلب', 'اجلبوا'], move: ['تحرك', 'تحركوا', 'اذهب', 'اذهبوا', 'انتقل', 'انتقلوا', 'سر', 'سيروا', 'امش', 'امشوا', 'ارسل', 'حرك', 'عد', 'عودوا', 'تقدم', 'تقدموا', 'انسحب'], attack: ['هاجم', 'هاجموا', 'اهجم', 'اهجموا', 'اغز'], train: ['درب', 'دربوا', 'جند', 'جندوا', 'اصنع', 'انتج'], halt: ['اوقف', 'اوقفوا', 'اوقفي'], select: ['اختر', 'اختاروا', 'حدد', 'حددوا'], form: ['شكل', 'شكلوا', 'اصطف', 'اصطفوا', 'رتب', 'رتبوا', 'نظم', 'نظموا'] },
    articles: ['كل', 'جميع', 'بعض', 'يا'], my: [], to: ['الى', 'نحو', 'في', 'عند', 'باتجاه', 'حتى', 'على'], with: ['ب', 'مع'],
    of: ['ل', 'من', 'التابعه ل'], inWord: ['في', 'ب', 'على شكل'], formationWord: ['تشكيل', 'تشكيله', 'صف'],
    modifiers: { enemy: ['العدو', 'عدو', 'الاعداء', 'المعاديه', 'المعادي', 'معاديه', 'معادي', 'الحمراء', 'الاحمر'], nearest: ['اقرب', 'الاقرب', 'القريب', 'القريبه'], idle: ['الخاملين', 'الخامله', 'خاملين', 'العاطلين', 'العاطله', 'الفارغين'] },
    relations: { behind: ['خلف', 'وراء'], beside: ['بجانب', 'جانب', 'بجوار', 'جوار'], near: ['قرب', 'بالقرب من', 'قريبا من', 'عند'], front: ['امام', 'قدام'], north: ['شمال', 'شمالا', 'في الشمال', 'الى الشمال', 'الى الشمال من', 'شمال'], south: ['جنوب', 'جنوبا', 'في الجنوب', 'الى الجنوب', 'الى الجنوب من'], east: ['شرق', 'شرقا', 'في الشرق', 'الى الشرق', 'الى الشرق من'], west: ['غرب', 'غربا', 'في الغرب', 'الى الغرب', 'الى الغرب من'] },
    rally: ['نقطه التجمع', 'اجعل نقطه التجمع', 'حدد نقطه التجمع', 'ضع نقطه التجمع', 'نقطه الالتقاء'],
    formations: { line: ['خط', 'صف', 'خط مستقيم', 'صف واحد'], box: ['مربع', 'صندوق', 'كتله'], staggered: ['متدرج', 'متدرجه', 'متعرج', 'متعرجه', 'متناوب', 'متناوبه', 'متداخل'] },
    numbers: { واحد: 1, واحدا: 1, اثنين: 2, اثنان: 2, ثلاثه: 3, ثلاث: 3, اربعه: 4, اربع: 4, خمسه: 5, خمس: 5, سته: 6, ست: 6, سبعه: 7, سبع: 7, ثمانيه: 8, ثماني: 8, تسعه: 9, تسع: 9, عشره: 10, عشر: 10 },
    places: { base: ['قاعدتي', 'قاعدتنا', 'قاعده', 'مدينتي', 'مدينتنا', 'المنزل', 'الديار'], enemyBase: ['قاعده العدو', 'قاعده الاعداء', 'القاعده المعاديه', 'مدينه العدو'], forest: ['غابه', 'اشجار'], nearestEnemy: ['اقرب عدو'], enemy: ['عدو', 'اعداء'], wounded: ['جرحى', 'مصابين', 'مصابون'] },
    units: { villager: ['قروي', 'قرويا', 'قرويين', 'قرويون', 'فلاح', 'فلاحين', 'عامل', 'عمال', 'بناء', 'بنائين'], infantry: ['رماح', 'حامل رمح', 'حمله رماح', 'مشاه', 'حارس', 'حراس', 'جندي', 'جنود'], scout: ['كشاف', 'كشافه', 'كشافين', 'مستطلع', 'مستطلعين'], archer: ['رامي', 'رماه', 'رامي سهام', 'رماه سهام', 'نبال', 'نبالين', 'رامية'], cavalry: ['خيال', 'خياله', 'فارس', 'فرسان'], heavy_knight: ['فارس ثقيل', 'فرسان ثقال', 'فارس مدرع', 'فرسان مدرعين'], assassin: ['قاتل', 'قتله', 'مغتال', 'مغتالين', 'قاتله'], mage: ['ساحر', 'سحره', 'ساحره'], healer: ['معالج', 'معالجين', 'معالجه', 'طبيب', 'اطباء', 'شافي'], wizard: ['مشعوذ', 'مشعوذين', 'عراف', 'عرافين'], siege_engine: ['منجنيق', 'مجانيق', 'اله حصار'], fishing_boat: ['قارب صيد', 'قوارب صيد', 'صياد', 'صيادين'], war_boat: ['سفينه حربيه', 'سفن حربيه', 'سفينه حرب'] },
    buildings: { house: ['منزل', 'منزلا', 'بيت', 'بيتا', 'منازل', 'بيوت'], guildhall: ['مركز مدينه', 'مركز بلده', 'دار نقابه', 'قاعه نقابه'], farm: ['مزرعه', 'مزارع', 'حقل', 'بستان'], lumber_camp: ['معسكر خشب', 'منشره', 'معسكر حطابين'], mill: ['طاحونه', 'مطحنه'], mining_camp: ['منجم', 'معسكر تعدين'], barracks: ['ثكنه', 'ثكنات'], archery: ['ميدان رمايه', 'ساحه رمايه'], stable: ['اسطبل'], arcane_tower: ['برج سحري', 'برج اسرار'], sanctuary: ['معبد', 'محراب', 'ملاذ'], forge: ['حداده', 'مصهر', 'ورشه حداده'], market: ['سوق'], academy: ['اكاديميه'], watchtower: ['برج مراقبه', 'برج'], fortress: ['قلعه', 'حصن'], palisade: ['سياج', 'سياج خشبي'], wall: ['سور', 'جدار', 'سور حجري'], gate: ['بوابه'], dock: ['ميناء', 'مرفا', 'رصيف'], wonder: ['اعجوبه'], siege_workshop: ['ورشه حصار'], granary: ['مخزن حبوب', 'صومعه'], university: ['جامعه'] },
    resources: { wood: ['خشب', 'حطب', 'اشجار'], food: ['طعام', 'غذاء', 'اكل'], gold: ['ذهب'], stone: ['حجر', 'حجاره', 'صخر'], fish: ['سمك', 'اسماك', 'صيد'] },
  },
};

/* Japanese: particle-based, verb last. Entries are compared after NFKC normalization. */
const JA = {
  phrases: { stop: ['止まれ', '止まって', 'ストップ', '停止', '止まる', 'やめて', '中止', '全員止まれ', '全員停止', 'キャンセル'], pause: ['一時停止', 'ポーズ', 'ゲームを一時停止', '一時停止して', 'ポーズして'], resume: ['再開', '再開して', 'ゲームを再開', 'ゲームを再開して', '続けて', '続行'], save: ['保存', '保存して', 'セーブ', 'セーブして', 'ゲームを保存', 'ゲームを保存して'], load: ['ロード', 'ロードして', '読み込み', '読み込んで', 'ゲームを読み込んで'], status: ['状態', 'ステータス', '資源', '状況', '報告'], help: ['ヘルプ', '助けて', '操作方法'], confirm: ['確認', 'はい', '確定', 'やって'], advanceAge: ['時代を進めて', '次の時代', '時代を上げて', '時代進化'], market: ['市場を開いて'], research: ['研究を開いて', '研究'], residents: ['住民', '住民一覧'], zoomIn: ['ズームイン', '近づけて'], zoomOut: ['ズームアウト', '遠ざけて'], closePanel: ['パネルを閉じて'] },
  verbs: { build: ['建てて', '建てろ', '建てる', '建設して', '建設しろ', '建設', '建造して', '作って', '造って', '建築して'], gather: ['集めて', '集めろ', '集める', '採取して', '採集して', '収集して', '伐採して', '採掘して', '掘って', '取ってきて', '取って', '刈って', '獲って'], move: ['移動して', '移動しろ', '移動', '行って', '行け', '向かって', '向かえ', '進んで', '進め', '動いて', '動け', '戻って', '戻れ', '送って', '帰って', '退却して'], attack: ['攻撃して', '攻撃しろ', '攻撃', '攻めて', '攻めろ', '襲って', '突撃して', '突撃'], train: ['訓練して', '訓練しろ', '訓練', '生産して', '生産', '雇って', '育てて', '募集して', '作成して'], halt: ['止めて', '止まらせて', '停止させて'], select: ['選択して', '選んで', '選択'], form: ['並べて', '並んで', '並べ', '組んで', '整列して', '整列', '配置して'] },
  modifiers: { enemy: ['敵の', '敵'], nearest: ['一番近い', '最も近い', '最寄りの', '近くの'], idle: ['待機中の', '暇な', '手の空いた', '働いていない'], all: ['すべての', '全ての', '全部の', '全員の', '全'], my: ['自分の', '私の', '僕の', '俺の', '味方の', 'うちの'] },
  relations: { behind: ['の後ろ', 'の裏', 'のうしろ'], beside: ['の隣', 'の横', 'のそば'], near: ['の近く', 'の付近', 'の周り', 'の傍'], front: ['の前', 'の正面'], north: ['の北', '北'], south: ['の南', '南'], east: ['の東', '東'], west: ['の西', '西'] },
  rally: ['集合地点', '集結地点', 'ラリーポイント', '集合場所'],
  formations: { line: ['横一列', '一列', '横隊', 'ライン', '列', '線'], box: ['方陣', '箱型', '四角', 'ボックス', '方形', '密集'], staggered: ['千鳥', '千鳥足', 'ずらし', '段違い', '互い違い', '斜め'] },
  formationWord: ['陣形', '隊形', 'フォーメーション'],
  places: { base: ['基地', '拠点', '本拠地', '本拠', '自陣', '自分の基地', '私の基地', '味方の基地', '町'], enemyBase: ['敵の基地', '敵基地', '敵の拠点', '敵陣', '敵の町'], forest: ['森', '林'], nearestEnemy: ['一番近い敵', '最も近い敵', '近くの敵'], enemy: ['敵'], wounded: ['負傷者', 'けが人', '怪我人'] },
  units: { villager: ['村人', '農民', '労働者', '作業員', '建築者'], infantry: ['槍兵', '歩兵', '衛兵', '兵士', '槍使い'], scout: ['斥候', '偵察兵', 'スカウト'], archer: ['弓兵', '弓使い', 'アーチャー', '射手'], cavalry: ['騎兵', '騎手', '騎馬兵'], heavy_knight: ['重騎士', '重装騎士', '騎士'], assassin: ['暗殺者', 'アサシン'], mage: ['魔術師', '魔法使い', 'メイジ', '魔導士'], healer: ['治療師', 'ヒーラー', '癒し手', '回復役', '僧侶'], wizard: ['呪術師', 'ウィザード', '妖術師'], siege_engine: ['投石機', 'カタパルト', '攻城兵器'], fishing_boat: ['漁船', '釣り船'], war_boat: ['軍船', '戦艦', '戦船'] },
  buildings: { house: ['家', '民家', '住宅', '家屋'], guildhall: ['町の中心', 'タウンセンター', 'ギルドホール', '町役場', '本部'], farm: ['農場', '畑', '菜園'], lumber_camp: ['製材所', '伐採所', '木こり小屋'], mill: ['製粉所', '風車', '粉ひき小屋'], mining_camp: ['採掘所', '鉱山', '鉱山キャンプ'], barracks: ['兵舎', '兵営'], archery: ['射撃場', '弓兵舎', '弓術場'], stable: ['厩舎', '馬小屋'], arcane_tower: ['魔法の塔', '秘術の塔', '魔術塔'], sanctuary: ['聖域', '神殿', '聖堂'], forge: ['鍛冶場', '鍛冶屋'], market: ['市場', 'マーケット'], academy: ['アカデミー', '学院'], watchtower: ['見張り塔', '物見櫓', '監視塔', '塔'], fortress: ['要塞', '城', '砦'], palisade: ['柵', '木柵'], wall: ['城壁', '石壁', '壁'], gate: ['門'], dock: ['港', '船着き場', '波止場', 'ドック'], wonder: ['不思議', '驚異', 'ワンダー'], siege_workshop: ['攻城工房'], granary: ['穀物庫', '穀倉'], university: ['大学'] },
  resources: { wood: ['木', '木材', '材木', '薪'], food: ['食料', '食べ物', '食糧'], gold: ['金', 'ゴールド', '金貨'], stone: ['石', '石材', '岩'], fish: ['魚', '漁'] },
  numbers: { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, ひとり: 1, 一人: 1, 二人: 2, ふたり: 2 },
};

/* Normalization. */
const ARABIC_MARKS = /[ً-ٰٟـ]/gu;
const ARABIC_DIGITS = /[٠-٩۰-۹]/gu;
function arabicDigits(text) { return text.replace(ARABIC_DIGITS, digit => String((digit.charCodeAt(0) & 0xF) % 10)); }
function normLatin(text) {
  return String(text || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/ß/gu, 'ss').replace(/[’'`´]/gu, ' ').replace(/[¿?¡!.,;:«»"“”()]/gu, ' ').replace(/\s+/gu, ' ').trim();
}
function normArabic(text) {
  return arabicDigits(String(text || '').normalize('NFKC')).replace(ARABIC_MARKS, '').replace(/[أإآٱ]/gu, 'ا').replace(/ى/gu, 'ي').replace(/ة/gu, 'ه').replace(/ؤ/gu, 'و').replace(/ئ/gu, 'ي')
    .replace(/[،؛؟!.,;:«»"()]/gu, ' ').replace(/\s+/gu, ' ').trim().toLowerCase();
}
// Arabic tables compare words without the article/clitics and the accusative alif.
function arabicStem(word) {
  let w = word;
  for (const prefix of ['وال', 'بال', 'فال', 'كال', 'لل', 'ال']) if (w.startsWith(prefix) && w.length - prefix.length >= 2) { w = w.slice(prefix.length); break; }
  if (w.length > 3 && w.endsWith('ا')) w = w.slice(0, -1);
  return w;
}
const normJa = text => String(text || '').normalize('NFKC').replace(/[\s、。，．！？!?,.・「」『』]/gu, '').trim();

/* Compiled language models (lazy). */
const compiled = new Map();
function phraseIndex(groups, norm, stem) {
  const map = new Map();
  for (const [id, list] of Object.entries(groups)) for (const entry of list) { const key = stem(norm(entry)); if (key && !map.has(key)) map.set(key, id); }
  return map;
}
function dictionaryNames(code, norm, stem) {
  // Localized display names from src/i18n/dict/<code>/data.js, filled by translators.
  const table = DICTIONARIES[code] || {}, units = {}, buildings = {}, resources = {};
  for (const [key, value] of Object.entries(table)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const match = key.match(/^data\.(unit|building|resource)\.(\w+)$/u);
    if (!match) continue;
    const target = match[1] === 'unit' ? units : match[1] === 'building' ? buildings : resources;
    (target[match[2]] ||= []).push(value);
  }
  return { units: phraseIndex(units, norm, stem), buildings: phraseIndex(buildings, norm, stem), resources: phraseIndex(resources, norm, stem) };
}
const normArabicWords = text => normArabic(text).split(' ').map(arabicStem).join(' ');
function compileLatin(code) {
  // Arabic input and tables are both reduced to stems, so every comparison below is plain equality.
  const source = LATIN[code], norm = code === 'ar' ? normArabicWords : normLatin;
  const stemWords = value => value;
  const list = values => [...new Set(values.map(norm))].sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length);
  const fromDictionary = dictionaryNames(code, norm, stemWords);
  const merge = (hand, derived) => { const map = phraseIndex(hand, norm, stemWords); for (const [key, id] of derived) if (!map.has(key)) map.set(key, id); return map; };
  const plural = new Set();
  for (const values of Object.values(source.units)) values.forEach((value, index) => { if (index % 2 === 1 || /s$/u.test(norm(value))) plural.add(stemWords(norm(value))); });
  return {
    code, norm, stem: stemWords,
    phrases: phraseIndex(source.phrases, norm, value => value),
    verbs: Object.fromEntries(Object.entries(source.verbs).map(([key, values]) => [key, list(values)])),
    articles: list(source.articles), my: list(source.my), to: list(source.to), with: list(source.with), of: list(source.of), inWord: list(source.inWord), formationWord: list(source.formationWord),
    modifiers: Object.fromEntries(Object.entries(source.modifiers).map(([key, values]) => [key, list(values)])),
    relations: Object.entries(source.relations).flatMap(([id, values]) => values.map(value => ({ id, words: norm(value).split(' ') }))).sort((a, b) => b.words.length - a.words.length),
    rally: list(source.rally),
    formations: Object.entries(source.formations).flatMap(([id, values]) => values.map(value => ({ id, words: norm(value).split(' ') }))).sort((a, b) => b.words.length - a.words.length),
    numbers: Object.fromEntries(Object.entries(source.numbers).map(([word, value]) => [norm(word), value])),
    places: phraseIndex(source.places, norm, stemWords),
    units: merge(source.units, fromDictionary.units), plural,
    buildings: merge(source.buildings, fromDictionary.buildings),
    resources: merge(source.resources, fromDictionary.resources),
  };
}
function model(code) { if (!compiled.has(code)) compiled.set(code, code === 'ja' ? compileJa() : compileLatin(code)); return compiled.get(code); }

/* Token helpers for word-order languages. */
const startsWith = (tokens, words, at = 0) => words.length && words.every((word, index) => tokens[at + index] === word);
function stripLeading(tokens, phrases) {
  let rest = tokens, changed = true;
  while (changed && rest.length) {
    changed = false;
    for (const phrase of phrases) { const words = phrase.split(' '); if (startsWith(rest, words) && rest.length > words.length) { rest = rest.slice(words.length); changed = true; break; } }
  }
  return rest;
}
function takeLeading(tokens, phrases) {
  for (const phrase of phrases) { const words = phrase.split(' '); if (startsWith(tokens, words)) return { words, rest: tokens.slice(words.length) }; }
  return null;
}
function removeEverywhere(tokens, phrases) {
  let found = false; const out = [];
  for (let index = 0; index < tokens.length;) {
    const hit = phrases.find(phrase => startsWith(tokens, phrase.split(' '), index));
    if (hit) { found = true; index += hit.split(' ').length; } else out.push(tokens[index++]);
  }
  return { found, tokens: out };
}
function lookup(L, tokens, table) { return tokens.length ? table.get(L.stem(tokens.join(' '))) : undefined; }

/** Translates a noun phrase. Returns { text, kind?, type? }; unknown words (personal names) pass through. */
function nounPhrase(L, input, prefer = null) {
  let tokens = stripLeading(input, L.articles);
  if (!tokens.length) return null;
  // Words such as "house"/"casa"/"maison" are both a building and "home": the verb decides.
  if (prefer === 'building') { const kind = lookup(L, stripLeading(tokens, L.my), L.buildings); if (kind) return { text: ES_BUILDING[kind], type: 'building', kind }; }
  const whole = lookup(L, tokens, L.places);
  if (whole) return { text: ES_PLACE[whole], type: 'place', id: whole };
  const enemy = removeEverywhere(tokens, L.modifiers.enemy); tokens = enemy.tokens;
  const nearest = removeEverywhere(tokens, L.modifiers.nearest); tokens = nearest.tokens;
  const idle = removeEverywhere(tokens, L.modifiers.idle); tokens = idle.tokens;
  tokens = stripLeading(tokens, [...L.articles, ...L.my]);
  // Arabic idafa and Latin "of the enemy": a trailing preposition left after removing the modifier.
  while (tokens.length > 1 && L.of.includes(tokens.at(-1))) tokens = tokens.slice(0, -1);
  const suffix = `${nearest.found ? ' mas cercano' : ''}${idle.found ? ' inactivos' : ''}`;
  if (!tokens.length) return enemy.found ? { text: nearest.found ? ES_PLACE.nearestEnemy : ES_PLACE.enemy, type: 'place' } : null;
  const place = lookup(L, tokens, L.places);
  if (place === 'base' && enemy.found) return { text: ES_PLACE.enemyBase, type: 'place', id: 'enemyBase' };
  if (place) return { text: `${ES_PLACE[place]}${enemy.found && place !== 'enemy' ? ' enemigo' : ''}${suffix}`, type: 'place', id: place };
  const unit = lookup(L, tokens, L.units);
  if (unit) { const many = L.plural.has(L.stem(tokens.join(' '))); return { text: `${ES_UNIT[unit][1]}${enemy.found ? ' enemigos' : ''}${suffix}`, type: 'unit', kind: unit, plural: many }; }
  const building = lookup(L, tokens, L.buildings);
  if (building) return { text: `${ES_BUILDING[building]}${enemy.found ? ' enemigo' : ''}${suffix}`, type: 'building', kind: building };
  const resource = lookup(L, tokens, L.resources);
  if (resource) return { text: `${ES_RESOURCE[resource]}${suffix}`, type: 'resource', kind: resource };
  unknownWords++;
  return { text: `${tokens.join(' ')}${enemy.found ? ' enemigo' : ''}${suffix}`, type: 'name' };
}
// Unrecognized noun phrases in the current attempt; the language with the fewest wins.
let unknownWords = 0;
/** Location for construction: relation + landmark, a direction, or a plain landmark ("en X"). */
function location(L, tokens) {
  if (!tokens.length) return '';
  for (const relation of L.relations) {
    if (!startsWith(tokens, relation.words)) continue;
    const rest = stripLeading(tokens.slice(relation.words.length), L.of), es = ES_RELATION[relation.id];
    if (['north', 'south', 'east', 'west'].includes(relation.id)) { const landmark = rest.length ? nounPhrase(L, rest) : null; return landmark ? `${es} del ${landmark.text}` : es; }
    const landmark = nounPhrase(L, rest); return landmark ? `${es} ${landmark.text}` : null;
  }
  const to = takeLeading(tokens, L.to), np = nounPhrase(L, to ? to.rest : tokens);
  return np ? `en ${np.text}` : null;
}
/** Destination for movement and rally: "(to) X". */
function destination(L, tokens) {
  const to = takeLeading(tokens, L.to);
  const np = nounPhrase(L, to ? to.rest : tokens);
  return np?.text || null;
}
/** Removes a formation phrase anywhere ("in a line", "in box formation", "line formation"). */
function extractFormation(L, tokens) {
  for (let index = 0; index < tokens.length; index++) {
    for (const formation of L.formations) {
      if (!startsWith(tokens, formation.words, index)) continue;
      let start = index, end = index + formation.words.length;
      for (const word of L.formationWord) { const words = word.split(' '); if (startsWith(tokens, words, end)) end += words.length; else if (start >= words.length && startsWith(tokens, words, start - words.length)) start -= words.length; }
      for (const article of L.articles) { const words = article.split(' '); if (start >= words.length && startsWith(tokens, words, start - words.length)) { start -= words.length; break; } }
      for (const word of L.inWord) { const words = word.split(' '); if (start >= words.length && startsWith(tokens, words, start - words.length)) { start -= words.length; break; } }
      for (const word of L.formationWord) { const words = word.split(' '); if (start >= words.length && startsWith(tokens, words, start - words.length)) { start -= words.length; break; } }
      return { id: formation.id, tokens: [...tokens.slice(0, start), ...tokens.slice(end)] };
    }
  }
  return null;
}
function findVerb(L, tokens) {
  let best = null;
  for (const [category, verbs] of Object.entries(L.verbs)) {
    for (const verb of verbs) {
      const words = verb.split(' ');
      for (let index = 0; index < tokens.length; index++) {
        if (!startsWith(tokens, words, index)) continue;
        if (!best || index < best.index || (index === best.index && words.length > best.words.length)) best = { category, index, words };
        break;
      }
    }
  }
  return best;
}
function parseNumber(L, token) {
  if (/^\d+$/u.test(token || '')) return Number(token);
  return L.numbers[token];
}
const join = (...parts) => parts.filter(Boolean).join(' ');

function rewriteLatin(L, text) {
  const normalized = L.norm(text);
  if (!normalized) return null;
  const fixed = L.phrases.get(normalized);
  if (fixed) return ES_PHRASE[fixed];
  let tokens = normalized.split(' ');
  // Vocative particles ("يا لونا") and politeness words carry no order.
  tokens = tokens.filter(token => !['please', 'por favor', 'bitte', 'svp', 'stp', 'من فضلك', 'رجاء'].includes(token));
  if (!tokens.length) return null;

  // Rally point: "(set) rally point (of X) (to) Y".
  for (let index = 0; index < tokens.length; index++) {
    const rally = L.rally.find(phrase => startsWith(tokens, phrase.split(' '), index));
    if (!rally) continue;
    let rest = tokens.slice(index + rally.split(' ').length), building = null;
    const of = takeLeading(rest, L.of);
    if (of) {
      const toIndex = of.rest.findIndex((_, at) => L.to.some(word => startsWith(of.rest, word.split(' '), at)));
      if (toIndex > 0) { building = nounPhrase(L, of.rest.slice(0, toIndex)); rest = of.rest.slice(toIndex); }
    }
    const target = destination(L, rest);
    return target ? `punto de reunion${building ? ` del ${building.text}` : ''} a ${target}` : null;
  }

  const verb = findVerb(L, tokens);
  // Formation without a verb: "line formation", "in a box".
  if (!verb) {
    const formation = extractFormation(L, tokens);
    if (formation && !formation.tokens.length) return `forma en ${ES_FORMATION[formation.id]}`;
    return null;
  }
  let before = tokens.slice(0, verb.index), after = tokens.slice(verb.index + verb.words.length);
  if (L.code === 'de' && after.at(-1) === 'an') after = after.slice(0, -1); // separable "greif ... an"
  if (L.code === 'de' && after.at(-1) === 'ab') after = after.slice(0, -1);
  if (L.code === 'de' && after.at(-1) === 'aus') { after = after.slice(0, -1); if (verb.category === 'form') verb.category = 'train'; }
  // Verb-final word order (German infinitives "ein Haus bauen"): the object precedes the verb.
  const objectFirst = !after.length && before.length;
  const subject = () => (before.length ? nounPhrase(L, before)?.text : '');

  switch (verb.category) {
    case 'gather': {
      const object = objectFirst ? before : after;
      const resource = nounPhrase(L, object);
      if (resource?.type !== 'resource' && resource?.id !== 'forest') return null;
      return join(objectFirst ? '' : subject(), 'recoge', resource.type === 'resource' ? ES_RESOURCE[resource.kind] : ES_RESOURCE.wood);
    }
    case 'build': {
      const object = stripLeading(objectFirst ? before : after, L.articles);
      // Longest leading phrase naming a building; the remainder is the location.
      for (let length = object.length; length > 0; length--) {
        const np = nounPhrase(L, object.slice(0, length), 'building');
        if (np?.type !== 'building') continue;
        const where = location(L, object.slice(length));
        if (where === null) return null;
        return join(objectFirst ? '' : subject(), 'construye', ES_BUILDING[np.kind], where);
      }
      return null;
    }
    case 'train': {
      let object = objectFirst ? before : after, quantity = 1;
      const number = parseNumber(L, object[0]);
      if (number !== undefined && object.length > 1) { quantity = number; object = object.slice(1); }
      const at = object.findIndex((_, index) => index > 0 && L.to.some(word => startsWith(object, word.split(' '), index)));
      const unitTokens = at > 0 ? object.slice(0, at) : object;
      const np = nounPhrase(L, unitTokens);
      if (np?.type !== 'unit') return null;
      const where = at > 0 ? destination(L, object.slice(at)) : null;
      return join('entrena', String(quantity), ES_UNIT[np.kind][quantity === 1 ? 0 : 1], where ? `en ${where}` : '');
    }
    case 'attack': {
      const object = objectFirst ? before : after;
      const enemy = object.length ? nounPhrase(L, stripLeading(object, L.to)) : null;
      return join(objectFirst ? '' : subject(), 'ataca', enemy?.text || '');
    }
    case 'form': {
      const formation = extractFormation(L, [...before, ...after]);
      if (!formation) return null;
      const rest = formation.tokens.filter(token => !L.articles.includes(token));
      const toIndex = rest.findIndex((_, index) => L.to.some(word => startsWith(rest, word.split(' '), index)));
      const targetTokens = toIndex >= 0 ? rest.slice(0, toIndex) : rest;
      const target = targetTokens.length ? nounPhrase(L, targetTokens)?.text : '';
      const goal = toIndex >= 0 ? destination(L, rest.slice(toIndex)) : '';
      return join('forma', target, 'en', ES_FORMATION[formation.id], goal ? `a ${goal}` : '');
    }
    case 'move': {
      const formation = extractFormation(L, after);
      let rest = formation ? formation.tokens : after;
      if (objectFirst) return null;
      const toIndex = rest.findIndex((_, index) => L.to.some(word => startsWith(rest, word.split(' '), index)));
      if (toIndex < 0) return null;
      const target = toIndex > 0 ? nounPhrase(L, rest.slice(0, toIndex))?.text : '';
      const goal = destination(L, rest.slice(toIndex));
      if (!goal) return null;
      return join(subject(), 'mueve', target, formation ? `en ${ES_FORMATION[formation.id]}` : '', `a ${goal}`);
    }
    case 'halt': {
      const object = objectFirst ? before : after;
      const np = object.length ? nounPhrase(L, object) : null;
      return np ? `deten ${np.text}` : ES_PHRASE.stop;
    }
    case 'select': {
      const np = nounPhrase(L, objectFirst ? before : after);
      return np ? `selecciona ${np.text}` : null;
    }
    default: return null;
  }
}

/* Japanese. */
function compileJa() {
  const norm = normJa, id = value => value;
  const sorted = values => [...new Set(values.map(norm))].sort((a, b) => b.length - a.length);
  const fromDictionary = dictionaryNames('ja', norm, id);
  const merge = (hand, derived) => { const map = phraseIndex(hand, norm, id); for (const [key, kind] of derived) if (!map.has(key)) map.set(key, kind); return map; };
  return {
    code: 'ja', norm,
    phrases: phraseIndex(JA.phrases, norm, id),
    verbs: Object.entries(JA.verbs).flatMap(([category, values]) => sorted(values).map(verb => ({ category, verb }))).sort((a, b) => b.verb.length - a.verb.length),
    modifiers: Object.fromEntries(Object.entries(JA.modifiers).map(([key, values]) => [key, sorted(values)])),
    relations: Object.entries(JA.relations).flatMap(([relation, values]) => sorted(values).map(value => ({ relation, value }))).sort((a, b) => b.value.length - a.value.length),
    rally: sorted(JA.rally), formationWord: sorted(JA.formationWord),
    formations: Object.entries(JA.formations).flatMap(([formation, values]) => sorted(values).map(value => ({ formation, value }))).sort((a, b) => b.value.length - a.value.length),
    places: phraseIndex(JA.places, norm, id), units: merge(JA.units, fromDictionary.units), buildings: merge(JA.buildings, fromDictionary.buildings), resources: merge(JA.resources, fromDictionary.resources),
  };
}
const JA_COUNTER = /(\d+|[一二三四五六七八九十]+)(?:人|体|名|隻|つ|個|機|騎)?/u;
function jaNumber(value) {
  if (/^\d+$/u.test(value)) return Number(value);
  const digits = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === '十') return 10;
  if (value.length === 2 && value[0] === '十') return 10 + digits[value[1]];
  if (value.length === 2 && value[1] === '十') return digits[value[0]] * 10;
  if (value.length === 3 && value[1] === '十') return digits[value[0]] * 10 + digits[value[2]];
  return digits[value];
}
function jaNoun(J, raw) {
  let text = String(raw || '').replace(/^(?:を|に|へ|で|は|が)+/u, '');
  if (!text) return null;
  const direct = J.places.get(text);
  if (direct) return { text: ES_PLACE[direct], type: 'place', id: direct };
  let enemy = false, nearest = false, idle = false, quantity;
  const strip = (list, flag) => { let hit = false; for (const value of list) if (text.startsWith(value) && text.length > value.length) { text = text.slice(value.length); hit = true; break; } return hit || flag; };
  for (let pass = 0; pass < 3; pass++) {
    const counted = text.match(new RegExp(`^${JA_COUNTER.source}の?`, 'u'));
    if (counted && text.length > counted[0].length) { quantity = jaNumber(counted[1]); text = text.slice(counted[0].length); }
    enemy = strip(J.modifiers.enemy, enemy); nearest = strip(J.modifiers.nearest, nearest); idle = strip(J.modifiers.idle, idle);
    strip(J.modifiers.all, false); strip(J.modifiers.my, false);
  }
  const trailing = text.match(new RegExp(`${JA_COUNTER.source}$`, 'u'));
  if (trailing && text.length > trailing[0].length && (J.units.has(text.slice(0, trailing.index)))) { quantity = jaNumber(trailing[1]); text = text.slice(0, trailing.index); }
  const suffix = `${nearest ? ' mas cercano' : ''}${idle ? ' inactivos' : ''}`;
  const place = J.places.get(text);
  if (place === 'base' && enemy) return { text: ES_PLACE.enemyBase, type: 'place', id: 'enemyBase' };
  if (place === 'enemy' || (!text && enemy)) return { text: nearest ? ES_PLACE.nearestEnemy : ES_PLACE.enemy, type: 'place', id: 'enemy' };
  if (place) return { text: `${ES_PLACE[place]}${enemy ? ' enemigo' : ''}${suffix}`, type: 'place', id: place };
  const unit = J.units.get(text);
  if (unit) return { text: `${ES_UNIT[unit][1]}${enemy ? ' enemigos' : ''}${suffix}`, type: 'unit', kind: unit, quantity };
  const building = J.buildings.get(text);
  if (building) return { text: `${ES_BUILDING[building]}${enemy ? ' enemigo' : ''}${suffix}`, type: 'building', kind: building };
  const resource = J.resources.get(text);
  if (resource) return { text: ES_RESOURCE[resource], type: 'resource', kind: resource };
  if (text) unknownWords++;
  return text ? { text: `${text}${enemy ? ' enemigo' : ''}${suffix}`, type: 'name', quantity } : null;
}
function jaLocation(J, raw) {
  for (const { relation, value } of J.relations) {
    if (!raw.endsWith(value)) continue;
    const landmark = raw.slice(0, raw.length - value.length), es = ES_RELATION[relation];
    if (['north', 'south', 'east', 'west'].includes(relation)) { const np = landmark ? jaNoun(J, landmark) : null; return np ? `${es} del ${np.text}` : es; }
    const np = jaNoun(J, landmark); return np ? `${es} ${np.text}` : null;
  }
  const np = jaNoun(J, raw); return np ? `en ${np.text}` : null;
}
function jaFormation(J, raw) {
  let text = raw;
  for (const word of J.formationWord) text = text.replace(word, '');
  text = text.replace(/^(?:で|に|の)+|(?:で|に|の)+$/gu, '');
  return J.formations.find(entry => entry.value === text)?.formation || null;
}
function rewriteJa(J, text) {
  let s = J.norm(text).replace(/(?:ください|下さい|なさい|てね|しろよ|よ|ね)$/u, '');
  if (!s) return null;
  const fixed = J.phrases.get(s);
  if (fixed) return ES_PHRASE[fixed];
  // Rally point: "(Xの)集合地点を Y に(設定して)".
  for (const rally of J.rally) {
    const index = s.indexOf(rally);
    if (index < 0) continue;
    const building = index > 0 ? jaNoun(J, s.slice(0, index).replace(/の$/u, '')) : null;
    const rest = s.slice(index + rally.length).replace(/^(?:を|は)/u, '').replace(/(?:に|へ)?(?:設定して|設定|して|変更して|する|置いて)?$/u, '');
    const target = jaNoun(J, rest);
    return target ? `punto de reunion${building ? ` del ${building.text}` : ''} a ${target.text}` : null;
  }
  const verb = J.verbs.find(entry => s.endsWith(entry.verb));
  if (!verb) {
    const formation = jaFormation(J, s.replace(/(?:に|で)$/u, ''));
    return formation ? `forma en ${ES_FORMATION[formation]}` : null;
  }
  s = s.slice(0, s.length - verb.verb.length).replace(/(?:を|に|へ)$/u, match => ({ を: 'を', に: 'に', へ: 'に' })[match]);
  // Split into particle-marked segments: subject (は/が/で), object (を), goal (に/へ), rest (bare, e.g. "5人").
  const segments = { subject: [], object: [], goal: [], bare: [] };
  const pattern = /(.+?)(は|が|を|に|へ|で)/uy;
  let index = 0, match;
  while (index < s.length && (pattern.lastIndex = index, match = pattern.exec(s))) {
    const role = { は: 'subject', が: 'subject', で: 'subject', を: 'object', に: 'goal', へ: 'goal' }[match[2]];
    segments[role].push({ text: match[1], particle: match[2] });
    index = pattern.lastIndex;
  }
  if (index < s.length) segments.bare.push({ text: s.slice(index) });
  // "で" and "に" may name a formation instead of a place or a subject.
  let formation = null;
  for (const role of ['subject', 'goal', 'bare', 'object']) {
    segments[role] = segments[role].filter(segment => { const id = jaFormation(J, segment.text); if (id && !formation) { formation = id; return false; } return true; });
  }
  const first = role => segments[role][0]?.text;
  const noun = role => (first(role) ? jaNoun(J, first(role)) : null);
  const subjectText = () => noun('subject')?.text || '';
  switch (verb.category) {
    case 'gather': {
      const np = noun('object') || noun('bare');
      if (np?.type !== 'resource' && np?.id !== 'forest') return null;
      return join(subjectText(), 'recoge', np.type === 'resource' ? ES_RESOURCE[np.kind] : ES_RESOURCE.wood);
    }
    case 'build': {
      const np = noun('object') || noun('bare');
      if (np?.type !== 'building') return null;
      const where = first('goal') ? jaLocation(J, first('goal')) : '';
      if (where === null) return null;
      return join(subjectText(), 'construye', ES_BUILDING[np.kind], where);
    }
    case 'train': {
      const np = noun('object') || noun('bare') || noun('subject');
      if (np?.type !== 'unit') return null;
      let quantity = np.quantity;
      for (const segment of segments.bare) { const counted = segment.text.match(new RegExp(`^${JA_COUNTER.source}$`, 'u')); if (counted) quantity = jaNumber(counted[1]); }
      quantity ||= 1;
      const where = segments.subject.find(segment => segment.particle === 'で' && jaNoun(J, segment.text)?.type === 'building');
      return join('entrena', String(quantity), ES_UNIT[np.kind][quantity === 1 ? 0 : 1], where ? `en ${jaNoun(J, where.text).text}` : '');
    }
    case 'attack': {
      const np = noun('object') || noun('goal') || noun('bare');
      return join(subjectText(), 'ataca', np?.text || '');
    }
    case 'form': {
      if (!formation) return null;
      const target = noun('object') || noun('subject');
      const goal = first('goal') ? jaNoun(J, first('goal')) : null;
      return join('forma', target?.text || '', 'en', ES_FORMATION[formation], goal ? `a ${goal.text}` : '');
    }
    case 'move': {
      const goal = noun('goal');
      if (!goal) return null;
      const target = noun('object');
      return join(subjectText(), 'mueve', target?.text || '', formation ? `en ${ES_FORMATION[formation]}` : '', `a ${goal.text}`);
    }
    case 'halt': {
      const np = noun('object');
      return np ? `deten ${np.text}` : ES_PHRASE.stop;
    }
    case 'select': {
      const np = noun('object') || noun('bare');
      return np ? `selecciona ${np.text}` : null;
    }
    default: return null;
  }
}

const LATIN_CODES = ['en', 'pt', 'fr', 'de'];
const JAPANESE = /[぀-ヿ㐀-鿿]/u;
const ARABIC = /[؀-ۿ]/u;

/**
 * Returns { text, lang } where text is Spanish phrasing for spanish.js, or the original
 * input when no foreign rule matches it completely.
 */
// Negated orders ("don't attack", "nicht angreifen", "家を建てないで") are never rewritten: the
// rules drop unknown words, so the negation would vanish and the order would run.
const NEGATION_WORDS = new Set(['not', 'dont', 'doesnt', 'didnt', 'never', 'nao', 'nunca', 'nem', 'jamais', 'pas', 'nicht', 'kein', 'keine', 'keinen', 'keiner', 'nie', 'niemals', 'لا', 'لن', 'لم', 'ليس', 'ولا']);
const JA_NEGATION = /(?:ない|ません|るな$|すな$|ずに)/u;
function negated(text) {
  if (JA_NEGATION.test(text)) return true;
  const words = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/['’]/gu, '').split(/[^\p{L}\p{N}]+/u);
  return words.some(word => NEGATION_WORDS.has(word));
}
// Foreign one-word replies that are also Spanish words or interjections ("ja" is laughter).
const AMBIGUOUS_WITH_SPANISH = { ja: 'de' };

export function translateCommand(original, { locale = getLocale() } = {}) {
  const text = String(original ?? '');
  if (!text.trim() || negated(text)) return { text, lang: null };
  const ambiguous = AMBIGUOUS_WITH_SPANISH[text.trim().toLowerCase().replace(/[.!?¡¿,]+/gu, '')];
  if (ambiguous && ambiguous !== locale) return { text, lang: null };
  let order;
  if (JAPANESE.test(text)) order = ['ja'];
  else if (ARABIC.test(text)) order = ['ar'];
  else order = LATIN_CODES.includes(locale) ? [locale, ...LATIN_CODES.filter(code => code !== locale)] : LATIN_CODES;
  let best = null;
  for (const code of order) {
    let rewritten = null;
    unknownWords = 0;
    try { rewritten = code === 'ja' ? rewriteJa(model('ja'), text) : rewriteLatin(model(code), text); } catch { rewritten = null; }
    if (rewritten && (!best || unknownWords < best.unknown)) best = { text: rewritten, lang: code, unknown: unknownWords };
    if (best && best.unknown === 0) break;
  }
  return best ? { text: best.text, lang: best.lang } : { text, lang: null };
}
/** Spanish (or unknown) input passes through untouched. */
export const normalizeCommand = (text, options) => translateCommand(text, options).text;
