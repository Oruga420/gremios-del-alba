// Domain tools shared by native WebMCP, local Spanish commands and the personal agent.
export const TOOL_SPECS = [
  {
    "name": "read_city",
    "title": "Estado de la ciudad",
    "kind": "read",
    "description": "Lee recursos, población, reservas, era, pausa y oficios de tu ciudad.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": true,
      "consequentialHint": false
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para estado de la ciudad.",
      "additionalProperties": false,
      "properties": {},
      "required": []
    }
  },
  {
    "name": "read_residents",
    "title": "Buscar habitantes",
    "kind": "read",
    "description": "Busca habitantes propios por nombre o profesión; devuelve como máximo veinte.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": true,
      "consequentialHint": false
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para buscar habitantes.",
      "additionalProperties": false,
      "properties": {
        "query": {
          "type": "string",
          "description": "Nombre o fragmento para buscar.",
          "minLength": 1,
          "maxLength": 80
        },
        "role": {
          "type": "string",
          "description": "Profesión o alias español/inglés.",
          "minLength": 1,
          "maxLength": 80
        },
        "limit": {
          "type": "integer",
          "description": "Máximo de habitantes devueltos.",
          "minimum": 1,
          "maximum": 20
        }
      },
      "required": []
    }
  },
  {
    "name": "read_entity",
    "title": "Examinar un objetivo",
    "kind": "read",
    "description": "Lee identidad, posición, salud y tarea de un objetivo visible.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": true,
      "consequentialHint": false
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para examinar un objetivo.",
      "additionalProperties": false,
      "properties": {
        "target": {
          "type": "string",
          "description": "Nombre único o ID exacto del objetivo.",
          "minLength": 1,
          "maxLength": 80
        }
      },
      "required": [
        "target"
      ]
    }
  },
  {
    "name": "read_catalog",
    "title": "Consultar el catálogo",
    "kind": "read",
    "description": "Lee edificios, unidades, tecnologías, gremios o regiones y sus requisitos.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": true,
      "consequentialHint": false
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para consultar el catálogo.",
      "additionalProperties": false,
      "properties": {
        "category": {
          "type": "string",
          "description": "Catálogo a consultar.",
          "enum": [
            "units",
            "buildings",
            "technologies",
            "guilds",
            "maps"
          ]
        },
        "query": {
          "type": "string",
          "description": "Nombre o ID para filtrar.",
          "minLength": 1,
          "maxLength": 80
        }
      },
      "required": [
        "category"
      ]
    }
  },
  {
    "name": "read_roles",
    "title": "Resumen de profesiones",
    "kind": "read",
    "description": "Cuenta habitantes propios por oficio y explica los aliases de órdenes.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": true,
      "consequentialHint": false
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para resumen de profesiones.",
      "additionalProperties": false,
      "properties": {},
      "required": []
    }
  },
  {
    "name": "select_units",
    "title": "Seleccionar habitantes",
    "kind": "view",
    "description": "Selecciona habitantes propios por nombre, ID o profesión sin darles una orden.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": true,
      "consequentialHint": false
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para seleccionar habitantes.",
      "additionalProperties": false,
      "properties": {
        "target": {
          "type": "string",
          "description": "Nombre único, ID estable o profesión de habitantes propios. Omitir usa la selección actual.",
          "minLength": 1,
          "maxLength": 80
        },
        "mode": {
          "type": "string",
          "description": "Reemplazar o ampliar selección.",
          "enum": [
            "replace",
            "add"
          ]
        },
        "idle": {
          "type": "boolean",
          "description": "Filtrar aldeanos sin tarea."
        }
      },
      "required": [
        "target"
      ]
    }
  },
  {
    "name": "camera_view",
    "title": "Mirar el mapa",
    "kind": "view",
    "description": "Centra, desplaza o acerca la cámara; no da órdenes a unidades.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": true,
      "consequentialHint": false
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para mirar el mapa.",
      "additionalProperties": false,
      "properties": {
        "action": {
          "type": "string",
          "description": "Movimiento de cámara.",
          "enum": [
            "center",
            "selection",
            "pan",
            "zoom"
          ]
        },
        "x": {
          "type": "number",
          "description": "Coordenada horizontal en casillas del mapa.",
          "minimum": 0,
          "maximum": 79.99
        },
        "y": {
          "type": "number",
          "description": "Coordenada vertical en casillas del mapa.",
          "minimum": 0,
          "maximum": 79.99
        },
        "target": {
          "type": "string",
          "description": "Nombre o ID de un objetivo visible para centrar.",
          "minLength": 1,
          "maxLength": 80
        },
        "dx": {
          "type": "number",
          "description": "Desplazamiento horizontal en píxeles.",
          "minimum": -1000,
          "maximum": 1000
        },
        "dy": {
          "type": "number",
          "description": "Desplazamiento vertical en píxeles.",
          "minimum": -1000,
          "maximum": 1000
        },
        "factor": {
          "type": "number",
          "description": "Factor de acercamiento.",
          "minimum": 0.5,
          "maximum": 2
        }
      },
      "required": [
        "action"
      ]
    }
  },
  {
    "name": "open_panel",
    "title": "Abrir un panel",
    "kind": "view",
    "description": "Muestra ayuda, habitantes, mercado, conocimiento, guardar/cargar o el menú.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": true,
      "consequentialHint": false
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para abrir un panel.",
      "additionalProperties": false,
      "properties": {
        "panel": {
          "type": "string",
          "description": "Panel o vista del juego.",
          "enum": [
            "help",
            "roster",
            "market",
            "research",
            "save",
            "load",
            "new",
            "voice",
            "close",
            "menu",
            "continue"
          ]
        },
        "query": {
          "type": "string",
          "description": "Texto para buscar en habitantes.",
          "minLength": 1,
          "maxLength": 80
        }
      },
      "required": [
        "panel"
      ]
    }
  },
  {
    "name": "configure_match",
    "title": "Preparar una crónica",
    "kind": "view",
    "description": "Cambia los campos del menú; usa propose_new_match para iniciar inmediatamente la región elegida.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": true,
      "consequentialHint": false
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para preparar una crónica.",
      "additionalProperties": false,
      "properties": {
        "mapId": {
          "type": "string",
          "description": "Región del nuevo mundo.",
          "enum": [
            "valle-del-alba",
            "bosque-de-jade",
            "costa-de-los-faros",
            "islas-del-viento",
            "paso-nevado",
            "desierto-de-ambar",
            "pantano-de-luciernagas",
            "llanuras-de-otono",
            "caldera-carmesi",
            "jardin-celeste"
          ]
        },
        "guildId": {
          "type": "string",
          "description": "Gremio de la ciudad.",
          "enum": [
            "alba",
            "espina",
            "bastion",
            "eclipse"
          ]
        },
        "difficulty": {
          "type": "string",
          "description": "Desafío de la IA.",
          "enum": [
            "easy",
            "normal",
            "hard"
          ]
        },
        "mode": {
          "type": "string",
          "description": "Camino pacífico o de conquista.",
          "enum": [
            "peaceful",
            "conquest"
          ]
        }
      },
      "required": []
    }
  },
  {
    "name": "control_group",
    "title": "Grupo de control",
    "kind": "view",
    "description": "Guarda o recupera una selección en los grupos de teclado uno a nueve.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": true,
      "consequentialHint": false
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para grupo de control.",
      "additionalProperties": false,
      "properties": {
        "action": {
          "type": "string",
          "description": "Guardar o recuperar.",
          "enum": [
            "assign",
            "recall"
          ]
        },
        "group": {
          "type": "integer",
          "description": "Número de grupo.",
          "minimum": 1,
          "maximum": 9
        }
      },
      "required": [
        "action",
        "group"
      ]
    }
  },
  {
    "name": "show_catalog",
    "title": "Mostrar una categoría",
    "kind": "view",
    "description": "Muestra las tarjetas reales de ciudad, ejército, defensas o saber.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": true,
      "consequentialHint": false
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para mostrar una categoría.",
      "additionalProperties": false,
      "properties": {
        "tab": {
          "type": "string",
          "description": "Categoría de construcción.",
          "enum": [
            "economy",
            "military",
            "defense",
            "knowledge"
          ]
        }
      },
      "required": [
        "tab"
      ]
    }
  },
  {
    "name": "propose_rename",
    "title": "Cambiar un nombre",
    "kind": "consequential",
    "description": "Cambia inmediatamente el nombre de un habitante propio; valida que sea único.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para cambiar un nombre.",
      "additionalProperties": false,
      "properties": {
        "target": {
          "type": "string",
          "description": "Nombre único o ID del habitante propio. Si se omite: unidades seleccionadas compatibles o habitantes propios adecuados para la orden; constructores inactivos antes que ocupados.",
          "minLength": 1,
          "maxLength": 80
        },
        "name": {
          "type": "string",
          "description": "Nuevo nombre único visible.",
          "minLength": 1,
          "maxLength": 40
        }
      },
      "required": [
        "target",
        "name"
      ]
    }
  },
  {
    "name": "propose_move",
    "title": "Mover habitantes",
    "kind": "consequential",
    "description": "Ordena inmediatamente una marcha normal u ofensiva al destino real y conserva la formación elegida; por defecto usa caja. Resuelve lugares sin solicitar coordenadas ni confirmación.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para mover habitantes.",
      "additionalProperties": false,
      "properties": {
        "target": {
          "type": "string",
          "description": "Nombre único, ID estable o profesión de habitantes propios. Omitir usa la selección actual. Si se omite: unidades seleccionadas compatibles o habitantes propios adecuados para la orden; constructores inactivos antes que ocupados.",
          "minLength": 1,
          "maxLength": 80
        },
        "x": {
          "type": "number",
          "description": "Coordenada horizontal en casillas del mapa.",
          "minimum": 0,
          "maximum": 79.99
        },
        "y": {
          "type": "number",
          "description": "Coordenada vertical en casillas del mapa.",
          "minimum": 0,
          "maximum": 79.99
        },
        "attackMove": {
          "type": "boolean",
          "description": "Atacar enemigos encontrados durante la marcha."
        },
        "formation": {
          "type": "string",
          "description": "Formación de marcha: línea, caja o escalonada. Omitir conserva la formación del grupo o usa caja.",
          "enum": ["line", "box", "staggered"]
        },
        "destination": {
          "type": "string",
          "description": "Destino natural del mapa: mi base, base enemiga, cuartel, bosque más cercano; sanación: heridos o nombre propio. No inventes ni solicites coordenadas.",
          "minLength": 1,
          "maxLength": 120
        }
      },
      "required": []
    }
  },
  {
    "name": "propose_formation",
    "title": "Cambiar formación",
    "kind": "consequential",
    "description": "Reagrupa inmediatamente los habitantes en línea, caja o formación escalonada. Sin destino, usa el centro del grupo. No pide coordenadas ni confirmación.",
    "allowedRoles": ["commander"],
    "annotations": { "readOnlyHint": false, "consequentialHint": true },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para cambiar la formación de habitantes.",
      "additionalProperties": false,
      "properties": {
        "target": {
          "type": "string",
          "description": "Nombre, ID o profesión de habitantes propios. Omitir usa la selección actual o el ejército propio.",
          "minLength": 1,
          "maxLength": 80
        },
        "kind": {
          "type": "string",
          "description": "Formación: line es línea, box es caja y staggered es escalonada.",
          "enum": ["line", "box", "staggered"]
        },
        "x": {
          "type": "number",
          "description": "Coordenada horizontal opcional del centro de formación; requiere y.",
          "minimum": 0,
          "maximum": 79.99
        },
        "y": {
          "type": "number",
          "description": "Coordenada vertical opcional del centro de formación; requiere x.",
          "minimum": 0,
          "maximum": 79.99
        },
        "destination": {
          "type": "string",
          "description": "Lugar natural opcional para reagruparse, por ejemplo mi base. Omitir usa el centro actual del grupo.",
          "minLength": 1,
          "maxLength": 120
        }
      },
      "required": ["kind"]
    }
  },
  {
    "name": "propose_gather",
    "title": "Recolectar un recurso",
    "kind": "consequential",
    "description": "Ordena inmediatamente recoger, transportar y depositar desde un recurso concreto.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para recolectar un recurso.",
      "additionalProperties": false,
      "properties": {
        "target": {
          "type": "string",
          "description": "Nombre único, ID estable o profesión de habitantes propios. Omitir usa la selección actual. Si se omite: unidades seleccionadas compatibles o habitantes propios adecuados para la orden; constructores inactivos antes que ocupados.",
          "minLength": 1,
          "maxLength": 80
        },
        "resource": {
          "type": "string",
          "description": "Recurso a buscar.",
          "enum": [
            "wood",
            "food",
            "gold",
            "stone",
            "fish"
          ]
        },
        "targetId": {
          "type": "string",
          "description": "ID exacto del recurso o huerto visible.",
          "minLength": 1,
          "maxLength": 80
        },
        "destination": {
          "type": "string",
          "description": "Recurso natural: bosque más cercano, oro cercano, comida, piedra o pesca.",
          "minLength": 1,
          "maxLength": 120
        }
      },
      "required": []
    }
  },
  {
    "name": "propose_build",
    "title": "Construir un edificio",
    "kind": "consequential",
    "description": "Construye inmediatamente con aldeanos y casillas válidas; cobra los recursos del juego. Resuelve el lugar desde el mapa real; las coordenadas son opcionales y se conservan para órdenes explícitas.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para construir un edificio.",
      "additionalProperties": false,
      "properties": {
        "target": {
          "type": "string",
          "description": "Nombre único, ID estable o profesión de habitantes propios. Omitir usa la selección actual. Si se omite: unidades seleccionadas compatibles o habitantes propios adecuados para la orden; constructores inactivos antes que ocupados.",
          "minLength": 1,
          "maxLength": 80
        },
        "kind": {
          "type": "string",
          "description": "ID del edificio del catálogo.",
          "enum": [
            "guildhall",
            "house",
            "farm",
            "lumber_camp",
            "mill",
            "mining_camp",
            "barracks",
            "archery",
            "stable",
            "arcane_tower",
            "sanctuary",
            "forge",
            "market",
            "academy",
            "watchtower",
            "fortress",
            "palisade",
            "wall",
            "gate",
            "dock",
            "wonder",
            "siege_workshop",
            "granary",
            "university"
          ]
        },
        "x": {
          "type": "integer",
          "description": "Casilla horizontal del edificio.",
          "minimum": 0,
          "maximum": 79
        },
        "y": {
          "type": "integer",
          "description": "Casilla vertical del edificio.",
          "minimum": 0,
          "maximum": 79
        },
        "location": {
          "type": "string",
          "description": "Lugar natural del mapa: mi base, detrás del cuartel, al lado del cuartel; murallas: norte, sur, este u oeste. Si se omite, buscar espacio legal accesible cerca de la base.",
          "minLength": 1,
          "maxLength": 120
        }
      },
      "required": [
        "kind"
      ]
    }
  },
  {
    "name": "propose_wall",
    "title": "Trazar una muralla",
    "kind": "consequential",
    "description": "Construye inmediatamente una línea válida de muralla o empalizada; cobra el coste total. Resuelve el lugar desde el mapa real; las coordenadas son opcionales y se conservan para órdenes explícitas.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para trazar una muralla.",
      "additionalProperties": false,
      "properties": {
        "target": {
          "type": "string",
          "description": "Nombre único, ID estable o profesión de habitantes propios. Omitir usa la selección actual. Si se omite: unidades seleccionadas compatibles o habitantes propios adecuados para la orden; constructores inactivos antes que ocupados.",
          "minLength": 1,
          "maxLength": 80
        },
        "kind": {
          "type": "string",
          "description": "Material de la línea.",
          "enum": [
            "wall",
            "palisade"
          ]
        },
        "x": {
          "type": "integer",
          "description": "Casilla horizontal del edificio.",
          "minimum": 0,
          "maximum": 79
        },
        "y": {
          "type": "integer",
          "description": "Casilla vertical del edificio.",
          "minimum": 0,
          "maximum": 79
        },
        "endX": {
          "type": "integer",
          "description": "Casilla horizontal final.",
          "minimum": 0,
          "maximum": 79
        },
        "endY": {
          "type": "integer",
          "description": "Casilla vertical final.",
          "minimum": 0,
          "maximum": 79
        },
        "location": {
          "type": "string",
          "description": "Lugar natural del mapa: mi base, detrás del cuartel, al lado del cuartel; murallas: norte, sur, este u oeste. Si se omite, buscar espacio legal accesible cerca de la base.",
          "minLength": 1,
          "maxLength": 120
        },
        "length": {
          "type": "integer",
          "description": "Número de segmentos para ubicación natural; por defecto siete.",
          "minimum": 1,
          "maximum": 15
        }
      },
      "required": [
        "kind"
      ]
    }
  },
  {
    "name": "propose_repair",
    "title": "Reparar un edificio",
    "kind": "consequential",
    "description": "Ordena inmediatamente reparar un edificio propio con aldeanos y presupuesto de madera limitado.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para reparar un edificio.",
      "additionalProperties": false,
      "properties": {
        "target": {
          "type": "string",
          "description": "Nombre único, ID estable o profesión de habitantes propios. Omitir usa la selección actual. Si se omite: unidades seleccionadas compatibles o habitantes propios adecuados para la orden; constructores inactivos antes que ocupados.",
          "minLength": 1,
          "maxLength": 80
        },
        "building": {
          "type": "string",
          "description": "Nombre o ID del edificio dañado.",
          "minLength": 1,
          "maxLength": 80
        }
      },
      "required": [
        "building"
      ]
    }
  },
  {
    "name": "propose_train",
    "title": "Entrenar habitantes",
    "kind": "consequential",
    "description": "Recluta inmediatamente la cantidad indicada en un productor propio compatible; valida recursos y población.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para entrenar habitantes.",
      "additionalProperties": false,
      "properties": {
        "kind": {
          "type": "string",
          "description": "ID de la unidad.",
          "enum": [
            "villager",
            "infantry",
            "scout",
            "archer",
            "cavalry",
            "heavy_knight",
            "assassin",
            "mage",
            "healer",
            "wizard",
            "siege_engine",
            "fishing_boat",
            "war_boat"
          ]
        },
        "quantity": {
          "type": "integer",
          "description": "Cantidad exacta de reclutas.",
          "minimum": 1,
          "maximum": 100
        },
        "building": {
          "type": "string",
          "description": "Nombre único o ID estable del edificio propio. Si se omite, se usa la selección o el único productor compatible. Si se omite: productor seleccionado compatible o el de menor cola.",
          "minLength": 1,
          "maxLength": 80
        }
      },
      "required": [
        "kind",
        "quantity"
      ]
    }
  },
  {
    "name": "propose_cancel_train",
    "title": "Cancelar una cola",
    "kind": "consequential",
    "description": "Cancela inmediatamente una entrada exacta de la cola y devuelve sus recursos del juego.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para cancelar una cola.",
      "additionalProperties": false,
      "properties": {
        "building": {
          "type": "string",
          "description": "Nombre único o ID estable del edificio propio. Si se omite, se usa la selección o el único productor compatible.",
          "minLength": 1,
          "maxLength": 80
        },
        "queueIndex": {
          "type": "integer",
          "description": "Índice de cola, comenzando en cero.",
          "minimum": 0,
          "maximum": 99
        }
      },
      "required": [
        "building",
        "queueIndex"
      ]
    }
  },
  {
    "name": "propose_attack",
    "title": "Atacar un objetivo",
    "kind": "consequential",
    "description": "Ordena inmediatamente atacar un objetivo enemigo exacto; no adivina nombres ambiguos.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para atacar un objetivo.",
      "additionalProperties": false,
      "properties": {
        "target": {
          "type": "string",
          "description": "Nombre único, ID estable o profesión de habitantes propios. Omitir usa la selección actual. Si se omite: unidades seleccionadas compatibles o habitantes propios adecuados para la orden; constructores inactivos antes que ocupados.",
          "minLength": 1,
          "maxLength": 80
        },
        "enemy": {
          "type": "string",
          "description": "Objetivo rival por nombre, tipo o lugar: base enemiga, enemigo más cercano. Si se omite, el enemigo más cercano. No requiere ID.",
          "minLength": 1,
          "maxLength": 80
        }
      },
      "required": []
    }
  },
  {
    "name": "propose_defend",
    "title": "Defender una posición",
    "kind": "consequential",
    "description": "Ordena inmediatamente defender la posición actual o un edificio propio concreto.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para defender una posición.",
      "additionalProperties": false,
      "properties": {
        "target": {
          "type": "string",
          "description": "Nombre único, ID estable o profesión de habitantes propios. Omitir usa la selección actual. Si se omite: unidades seleccionadas compatibles o habitantes propios adecuados para la orden; constructores inactivos antes que ocupados.",
          "minLength": 1,
          "maxLength": 80
        },
        "anchor": {
          "type": "string",
          "description": "Nombre o ID de un edificio propio que defender.",
          "minLength": 1,
          "maxLength": 80
        },
        "x": {
          "type": "number",
          "description": "Coordenada horizontal en casillas del mapa.",
          "minimum": 0,
          "maximum": 79.99
        },
        "y": {
          "type": "number",
          "description": "Coordenada vertical en casillas del mapa.",
          "minimum": 0,
          "maximum": 79.99
        }
      },
      "required": []
    }
  },
  {
    "name": "propose_stop_units",
    "title": "Detener habitantes",
    "kind": "consequential",
    "description": "Detiene inmediatamente las tareas de los habitantes indicados; no revierte gastos ni acciones completadas.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para detener habitantes.",
      "additionalProperties": false,
      "properties": {
        "target": {
          "type": "string",
          "description": "Nombre único, ID estable o profesión de habitantes propios. Omitir usa la selección actual. Si se omite: unidades seleccionadas compatibles o habitantes propios adecuados para la orden; constructores inactivos antes que ocupados.",
          "minLength": 1,
          "maxLength": 80
        }
      },
      "required": []
    }
  },
  {
    "name": "propose_cast",
    "title": "Lanzar un hechizo",
    "kind": "consequential",
    "description": "Lanza inmediatamente sanación o bola de fuego con lanzadores, posición y maná válidos. Resuelve el lugar desde el mapa real; las coordenadas son opcionales y se conservan para órdenes explícitas.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para lanzar un hechizo.",
      "additionalProperties": false,
      "properties": {
        "target": {
          "type": "string",
          "description": "Nombre único, ID estable o profesión de habitantes propios. Omitir usa la selección actual. Si se omite: unidades seleccionadas compatibles o habitantes propios adecuados para la orden; constructores inactivos antes que ocupados.",
          "minLength": 1,
          "maxLength": 80
        },
        "spell": {
          "type": "string",
          "description": "Hechizo del catálogo.",
          "enum": [
            "heal",
            "fireball"
          ]
        },
        "x": {
          "type": "number",
          "description": "Coordenada horizontal en casillas del mapa.",
          "minimum": 0,
          "maximum": 79.99
        },
        "y": {
          "type": "number",
          "description": "Coordenada vertical en casillas del mapa.",
          "minimum": 0,
          "maximum": 79.99
        },
        "destination": {
          "type": "string",
          "description": "Destino natural del mapa: mi base, base enemiga, cuartel, bosque más cercano; sanación: heridos o nombre propio. No inventes ni solicites coordenadas.",
          "minLength": 1,
          "maxLength": 120
        }
      },
      "required": [
        "spell"
      ]
    }
  },
  {
    "name": "propose_convert",
    "title": "Convertir un rival",
    "kind": "consequential",
    "description": "Ordena inmediatamente convertir una unidad rival con hechiceros propios preparados.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para convertir un rival.",
      "additionalProperties": false,
      "properties": {
        "target": {
          "type": "string",
          "description": "Nombre único, ID estable o profesión de habitantes propios. Omitir usa la selección actual. Si se omite: unidades seleccionadas compatibles o habitantes propios adecuados para la orden; constructores inactivos antes que ocupados.",
          "minLength": 1,
          "maxLength": 80
        },
        "enemy": {
          "type": "string",
          "description": "Nombre único o ID de la unidad rival.",
          "minLength": 1,
          "maxLength": 80
        }
      },
      "required": [
        "enemy"
      ]
    }
  },
  {
    "name": "propose_rally",
    "title": "Punto de reunión",
    "kind": "consequential",
    "description": "Fija inmediatamente el destino de nuevos reclutas. Si eliges un recurso o huerto real, los trabajadores compatibles salen a recolectar. Usa el productor seleccionado si omites edificio; no pide coordenadas ni confirmación.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para punto de reunión.",
      "additionalProperties": false,
      "properties": {
        "building": {
          "type": "string",
          "description": "Nombre único o ID estable del edificio propio. Si se omite, se usa la selección o el único productor compatible.",
          "minLength": 1,
          "maxLength": 80
        },
        "targetId": {
          "type": "string",
          "description": "ID exacto de un recurso o huerto real para que los nuevos trabajadores compatibles recolecten.",
          "minLength": 1,
          "maxLength": 80
        },
        "x": {
          "type": "number",
          "description": "Coordenada horizontal en casillas del mapa.",
          "minimum": 0,
          "maximum": 79.99
        },
        "y": {
          "type": "number",
          "description": "Coordenada vertical en casillas del mapa.",
          "minimum": 0,
          "maximum": 79.99
        },
        "destination": {
          "type": "string",
          "description": "Destino natural del mapa: mi base, base enemiga, cuartel, bosque más cercano; sanación: heridos o nombre propio. No inventes ni solicites coordenadas.",
          "minLength": 1,
          "maxLength": 120
        }
      },
      "required": []
    }
  },
  {
    "name": "propose_research",
    "title": "Investigar conocimiento",
    "kind": "consequential",
    "description": "Inicia inmediatamente una tecnología del catálogo en su edificio compatible.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para investigar conocimiento.",
      "additionalProperties": false,
      "properties": {
        "technologyId": {
          "type": "string",
          "description": "ID exacto de tecnología.",
          "enum": [
            "wheelbarrow",
            "agriculture",
            "forging",
            "armor",
            "fletching",
            "trade_routes",
            "arcane_mastery",
            "faith",
            "masonry",
            "ballistics",
            "navigation"
          ]
        },
        "building": {
          "type": "string",
          "description": "Nombre único o ID estable del edificio propio. Si se omite, se usa la selección o el único productor compatible. Si se omite: productor seleccionado compatible o el de menor cola.",
          "minLength": 1,
          "maxLength": 80
        }
      },
      "required": [
        "technologyId"
      ]
    }
  },
  {
    "name": "propose_advance_age",
    "title": "Avanzar de era",
    "kind": "consequential",
    "description": "Inicia inmediatamente la siguiente era en la Casa del Gremio si cumple coste y requisitos.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para avanzar de era.",
      "additionalProperties": false,
      "properties": {
        "building": {
          "type": "string",
          "description": "Nombre único o ID estable del edificio propio. Si se omite, se usa la selección o el único productor compatible. Si se omite: productor seleccionado compatible o el de menor cola.",
          "minLength": 1,
          "maxLength": 80
        }
      },
      "required": []
    }
  },
  {
    "name": "propose_trade",
    "title": "Intercambiar recursos",
    "kind": "consequential",
    "description": "Compra o vende inmediatamente recursos virtuales del juego al precio actual en oro virtual.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para intercambiar recursos.",
      "additionalProperties": false,
      "properties": {
        "resource": {
          "type": "string",
          "description": "Recurso del intercambio.",
          "enum": [
            "wood",
            "food",
            "stone"
          ]
        },
        "amount": {
          "type": "integer",
          "description": "Cantidad exacta, hasta cien.",
          "minimum": 1,
          "maximum": 100
        },
        "direction": {
          "type": "string",
          "description": "Comprar o vender.",
          "enum": [
            "buy",
            "sell"
          ]
        }
      },
      "required": [
        "resource",
        "amount",
        "direction"
      ]
    }
  },
  {
    "name": "propose_gate",
    "title": "Abrir o cerrar puerta",
    "kind": "consequential",
    "description": "Abre o cierra inmediatamente una puerta propia y recalcula los caminos.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para abrir o cerrar puerta.",
      "additionalProperties": false,
      "properties": {
        "building": {
          "type": "string",
          "description": "Nombre único o ID estable del edificio propio. Si se omite, se usa la selección o el único productor compatible.",
          "minLength": 1,
          "maxLength": 80
        },
        "open": {
          "type": "boolean",
          "description": "Abrir si es verdadero; cerrar si es falso."
        }
      },
      "required": [
        "building",
        "open"
      ]
    }
  },
  {
    "name": "propose_pause",
    "title": "Pausar o continuar",
    "kind": "consequential",
    "description": "Cambia inmediatamente la pausa de la simulación sólo cuando la persona lo pide.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para pausar o continuar.",
      "additionalProperties": false,
      "properties": {
        "paused": {
          "type": "boolean",
          "description": "Nuevo estado de pausa."
        }
      },
      "required": [
        "paused"
      ]
    }
  },
  {
    "name": "propose_speed",
    "title": "Velocidad de la crónica",
    "kind": "consequential",
    "description": "Cambia inmediatamente la velocidad a media, normal o doble.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para velocidad de la crónica.",
      "additionalProperties": false,
      "properties": {
        "speed": {
          "type": "number",
          "description": "Multiplicador de velocidad de la simulación.",
          "enum": [
            0.5,
            1,
            2
          ]
        }
      },
      "required": [
        "speed"
      ]
    }
  },
  {
    "name": "propose_new_match",
    "title": "Comenzar una nueva crónica",
    "kind": "consequential",
    "description": "Reemplaza inmediatamente la partida por la región, gremio y desafío pedidos.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para comenzar una nueva crónica.",
      "additionalProperties": false,
      "properties": {
        "mapId": {
          "type": "string",
          "description": "Región del nuevo mundo.",
          "enum": [
            "valle-del-alba",
            "bosque-de-jade",
            "costa-de-los-faros",
            "islas-del-viento",
            "paso-nevado",
            "desierto-de-ambar",
            "pantano-de-luciernagas",
            "llanuras-de-otono",
            "caldera-carmesi",
            "jardin-celeste"
          ]
        },
        "guildId": {
          "type": "string",
          "description": "Gremio de la ciudad.",
          "enum": [
            "alba",
            "espina",
            "bastion",
            "eclipse"
          ]
        },
        "difficulty": {
          "type": "string",
          "description": "Desafío de la IA.",
          "enum": [
            "easy",
            "normal",
            "hard"
          ]
        },
        "mode": {
          "type": "string",
          "description": "Camino pacífico o de conquista.",
          "enum": [
            "peaceful",
            "conquest"
          ]
        }
      },
      "required": [
        "mapId",
        "guildId",
        "difficulty",
        "mode"
      ]
    }
  },
  {
    "name": "propose_save",
    "title": "Guardar la crónica",
    "kind": "consequential",
    "description": "Guarda inmediatamente la partida local y descarga su archivo.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para guardar la crónica.",
      "additionalProperties": false,
      "properties": {},
      "required": []
    }
  },
  {
    "name": "propose_load",
    "title": "Continuar la copia local",
    "kind": "consequential",
    "description": "Carga inmediatamente la copia local válida; la persona elige manualmente un archivo externo.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para continuar la copia local.",
      "additionalProperties": false,
      "properties": {},
      "required": []
    }
  },
  {
    "name": "confirm_action",
    "title": "Compatibilidad de órdenes",
    "kind": "control",
    "description": "Compatibilidad antigua: no realiza ninguna acción en el modo inmediato. No llames esta herramienta.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": false
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos antiguos de compatibilidad; no ejecutan ninguna orden en el modo inmediato.",
      "additionalProperties": false,
      "properties": {
        "proposalId": {
          "type": "string",
          "description": "Identificador antiguo; ignorado en el modo inmediato.",
          "minLength": 1,
          "maxLength": 100
        },
        "confirmationText": {
          "type": "string",
          "description": "Texto antiguo de compatibilidad; ignorado en el modo inmediato.",
          "minLength": 1,
          "maxLength": 160
        }
      },
      "required": [
        "proposalId",
        "confirmationText"
      ]
    }
  },
  {
    "name": "stop_action",
    "title": "Alto, detener unidades",
    "kind": "consequential",
    "description": "Detiene inmediatamente unidades seleccionadas o de la última orden de voz; no deshace acciones completadas ni devuelve gastos.",
    "allowedRoles": [
      "commander"
    ],
    "annotations": {
      "readOnlyHint": false,
      "consequentialHint": true
    },
    "inputSchema": {
      "type": "object",
      "description": "Argumentos para detener inmediatamente las unidades indicadas por el contexto actual.",
      "additionalProperties": false,
      "properties": {
        "proposalId": {
          "type": "string",
          "description": "Identificador antiguo opcional; el modo inmediato detiene las unidades del contexto actual.",
          "minLength": 1,
          "maxLength": 100
        }
      },
      "required": []
    }
  }
];
