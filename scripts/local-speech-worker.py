"""A server-owned, offline Spanish Vosk worker. JSON lines in/out; no microphone or network."""
import json
import os
from pathlib import Path
import sys
import time
import wave
from vosk import Model, KaldiRecognizer, SetLogLevel

ROOT = Path(__file__).resolve().parents[1]
TEMP = (ROOT / '.local' / 'speech' / 'tmp').resolve()
MODEL = Path(os.environ.get('GUILD_VOSK_MODEL_PATH', ROOT / '.local' / 'voice' / 'models' / 'vosk-model-small-es-0.42')).resolve()
if not TEMP.is_relative_to(ROOT):
    raise SystemExit(2)
SetLogLevel(-1)
model = Model(str(MODEL))
print(json.dumps({'ready': True, 'model': 'vosk-model-small-es-0.42'}), flush=True)
for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        audio_path = Path(request['file']).resolve()
        if not audio_path.is_relative_to(TEMP) or audio_path.suffix != '.wav':
            raise ValueError('AUDIO_PATH_REJECTED')
        start = time.monotonic()
        parts = []
        with wave.open(str(audio_path), 'rb') as audio:
            duration = audio.getnframes() / audio.getframerate()
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000) or not .05 <= duration <= 8:
                raise ValueError('AUDIO_FORMAT_REJECTED')
            recognizer = KaldiRecognizer(model, 16000)
            while data := audio.readframes(4000):
                if recognizer.AcceptWaveform(data):
                    parts.append(json.loads(recognizer.Result()).get('text', ''))
            parts.append(json.loads(recognizer.FinalResult()).get('text', ''))
        print(json.dumps({'id': request['id'], 'ok': True, 'transcript': ' '.join(parts).strip()[:240], 'durationSeconds': duration, 'inferenceSeconds': round(time.monotonic() - start, 4)}, ensure_ascii=True), flush=True)
    except Exception:
        print(json.dumps({'id': request.get('id'), 'ok': False, 'code': 'LOCAL_ASR_FAILED'}), flush=True)
