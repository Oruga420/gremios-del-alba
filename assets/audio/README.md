# Audio de Gremios del Alba

Todo el audio es **opcional**: si falta un archivo, el juego simplemente no lo reproduce (sin errores). La lista oficial está en [`manifest.json`](manifest.json).

## Dónde va cada archivo

| Tipo | Ruta | Idioma |
| --- | --- | --- |
| Efectos de sonido | `assets/audio/sfx/<id>.mp3` | Neutro (uno para todos) |
| Frases del narrador | `assets/audio/voice/<idioma>/<id>.mp3` | Uno por idioma: `es`, `en`, `pt`, `ja`, `ar`, `de`, `fr` |

- `<id>` es el `id` del manifiesto (por ejemplo `sfx/ui_click.mp3`, `voice/ja/victory.mp3`).
- Formato: MP3, 44,1 kHz, 128 kbps. Efectos cortos (la duración sugerida está en `duration_seconds`).
- El narrador habla en el idioma de la interfaz elegido en el juego.

## Opción A: descargar desde ElevenLabs a mano

1. **Efectos**: en *Sound Effects*, pega el `prompt` de cada efecto del manifiesto, ajusta la duración a `duration_seconds`, genera y descarga el MP3 como `sfx/<id>.mp3`.
2. **Frases**: en *Text to Speech* (modelo *Eleven Multilingual v2*), elige una voz por idioma (ver `voice_hint`), pega el texto `text.<idioma>` de cada línea y descarga como `voice/<idioma>/<id>.mp3`.
3. Si existe `assets/audio/available.json` (lo crea el script), bórralo o ejecuta `node scripts/generate-audio.mjs --index` para que el juego vea los archivos nuevos.

## Opción B: generar con el script

1. En `.env` (nunca se sube al repositorio):
   ```
   ELEVENLABS_API_KEY=...
   ELEVENLABS_VOICE_ID=...        # voz por defecto
   ELEVENLABS_VOICE_ES=...        # opcional, una por idioma (ES, EN, PT, JA, AR, DE, FR)
   ```
2. Revisa qué se va a crear (sin gastar créditos):
   `node --env-file-if-exists=.env scripts/generate-audio.mjs --dry-run`
3. Genera lo que falte (**gasta créditos de tu cuenta**):
   `node --env-file-if-exists=.env scripts/generate-audio.mjs`

Opciones: `--only=sfx|voice`, `--lang=es,en`, `--id=victory,ui_click`, `--force` (sobrescribe archivos existentes), `--index` (solo regenera `available.json`). Nunca sobrescribe nada sin `--force`.

En el juego, el botón del altavoz de la barra superior (o la tecla **M**) silencia o activa el sonido; la preferencia se guarda en el navegador.
