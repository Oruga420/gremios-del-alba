import { BUILDINGS, TECHNOLOGIES, MAPS } from '../game/data.js';
import { normalize, unitKind, buildingKind, catalogId } from './registry.js';
import { resourceKind } from './semantic.js';
const RESOURCES = { madera:'wood',wood:'wood',alimento:'food',alimentos:'food',comida:'food',food:'food',oro:'gold',gold:'gold',piedra:'stone',stone:'stone',pesca:'fish',pescado:'fish',fish:'fish' };
const NUMBERS = { un:1,una:1,uno:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,once:11,doce:12,trece:13,catorce:14,quince:15,dieciseis:16,diecisiete:17,dieciocho:18,diecinueve:19,veinte:20,cien:100 };
const count = (value) => NUMBERS[normalize(value)] ?? Number(value);
const command = (name, input = {}) => ({ name, input });
const unknown = (speak) => ({ error: { ok:false, code:'COMMAND_NOT_UNDERSTOOD', speak: speak || 'No entendí la orden. Prueba «selecciona a Luna», «Luna recoge madera», «entrena cinco arqueros», «estado» o «ayuda».' } });
const rawTarget = (value) => String(value || '').trim().replace(/^(?:a|al|el|la|los|las|mis|mi)\s+/iu,'');
function coordinates(text) { const match = text.match(/(-?\d+(?:[.]\d+)?)\s*[,;]\s*(-?\d+(?:[.]\d+)?)/u) || text.match(/(?:en|a|hasta)\s+(\d+)\s+(?:y|con)\s+(\d+)/iu); return match ? { x:Number(match[1]), y:Number(match[2]) } : null; }
function targetBefore(text, verb) { const index = text.search(verb); return index > 0 ? text.slice(0,index).trim().replace(/[,;:]$/u,'').trim() : undefined; }

