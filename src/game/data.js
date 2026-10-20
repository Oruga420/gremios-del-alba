/** Original game rules. Costs, producers and prerequisites are shared with the UI. */
export const TERRAIN = Object.freeze({ GRASS: 0, WATER: 1, FOREST: 2, SAND: 3, ROCK: 4, SNOW: 5, MARSH: 6, BRIDGE: 7, CLIFF: 8 });
export const GUILDS = [
  { id: 'alba', name: 'Gremio del Alba', description: 'Aldeanos diligentes: recolección +15%.', color: '#53b997', gatherBonus: 1.15 },
  { id: 'espina', name: 'Espina de Jade', description: 'Arqueros y asesinos con ataque +15%.', color: '#9abd6c', rangedBonus: 1.15 },
  { id: 'bastion', name: 'Bastión Áureo', description: 'Infantería y caballeros con armadura adicional.', color: '#d4ab62', armorBonus: 2 },
  { id: 'eclipse', name: 'Eclipse Celeste', description: 'Hechiceros y sanadores con poder +20%.', color: '#b391dc', magicBonus: 1.2 },
];
export const MAPS = [
  { id: 'valle-del-alba', name: 'Valle del Alba', description: 'Valle abierto con un lago central y dos rutas amplias.', color: '#88a96b', topology: 'lake', palette: ['#8da874','#4c8d9b','#527957','#d0bb82','#98988a','#d6e1dc','#6f8970','#bb9567','#777a75'] },
  { id: 'bosque-de-jade', name: 'Bosque de Jade', description: 'Tres pasos entre crestas de bosque antiguo.', color: '#4f806b', topology: 'forest-pass', palette: ['#769766','#3c7e90','#3c634c','#c5b882','#8b8b7e','#dde5df','#627f66','#b69b70','#596759'] },
  { id: 'costa-de-los-faros', name: 'Costa de los Faros', description: 'Una bahía profunda deja una península transitable.', color: '#6ba9b5', topology: 'coast', palette: ['#8fab78','#589cae','#537d58','#d8c391','#a0a18d','#e1e9e7','#7e9982','#c0a071','#878d86'] },
  { id: 'islas-del-viento', name: 'Islas del Viento', description: 'Cuatro islas conectadas por puentes y canales navegables.', color: '#75b5b2', topology: 'islands', palette: ['#97b77d','#5798a8','#608b63','#e0cc9b','#a2a89b','#e5ece4','#7c9f85','#cfac79','#85978b'] },
  { id: 'paso-nevado', name: 'Paso Nevado', description: 'Una cordillera divide el mapa; solo dos desfiladeros cruzan.', color: '#b4c9d3', topology: 'mountain', palette: ['#bdcdc3','#6e9aaa','#75978b','#cec8af','#9da9af','#e1e9e6','#94aaa1','#b49c7d','#87949a'] },
  { id: 'desierto-de-ambar', name: 'Desierto de Ámbar', description: 'Oasis separados por dunas y una larga garganta en zigzag.', color: '#d5b783', topology: 'canyon', palette: ['#c7b776','#679c9c','#7b9368','#d9be82','#b69e7a','#e5daca','#a3ac79','#ba8d5e','#a28766'] },
  { id: 'pantano-de-luciernagas', name: 'Pantano de Luciérnagas', description: 'Canales paralelos y cuatro pasarelas alternas.', color: '#6d9a8b', topology: 'marsh', palette: ['#86a67e','#507f80','#4b7460','#b3b48b','#89948a','#d6e1d8','#6d8b76','#b6a178','#647769'] },
  { id: 'llanuras-de-otono', name: 'Llanuras de Otoño', description: 'Pradera abierta; dos lagunas cambian los flancos.', color: '#ba9b66', topology: 'plains', palette: ['#b3a46f','#668d98','#977d51','#d1bc86','#a2a18c','#e0e1d5','#939d74','#bb9568','#8b8e79'] },
  { id: 'caldera-carmesi', name: 'Caldera Carmesí', description: 'Anillo volcánico con cuatro entradas y lago interior.', color: '#af786b', topology: 'caldera', palette: ['#a18f6a','#738d94','#7c7e59','#bcaa7c','#a08577','#d8d3ca','#8d8e70','#b08a6a','#7d6e68'] },
  { id: 'jardin-celeste', name: 'Jardín Celeste', description: 'Un río serpenteante obliga a buscar tres puentes.', color: '#a8b8d5', topology: 'river', palette: ['#94b78b','#729eb6','#658e76','#d1c5a0','#a3b0a6','#e1ece7','#8fae9a','#c0a987','#81998b'] },
];
const cost = (wood = 0, food = 0, gold = 0, stone = 0) => ({ wood, food, gold, stone });
const unit = (name, age, producer, price, stats) => ({ name, age, producer, producers: [producer], cost: price, hp: 100, speed: 2.5, attack: 0, range: 1.2, armor: 0, cooldown: 1, trainTime: 8, population: 1, movement: 'land', ...stats });
export const UNITS = {
  villager: unit('Aldeano', 1, 'guildhall', cost(0,50), { hp: 65, speed: 2.8, attack: 4, gatherRate: 6, carryCapacity: 20, buildRate: 0.075, role: 'worker' }),
  infantry: unit('Guardia de lanza', 1, 'barracks', cost(0,55,15), { hp: 115, attack: 14, armor: 1, counters: { cavalry: 1.8, scout: 1.6 }, role: 'infantry' }),
  scout: unit('Explorador', 1, 'stable', cost(0,70), { hp: 90, speed: 4.5, attack: 9, role: 'cavalry' }),
  archer: unit('Arquera del bosque', 1, 'archery', cost(30,0,40), { hp: 75, attack: 12, range: 6.5, projectile: true, counters: { infantry: 1.4 }, role: 'ranged' }),
  cavalry: unit('Jinete del alba', 2, 'stable', cost(0,90,40), { hp: 175, speed: 4, attack: 22, armor: 2, counters: { archer: 1.5 }, role: 'cavalry' }),
  heavy_knight: unit('Caballero pesado', 3, 'stable', cost(0,110,75), { hp: 260, speed: 2.7, attack: 32, armor: 7, counters: { infantry: 1.35 }, trainTime: 16, role: 'heavy' }),
  assassin: unit('Asesina de Espina', 2, 'barracks', cost(0,65,65), { hp: 95, speed: 3.9, attack: 31, cooldown: 1.3, counters: { mage: 1.8, healer: 1.8, wizard: 1.8 }, role: 'assassin' }),
  mage: unit('Maga de brasas', 2, 'arcane_tower', cost(0,0,110), { hp: 85, attack: 23, range: 5.5, projectile: true, mana: 100, spell: 'fireball', role: 'magic' }),
  healer: unit('Sanadora', 2, 'sanctuary', cost(0,40,70), { hp: 85, attack: 0, range: 6, healRate: 18, mana: 100, spell: 'heal', role: 'healer' }),
  wizard: unit('Hechicero del Eclipse', 3, 'academy', cost(0,0,140), { hp: 100, attack: 12, range: 6, projectile: true, mana: 120, convertTime: 5, convertCooldown: 20, role: 'wizard' }),
  siege_engine: unit('Catapulta de gremio', 3, 'siege_workshop', cost(160,0,110), { hp: 210, speed: 1.8, attack: 70, range: 9, cooldown: 3, projectile: true, splash: 1.6, counters: { building: 2.5 }, trainTime: 22, role: 'siege' }),
  fishing_boat: unit('Barca pesquera', 1, 'dock', cost(85), { hp: 100, speed: 3.2, movement: 'water', gatherRate: 8, carryCapacity: 30, role: 'worker' }),
  war_boat: unit('Navío guardián', 2, 'dock', cost(140,0,80), { hp: 230, speed: 3.3, attack: 28, range: 7, armor: 3, projectile: true, movement: 'water', role: 'naval' }),
};
const building = (name, size, age, price, stats = {}) => ({ name, size, age, cost: price, hp: 700, buildTime: 14, category: 'city', ...stats });
export const BUILDINGS = {
  guildhall: building('Casa del Gremio', 4, 1, cost(220,0,0,160), { hp: 2400, capacity: 20, dropoff: ['wood','food','gold','stone'], trains: ['villager'], category: 'economy' }),
  house: building('Casa de aldea', 2, 1, cost(60), { hp: 450, capacity: 10, category: 'economy' }),
  farm: building('Huerto', 3, 1, cost(60), { hp: 300, farmFood: 1200, category: 'economy' }),
  lumber_camp: building('Campamento maderero', 2, 1, cost(90), { dropoff: ['wood'], category: 'economy' }),
  mill: building('Molino', 2, 1, cost(90), { dropoff: ['food'], category: 'economy' }),
  mining_camp: building('Campamento minero', 2, 1, cost(95), { dropoff: ['gold','stone'], category: 'economy' }),
  barracks: building('Cuartel', 3, 1, cost(150), { trains: ['infantry','assassin'], category: 'military' }),
  archery: building('Arquería', 3, 1, cost(155), { trains: ['archer'], category: 'military' }),
  stable: building('Establo', 3, 1, cost(180), { trains: ['scout','cavalry','heavy_knight'], category: 'military' }),
  arcane_tower: building('Torre arcana', 3, 2, cost(180,0,90), { trains: ['mage'], category: 'military' }),
  sanctuary: building('Santuario', 3, 2, cost(160,0,70), { trains: ['healer'], category: 'military' }),
  forge: building('Forja', 3, 1, cost(150,0,50), { technologies: ['forging','armor','fletching'], category: 'research' }),
  market: building('Mercado', 3, 2, cost(180), { technologies: ['trade_routes'], category: 'economy' }),
  academy: building('Academia del Eclipse', 3, 3, cost(220,0,140), { trains: ['wizard'], technologies: ['arcane_mastery','faith'], category: 'research' }),
  watchtower: building('Atalaya', 2, 2, cost(60,0,0,120), { hp: 1300, attack: 22, range: 8, cooldown: 1.4, category: 'defense' }),
  fortress: building('Fortaleza', 4, 3, cost(180,0,0,450), { hp: 3600, attack: 40, range: 9, cooldown: 1.5, capacity: 20, category: 'defense' }),
  palisade: building('Empalizada', 1, 1, cost(12), { hp: 350, buildTime: 4, category: 'defense' }),
  wall: building('Muralla de piedra', 1, 2, cost(0,0,0,20), { hp: 1400, buildTime: 6, category: 'defense' }),
  gate: building('Puerta del gremio', 1, 2, cost(30,0,0,35), { hp: 1100, buildTime: 8, category: 'defense' }),
  dock: building('Puerto', 3, 1, cost(160), { hp: 1000, trains: ['fishing_boat','war_boat'], dropoff: ['fish'], placement: 'shore', category: 'economy' }),
  wonder: building('Árbol de las eras', 4, 4, cost(500,500,500,500), { hp: 4200, category: 'monument' }),
  siege_workshop: building('Taller de asedio', 3, 3, cost(220,0,80), { trains: ['siege_engine'], category: 'military' }),
  granary: building('Granero', 2, 1, cost(100), { dropoff: ['food'], capacity: 5, technologies: ['wheelbarrow','agriculture'], category: 'economy' }),
  university: building('Universidad', 3, 3, cost(240,0,90), { technologies: ['masonry','ballistics','navigation'], category: 'research' }),
};
const tech = (name, age, producer, price, effect, prerequisites = []) => ({ name, age, producer, cost: price, time: 12, effect, prerequisites });
export const TECHNOLOGIES = {
  wheelbarrow: tech('Carretilla', 1, 'granary', cost(60,80), { carry: 1.5, gather: 1.1 }),
  agriculture: tech('Rotación de cultivos', 2, 'granary', cost(90,100), { gather: 1.25 }, ['wheelbarrow']),
  forging: tech('Acero del alba', 1, 'forge', cost(0,80,50), { attack: 3 }),
  armor: tech('Corazas templadas', 2, 'forge', cost(0,100,80), { armor: 2 }, ['forging']),
  fletching: tech('Plumas de precisión', 1, 'forge', cost(80,0,60), { range: 1 }),
  trade_routes: tech('Rutas mercantiles', 2, 'market', cost(100,0,90), { trade: 0.8 }),
  arcane_mastery: tech('Maestría arcana', 3, 'academy', cost(0,0,180), { magic: 1.35 }),
  faith: tech('Voluntad del Eclipse', 4, 'academy', cost(0,0,220), { conversion: 0.7 }, ['arcane_mastery']),
  masonry: tech('Mampostería', 3, 'university', cost(100,0,0,100), { buildingArmor: 3 }),
  ballistics: tech('Balística', 3, 'university', cost(140,0,100), { attack: 4 }, ['fletching']),
  navigation: tech('Cartas náuticas', 3, 'university', cost(140,0,100), { boatSpeed: 1.25 }),
};
export const AGE_NAMES = ['','Era de las Semillas','Era de los Gremios','Era de las Torres','Era del Alba'];
export const AGE_COSTS = [null,null,cost(0,300,150),cost(0,500,300,100),cost(200,800,500,250)];
