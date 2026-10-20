# Voice and WebMCP tools

The canonical contracts are in `clickables.json`. The registry validates input, ownership, resources and current world state before invoking the same commands used by the UI. Legacy `propose_*` names execute validated game orders immediately; they do not add a confirmation step.

| Tool | Purpose |
| --- | --- |
| `read_city` | Lee recursos, población, reservas, era, pausa y oficios de tu ciudad. |
| `read_residents` | Busca habitantes propios por nombre o profesión; devuelve como máximo veinte. |
| `read_entity` | Lee identidad, posición, salud y tarea de un objetivo visible. |
| `read_catalog` | Lee edificios, unidades, tecnologías, gremios o regiones y sus requisitos. |
| `read_roles` | Cuenta habitantes propios por oficio y explica los aliases de órdenes. |
| `select_units` | Selecciona habitantes propios por nombre, ID o profesión sin darles una orden. |
| `camera_view` | Centra, desplaza o acerca la cámara; no da órdenes a unidades. |
| `open_panel` | Muestra ayuda, habitantes, mercado, conocimiento, guardar/cargar o el menú. |
| `configure_match` | Cambia los campos del menú; usa propose_new_match para iniciar inmediatamente la región elegida. |
| `control_group` | Guarda o recupera una selección en los grupos de teclado uno a nueve. |
| `show_catalog` | Muestra las tarjetas reales de ciudad, ejército, defensas o saber. |
| `propose_rename` | Cambia inmediatamente el nombre de un habitante propio; valida que sea único. |
| `propose_move` | Ordena inmediatamente una marcha normal u ofensiva al destino exacto. Resuelve el lugar desde el mapa real; las coordenadas son opcionales y se conservan para órdenes explícitas. |
| `propose_gather` | Ordena inmediatamente recoger, transportar y depositar desde un recurso concreto. |
| `propose_build` | Construye inmediatamente con aldeanos y casillas válidas; cobra los recursos del juego. Resuelve el lugar desde el mapa real; las coordenadas son opcionales y se conservan para órdenes explícitas. |
| `propose_wall` | Construye inmediatamente una línea válida de muralla o empalizada; cobra el coste total. Resuelve el lugar desde el mapa real; las coordenadas son opcionales y se conservan para órdenes explícitas. |
| `propose_repair` | Ordena inmediatamente reparar un edificio propio con aldeanos y presupuesto de madera limitado. |
| `propose_train` | Recluta inmediatamente la cantidad indicada en un productor propio compatible; valida recursos y población. |
| `propose_cancel_train` | Cancela inmediatamente una entrada exacta de la cola y devuelve sus recursos del juego. |
| `propose_attack` | Ordena inmediatamente atacar un objetivo enemigo exacto; no adivina nombres ambiguos. |
| `propose_defend` | Ordena inmediatamente defender la posición actual o un edificio propio concreto. |
| `propose_stop_units` | Detiene inmediatamente las tareas de los habitantes indicados; no revierte gastos ni acciones completadas. |
| `propose_cast` | Lanza inmediatamente sanación o bola de fuego con lanzadores, posición y maná válidos. Resuelve el lugar desde el mapa real; las coordenadas son opcionales y se conservan para órdenes explícitas. |
| `propose_convert` | Ordena inmediatamente convertir una unidad rival con hechiceros propios preparados. |
| `propose_rally` | Fija inmediatamente el destino de los nuevos reclutas de un edificio propio. Resuelve el lugar desde el mapa real; las coordenadas son opcionales y se conservan para órdenes explícitas. |
| `propose_research` | Inicia inmediatamente una tecnología del catálogo en su edificio compatible. |
| `propose_advance_age` | Inicia inmediatamente la siguiente era en la Casa del Gremio si cumple coste y requisitos. |
| `propose_trade` | Compra o vende inmediatamente recursos virtuales del juego al precio actual en oro virtual. |
| `propose_gate` | Abre o cierra inmediatamente una puerta propia y recalcula los caminos. |
| `propose_pause` | Cambia inmediatamente la pausa de la simulación sólo cuando la persona lo pide. |
| `propose_speed` | Cambia inmediatamente la velocidad a media, normal o doble. |
| `propose_new_match` | Reemplaza inmediatamente la partida por la región, gremio y desafío pedidos. |
| `propose_save` | Guarda inmediatamente la partida local y descarga su archivo. |
| `propose_load` | Carga inmediatamente la copia local válida; la persona elige manualmente un archivo externo. |
| `confirm_action` | Compatibilidad antigua: no realiza ninguna acción en el modo inmediato. No llames esta herramienta. |
| `stop_action` | Detiene inmediatamente unidades seleccionadas o de la última orden de voz; no deshace acciones completadas ni devuelve gastos. |

## Natural destinations

Commands may describe actual landmarks, nearby resources, own/enemy bases or directions. Missing build coordinates allow the semantic resolver to choose a legal reachable plot and available builders. Explicit coordinates must be complete. Unknown or inaccessible targets fail without invented results.

Examples: «construye una casa», «detrás del cuartel», «recoge madera» and «ataca la base enemiga». Unit names can be used as selectors.

## Optional voice backends

The browser parser and typed input are independent of a conversational provider. Offline speech requires explicitly configured Python, FFmpeg and Vosk resources. For ElevenLabs, configure `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` on the server; use your own private Agent. `npm run voice:definition` exports matching client tool definitions locally.

Native WebMCP is registered when the browser exposes the supported page API; the compatibility registry remains separately visible. The Windows WebMCP launcher discovers Chrome and uses a project-local profile.

See `src/voice/registry.js`, `src/voice/semantic.js`, `src/voice/spanish.js` and the voice regression tests for implementation details. Provider calls, actual microphone audio and browser lifecycle cleanup require their own verification.