export function parseSpanishCommand(original, { game, confirm, mode = 'direct' } = {}) {
  const text = String(original || '').trim().replace(/[.!?¿¡]+$/u,'');
  const normalized = normalize(text);
  if (!text || text.length > 240) return unknown('Escribe una orden de hasta 240 caracteres.');
  if (/^(?:alto|stop|detente|deten|cancelar|cancela|para|no|no confirmo)$/u.test(normalized)) return command('stop_action');
  if (/^(?:si|si confirma|confirmar|confirma|confirmo|acepto|adelante|hazlo)$/u.test(normalized)) { const proposal = confirm?.getState(); return mode === 'direct' || proposal ? command('confirm_action',{proposalId:proposal?.proposalId || 'direct-mode',confirmationText:text}) : unknown('No hay una propuesta que confirmar.'); }
  if (/^(?:estado|recursos|mi ciudad|estado de (?:la |mi )?ciudad|como vamos|poblacion)$/u.test(normalized)) return command('read_city');
  if (/^(?:oficios|profesiones|roles|resumen de (?:roles|oficios|profesiones))$/u.test(normalized)) return command('read_roles');
  if (/^(?:ayuda|como jugar|controles)$/u.test(normalized)) return command('open_panel',{panel:'help'});
  if (/^(?:habitantes|lista (?:de )?habitantes|roster)$/u.test(normalized)) return command('read_residents');
  if (/^(?:abre |muestra )?(?:el )?mercado$/u.test(normalized)) return command('open_panel',{panel:'market'});
  if (/^(?:abre |muestra )?(?:el )?(?:saber|investigaciones|tecnologias)$/u.test(normalized)) return command('open_panel',{panel:'research'});
  if (/^(?:cierra (?:el )?panel|cerrar panel)$/u.test(normalized)) return command('open_panel',{panel:'close'});
  if (/^(?:guardar|guarda|guardar partida|guarda (?:la )?(?:partida|cronica))$/u.test(normalized)) return command('propose_save');
  if (/^(?:cargar|carga|cargar partida|carga (?:la )?(?:partida|cronica)(?: local)?|continua (?:la )?copia local)$/u.test(normalized)) return command('propose_load');
  if (/^(?:pausa|pausar|pausa (?:la )?partida)$/u.test(normalized)) return command('propose_pause',{paused:true});
  if (/^(?:continua|reanuda|continuar|reanudar)(?: (?:la )?partida)?$/u.test(normalized)) return command('propose_pause',{paused:false});
  if (/^(?:avanza|avanzar|sube|subir)(?: (?:a la siguiente|de))? era$/u.test(normalized)) return command('propose_advance_age');
  if (/^(?:acerca|acercar)(?: (?:la )?camara)?$/u.test(normalized)) return command('camera_view',{action:'zoom',factor:1.15});
  if (/^(?:aleja|alejar)(?: (?:la )?camara)?$/u.test(normalized)) return command('camera_view',{action:'zoom',factor:1/1.15});
  if (/^(?:centra|centrar)(?: (?:la )?seleccion)?$/u.test(normalized)) return command('camera_view',{action:'selection'});
  let match = text.match(/^(?:cambia|cambiar)\s+(?:el\s+)?nombre\s+de\s+(.+?)\s+a\s+(.+)$/iu) || text.match(/^(?:renombra|renombrar)\s+(?:a\s+)?(.+?)\s+(?:a|como)\s+(.+)$/iu);
  if (match) return command('propose_rename',{target:match[1].trim(),name:match[2].trim()});
  match = normalized.match(/^(guardar|guarda|asignar|asigna|recupera|selecciona)\s+(?:el\s+)?grupo\s+([1-9])$/u);
  if (match) return command('control_group',{action:['recupera','selecciona'].includes(match[1])?'recall':'assign',group:Number(match[2])});
  match = text.match(/^(?:selecciona|seleccionar|elige|select)\s+(.+)$/iu);
  if (match) { const idle = /inactiv[oa]s?|sin tarea/iu.test(match[1]); return command('select_units',{target:idle?'aldeanos':rawTarget(match[1]),...(idle?{idle:true}:{})}); }
  match = text.match(/^(?:busca|buscar|lista)\s+(?:a\s+)?(.+)$/iu);
  if (match) return unitKind(match[1]) ? command('read_residents',{role:match[1]}) : command('read_residents',{query:match[1]});
  match = text.match(/^(?:examina|examinar|inspecciona|quien es)\s+(?:a\s+)?(.+)$/iu);
  if (match) return command('read_entity',{target:match[1]});
  match = text.match(/^(?:centra|mira|mirar)\s+(?:la camara\s+)?(?:en\s+|a\s+)?(.+)$/iu);
  if (match) { const point = coordinates(text); return command('camera_view',{action:'center',...(point||{target:match[1]})}); }
  match = normalized.match(/^(?:velocidad|pon (?:la )?velocidad)\s+(media|normal|doble|0[ ]?5|1|2)$/u);
  if (match) return command('propose_speed',{speed:{media:.5,normal:1,doble:2,'0 5':.5,1:1,2:2}[match[1]]});
  match = text.match(/^(?:entrena|entrenar|recluta|reclutar|crea)\s+(\d+|[\p{L}]+)\s+(.+?)(?:\s+en\s+(.+))?$/iu);
  if (match && unitKind(match[2]) && Number.isInteger(count(match[1]))) return command('propose_train',{quantity:count(match[1]),kind:unitKind(match[2]),...(match[3]?{building:match[3]}:{})});
  match = text.match(/^(?:compra|comprar|vende|vender)\s+(\d+|[\p{L}]+)\s+(?:de\s+)?(.+)$/iu);
  if (match && RESOURCES[normalize(match[2])]) return command('propose_trade',{amount:count(match[1]),resource:RESOURCES[normalize(match[2])],direction:/^compr/iu.test(text)?'buy':'sell'});
  match = text.match(/^(?:investiga|investigar|mejora|mejorar)\s+(.+?)(?:\s+en\s+(.+))?$/iu);
  if (match) { const id = catalogId(match[1],TECHNOLOGIES); return id ? command('propose_research',{technologyId:id,...(match[2]?{building:match[2]}:{})}) : unknown('No encontré esa tecnología. Abre Saber para ver los nombres exactos.'); }
  match = text.match(/^(?:abre|abrir|cierra|cerrar)\s+(?:la\s+)?(.+)$/iu);
  if (match && /puerta|gate/iu.test(match[1])) return command('propose_gate',{building:match[1],open:/^abr/iu.test(text)});
  match = text.match(/^(?:nuevo mapa|nueva partida|comienza en|comenzar en|cambia el mapa a)\s+(.+)$/iu);
  if (match) { const map = MAPS.find((entry)=>[normalize(entry.id.replaceAll('-',' ')),normalize(entry.name)].includes(normalize(match[1]))); const state = game?.world?.state; return map ? command('propose_new_match',{mapId:map.id,guildId:state?.guildId||'alba',difficulty:state?.difficulty||'normal',mode:state?.mode||'conquest'}) : unknown('No encontré esa región. Consulta el catálogo de mapas.'); }
  const gatherVerb = /\b(?:recoge|recoger|recolecta|recolecten|recogan|tala|talen|gather)\b/iu;
  if (gatherVerb.test(text)) { const verb = text.match(gatherVerb); const after = text.slice(verb.index+verb[0].length).trim(); const resource = resourceKind(after); return resource ? command('propose_gather',{resource,...(targetBefore(text,gatherVerb)?{target:targetBefore(text,gatherVerb)}:{})}) : unknown('Indica madera, alimento, oro, piedra o pesca.'); }
  const moveVerb = /\b(?:mueve|mu[eé]vete|mover|muevan|avancen|avanza|ve|vayan|regresa|regresen|vuelve|vuelvan|manda|env[ií]a|move)\b/iu;
  if (moveVerb.test(text)) {
    const verb=text.match(moveVerb),before=targetBefore(text,moveVerb),point=coordinates(text),after=text.slice(verb.index+verb[0].length).trim();
    if(point){const target=after.replace(/\s*(?:a|hasta|en)\s+[-\d].*$/u,'').replace(/^[-\d].*$/u,'').trim();return command('propose_move',{...point,...(before?{target:before}:target?{target:rawTarget(target)}:{})});}
    const split=after.match(/^(.+?)\s+(?:a|al|hasta|hacia)\s+(.+)$/iu);
    const destination=before?after.replace(/^(?:a|al|hasta|hacia)\s+/iu,''):split?split[2]:after.replace(/^(?:a|al|hasta|hacia)\s+/iu,'');
    return command('propose_move',{destination:destination||'mi base',...(before?{target:before}:split?{target:rawTarget(split[1])}:{})});
  }
  const defendVerb = /\b(?:defiende|defiendan|defender|defend)\b/iu;
  if (defendVerb.test(text)) { const verb=text.match(defendVerb),before=targetBefore(text,defendVerb),after=rawTarget(text.slice(verb.index+verb[0].length).trim()); return command('propose_defend',{...(before?{target:before}:{}),...(after?{anchor:after}:{})}); }
  const attackVerb = /\b(?:ataca|ataquen|atacar|attack)\b/iu;
  if (attackVerb.test(text)) { const verb=text.match(attackVerb),before=targetBefore(text,attackVerb),enemy=rawTarget(text.slice(verb.index+verb[0].length)); return command('propose_attack',{...(enemy?{enemy}:{}),...(before?{target:before}:{})}); }
  const healVerb = /\b(?:sana|sanen|sanar|cura|curen|curar|heal)\b/iu;
  if (healVerb.test(text)) {
    const target=targetBefore(text,healVerb),point=coordinates(text),after=text.slice(text.search(healVerb)).replace(healVerb,'').trim();
    return command('propose_cast',{spell:'heal',...(target?{target}:{}),...(point||{destination:rawTarget(after)||'heridos'})});
  }
  const repairVerb = /\b(?:repara|reparen|reparar|repair)\b/iu;
  if (repairVerb.test(text)) { const verb=text.match(repairVerb),before=targetBefore(text,repairVerb),building=rawTarget(text.slice(verb.index+verb[0].length)); return building?command('propose_repair',{building,...(before?{target:before}:{})}):unknown('Indica el edificio que reparar.'); }
  const buildVerb = /\b(?:construye|construyan|construir|levanten|levanta|build)\b/iu;
  if (buildVerb.test(text)) {
    const verb=text.match(buildVerb),target=targetBefore(text,buildVerb),after=text.slice(verb.index+verb[0].length).trim().replace(/^(?:un|una)\s+/iu,'');
    const split=after.match(/^(.*?)(\s+(?:en|al|a la|hacia|desde|detr[aá]s del?|atr[aá]s del?|junto al?|cerca del?|delante del?|frente al?)\s+.*)$/iu);
    const kind=buildingKind(split?split[1]:after);
    if (!kind) return unknown('Indica un edificio: casa, cuartel, granja o muralla.');
    const location=split?split[2].trim().replace(/^(?:en|hacia)\s+/iu,''):undefined;
    const pairs=[...text.matchAll(/(-?\d+(?:[.]\d+)?)\s*[,;]\s*(-?\d+(?:[.]\d+)?)/gu)].map(entry=>({x:Number(entry[1]),y:Number(entry[2])}));
    if (['wall','palisade'].includes(kind)) {
      if(pairs.length>=2)return command('propose_wall',{kind,...pairs[0],endX:pairs[1].x,endY:pairs[1].y,...(target?{target}:{})});
      if(pairs.length)return unknown('Falta el otro extremo; también puedes decir «muralla al norte».');
      return command('propose_wall',{kind,...(location?{location}:{}),...(target?{target}:{})});
    }
    const point=coordinates(text);return command('propose_build',{kind,...(point||location&&{location}||{}),...(target?{target}:{})});
  }
  if (/bola de fuego|fireball/iu.test(text)) {
    const point=coordinates(text),destination=text.split(/bola de fuego|fireball/iu)[1].trim().replace(/^(?:a|al|contra|hacia|en)\s+/iu,'');
    return command('propose_cast',{spell:'fireball',...(point||{destination:destination||'enemigo más cercano'}),target:targetBefore(text,/\b(?:lanza|lancen|cast)\b/iu)||'magos'});
  }
  const convertVerb=/\b(?:convierte|conviertan|convertir|convert)\b/iu;
  if(convertVerb.test(text)){const verb=text.match(convertVerb),enemy=rawTarget(text.slice(verb.index+verb[0].length));return command('propose_convert',{enemy,target:targetBefore(text,convertVerb)||'hechiceros'});}
  match=text.match(/^(?:deten|detener|para)\s+(?:a\s+)?(.+)$/iu);if(match)return command('propose_stop_units',{target:match[1]});
  return unknown();
}
