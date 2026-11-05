# Gilden der Morgenröte

[Español](README.md) · [English](README.en.md) · [Português](README.pt.md) · [日本語](README.ja.md) · [العربية](README.ar.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

Ein **Open-Source**-Fantasy-RTS, spielbar im Browser, mit Dorfbewohnern mit
Namen, Gilden, Bauen, Rohstoffen, Mauern, Kampf und Befehlen auf Spanisch.

Der aktuelle Umfang umfasst Schlachten und Gefechte gegen die KI, mit Wirtschaft,
Bau und Kampf auf aufgedeckten Karten. Kampagnen sind nicht enthalten.

![Gremios del Alba](assets/hero.png)

## Lokal spielen

Voraussetzungen: **Node.js 24 oder neuer** und ein moderner Browser. Es müssen keine
npm-Abhängigkeiten installiert werden.

```sh
git clone https://github.com/Oruga420/gremios-del-alba.git
cd gremios-del-alba
npm start
```

Öffne **http://127.0.0.1:4173**. Unter Windows kannst du auch `PLAY.cmd` verwenden.
Der Server ist für die lokale Nutzung gedacht und lauscht auf Loopback.

## Was enthalten ist

- Zehn vollständig aufgedeckte Karten und vier eigene Gilden.
- Sammeln, Tragen und Abliefern; Dorfbewohner suchen erreichbare Rohstoffe,
  wenn eine Quelle erschöpft ist, und behalten ihre Last, wenn ein Lager fehlt.
- Bauen, Reparieren, Mauern und Tore.
- Formationen in Linie, Block und gestaffelt, mit individuellen Zielen und
  gemeinsamen Wegen. Die Wahl bleibt erhalten, wenn die Gruppe bewegt wird.
- Sammelpunkte auf Rohstoffen und Gemüsegärten: Neue Arbeiter beginnen mit dem
  Sammeln, sobald sie das Gebäude verlassen.
- Rekrutierung, Technologien, Zeitalter, Handel und ein Limit von 1.000 Bewohnern pro Stadt.
- Ritter, Bogenschützen, Meuchler, Magier, Heiler und weitere Rollen; Kampfanimationen,
  Blut und Leichen.
- Speichern/Laden als JSON, Auswahl per Ziehen, Gruppen und Minikarte.
- Befehlsparser auf Spanisch und WebMCP-Seitenwerkzeuge.
- Optionaler Sprachagent mit eigenem Konto und eigenen Zugangsdaten des Nutzers.

Wähle Einheiten durch Ziehen aus; ein Rechtsklick gibt einen Befehl. Nutze die
unteren Karten zum Bauen oder Ausbilden und die Leertaste zum Pausieren.
Die Hilfe im Spiel enthält weitere Steuerungen. Sind mehrere Einheiten ausgewählt,
nutze die Schaltflächen **Linie**, **Block** und **Gestaffelt**, um sie neu zu formieren. Wähle
ein Produktionsgebäude und klicke mit rechts auf einen Rohstoff, um seine neuen
Arbeiter dorthin zu schicken. Das Auswahlfenster zeigt ihre Last und ob sie sammeln,
abliefern oder auf einen erreichbaren Rohstoff oder ein erreichbares Lager warten.

Wird ein Sammelbefehl für denselben Rohstoff wiederholt, bleiben Aufgabe,
Weg und Last erhalten. Während eines Angriffsmarschs nehmen die Einheiten ihr Ziel
wieder auf, wenn sie einen automatisch entdeckten Feind nicht erreichen können. Ein
ausdrücklicher Angriff behält das von dir gewählte Ziel bei.

## Stimme und WebMCP

Geschriebene Befehle und das Spiel funktionieren ohne API-Keys. Die Spracherkennung
des Browsers hängt von dessen Kompatibilität und Berechtigungen ab. Beispielbefehle:
**„Baue ein Haus“**, **„Dorfbewohner, sammelt Holz“**, **„Bilde eine Linie“**,
**„gestaffelte Formation“**, **„Bewege die Bogenschützen im Block zu meiner Basis“** und
**„Sammelpunkt der Gildenhalle zum Wald“**. Ziele werden anhand der aktuellen Welt
aufgelöst. Befehle werden sofort ausgeführt, ohne Bestätigung und ohne
Koordinaten; **„Halt“** hält die Einheiten an.

Für den Gesprächsagenten erstellst du deinen eigenen privaten Agent bei ElevenLabs und
kopierst `.env.example` nach `.env`. Lege `ELEVENLABS_API_KEY` und
`ELEVENLABS_AGENT_ID` fest und starte den Server anschließend neu. Der Schlüssel bleibt auf dem
Server. Die Nutzung des Anbieters ist optional und kann auf deinem Konto Kosten verursachen.
`npm run voice:definition` exportiert lokal eine Definition mit den Werkzeugen
des Spiels; wähle deine Stimme und dein Modell beim Anbieter oder über die Optionen
des Beispiels. Durch die Installation des Spiels werden weder Agenten erstellt noch Anrufe getätigt.

Die Offline-Erkennung ist optional und erfordert Python, Vosk, FFmpeg und ein
spanisches Modell. Konfiguriere `GUILD_PYTHON_PATH`, `GUILD_FFMPEG_PATH` und
`GUILD_VOSK_MODEL_PATH`. Modelle und Aufnahmen sind nicht enthalten.

`PLAY-WEBMCP.cmd` startet ein kompatibles Chrome mit dem WebMCP-Flag und einem eigenen
lokalen Profil. Das Spiel meldet die tatsächlich verfügbare Fähigkeit. Dieses Profil
hat seinen eigenen Speicherstand: Nutze den JSON-Export/-Import, um eine Partie zu übertragen.

## Entwicklung und Tests

```sh
npm test
npm run check
npm run build
```

`dist/` enthält den generierten statischen Client. Der lokale Server enthält die
Routen für Stimme und Offline-Erkennung; auf Vercel stellt `api/guild.mjs` die
Routen von Sota bereit, ohne auf einen eingeschalteten Computer angewiesen zu sein. Das Inventar der
Werkzeuge liegt in `docs/voice/clickables.json`; der Vertrag der Engine liegt
in `docs/engine-interface.md`.

### Deployment auf Vercel

Importiere dieses Repository mit Node 24 und behalte `vercel.json` bei. Der Client wird
nach `dist/` kompiliert; die Routen `/api/*` laufen als Node-Funktion ohne
zusätzliche Abhängigkeiten. Partien werden in deinem Browser gespeichert oder als
JSON exportiert. Die Offline-Erkennung mit Vosk steht in der lokalen Version zur Verfügung;
über den öffentlichen Vercel-Link nutzt du die Browser-Stimme oder tippst Befehle ein.

Aktiviere **Vercel Authentication → Standard Protection** im Projekt. Die
Produktionsdomain erlaubt das Spielen ohne Anmeldung. Die eindeutigen
Deployment-Adressen bleiben privat: Der persönliche Sota stellt Autorisierungen nur über
den geschützten Host aus, den Vercel in `VERCEL_URL` bereitstellt. Die Browser-Stimme und
geschriebene Befehle sind im öffentlichen Spiel verfügbar. Lege als verschlüsselte
Produktionsvariablen `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`,
`GUILD_PUBLIC_ORIGIN` (der exakte HTTPS-Origin), `GUILD_SESSION_SECRET` (zufällig,
mindestens 32 Zeichen) und `GUILD_DEPLOYMENT_PROTECTION=vercel-auth` fest.
Lege ihre Werte nicht auf GitHub ab. Der Indikator gibt den konfigurierten Schutz an;
er ersetzt nicht die Zugriffskontrolle von Vercel. Deaktiviere den Schutz der
eindeutigen Adressen nicht, wenn du den kostenpflichtigen Agenten aktivierst. Die öffentliche Domain stellt
niemals ElevenLabs-Autorisierungen aus, selbst mit gültiger Sitzung und gültigem CSRF-Token.

Sitzung und CSRF verwenden ein signiertes Cookie mit HttpOnly, Secure und SameSite. Die
Limits für Ausstellungen und gleichzeitige Anrufe gelten pro Instanz der Funktion;
sie entsprechen weder einem globalen Kontingent noch einem Abrechnungslimit. Halte den
privaten Zugang geschützt und konfiguriere Nutzungslimits bei deinem Anbieter. Der Anruf des
Clients endet nach fünf Minuten oder nach 90 Sekunden Inaktivität.

Es gibt zwei optionale Benchmarks von je 120 Sekunden. Führe sie
getrennt aus, damit sich ihre Last nicht vermischt:

```sh
npm run benchmark
node scripts/benchmark-formations.mjs
```

Der erste behält das Kampf- und Wirtschaftsszenario mit 1.000 Bewohnern
pro Stadt bei; der zweite testet die drei Formationen bei aktiver Wirtschaft.
Die lokal erzeugten Berichte beschreiben das Szenario, die Messungen und ihre
Grenzen; private Ergebnisse sind nicht enthalten, und die Leistung auf einem
anderen Gerät wird nicht vorausgesetzt.

Die Browsertests erfordern, Playwright und seinen Browser separat zu
installieren; sie sind keine Abhängigkeit zum Spielen. Es gibt Python-Regressionstests für das
Test-Harness und einen Runner in `scripts/run-browser-acceptance.py`.

## Projektstatus

Dies ist ein Prototyp in Entwicklung. Die lokale Trennung während der Bewegung ist
näherungsweise und erlaubt Überlappungen; die visuelle Interpolation und
Verbesserungen des Verhaltens in dichten Situationen stehen noch aus. Die Leistung bei
großen Lasten hängt von Szenario und Hardware ab. Das vollständige Browser-Harness hat
Probleme beim Beenden von Chrome/Playwright gezeigt; eine Teilprüfung
entspricht keinem vollständigen E2E-Test.

Bewegung, Formationen und Sammeln sind eigene Implementierungen. Die
Referenzrecherche mit REA bleibt unvollständig: Sie hat die
exakten Navigations-, Formations- oder Sammelalgorithmen von Age of Empires nicht rekonstruiert.
Eine Gleichwertigkeit mit dessen Engine wird nicht behauptet.

Dieses Repository enthält eigenen Code und generierte Assets. Es enthält keine
rekonstruierte kommerzielle Engine, keine Dateien von Age of Empires, keine Kontodaten,
keinen privaten Entwicklungsverlauf und keine geteilten Schlüssel.

## Lizenzen und Beiträge

**Eigener Code und eigene Dokumentation: MIT. Enthaltene Grafiken: CC BY 4.0**, mit Namensnennung.
Software von Drittanbietern behält ihre Lizenzen. Siehe `LICENSE`,
`assets/LICENSE.md` und `THIRD_PARTY_NOTICES.md`.

Du darfst das Projekt unter Einhaltung dieser Lizenzen nutzen, verändern und weiterverbreiten.
Issues und Pull Requests sind willkommen. Füge bei Änderungen an der Engine einen
reproduzierbaren Test bei und stelle Teilmessungen nicht als vollständige Abnahme dar.
