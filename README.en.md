# Guilds of the Dawn

[Español](README.md) · [English](README.en.md) · [Português](README.pt.md) · [日本語](README.ja.md) · [العربية](README.ar.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

An **open source** fantasy RTS, playable in the browser, with named villagers,
guilds, construction, resources, walls, combat and orders in Spanish.

The current scope is battles and skirmishes against the AI, with economy,
construction and combat on revealed maps. It does not include campaigns.

![Gremios del Alba](assets/hero.png)

## Play locally

Requirements: **Node.js 24 or later** and a modern browser. There are no npm
dependencies to install.

```sh
git clone https://github.com/Oruga420/gremios-del-alba.git
cd gremios-del-alba
npm start
```

Open **http://127.0.0.1:4173**. On Windows you can also use `PLAY.cmd`.
The server is designed for local use and listens on loopback.

## What's included

- Ten fully revealed maps and four original guilds.
- Gathering, carrying and dropping off; villagers look for reachable resources
  when one runs out and keep their load if no storehouse is available.
- Construction, repair, walls and gates.
- Line, box and staggered formations, with individual destinations and shared
  routes. The choice is kept when the group moves.
- Rally points on resources and farms: new workers start gathering as soon as
  they leave the building.
- Recruitment, technologies, ages, trade and a limit of 1,000 residents per city.
- Knights, archers, assassins, mages, healers and other roles; combat
  animations, blood and bodies.
- JSON save/load, drag selection, control groups and a minimap.
- A Spanish command parser and WebMCP page tools.
- An optional voice agent using the player's own account and credentials.

Select units by dragging; right-click to give an order. Use the cards at the
bottom to build or train, and the space bar to pause. The in-game help lists
more controls. With several units selected, use the **Line**, **Box** and
**Staggered** buttons to regroup them. Select a producer and right-click a
resource to send its new workers there. The selection panel shows their load
and whether they are gathering, dropping off or waiting for a reachable
resource or storehouse.

Repeating a gather order on the same resource keeps the task, the route and the
load. During an attack-move, units resume their destination if they cannot
reach an automatically detected enemy. An explicit attack keeps the target you
chose.

## Voice and WebMCP

Typed orders and the game itself work without API keys. The browser's speech
recognition depends on its support and permissions. Example orders:
**“build a house”**, **“villagers, gather wood”**, **“form a line”**,
**“staggered formation”**, **“move the archers in a box to my base”** and
**“rally point from the Guildhall to the forest”**. Destinations are resolved
against the current world. Orders run instantly, with no confirmation and no
need for coordinates; **“Stop”** halts the units.

For the conversational agent, create your own private Agent on ElevenLabs and
copy `.env.example` to `.env`. Set `ELEVENLABS_API_KEY` and
`ELEVENLABS_AGENT_ID`; then restart the server. The key stays on the server.
Using the provider is optional and may incur costs on your account.
`npm run voice:definition` exports a definition with the game's tools locally;
choose your voice and model at the provider or through the example's options.
Installing the game does not create agents or make any calls.

Offline recognition is optional and requires Python, Vosk, FFmpeg and a
Spanish model. Set `GUILD_PYTHON_PATH`, `GUILD_FFMPEG_PATH` and
`GUILD_VOSK_MODEL_PATH`. No models or recordings are included.

`PLAY-WEBMCP.cmd` launches a compatible Chrome with the WebMCP flag and a
dedicated local profile. The game reports the capability actually available.
That profile has its own saves: use JSON export/import to move a match over.

## Development and testing

```sh
npm test
npm run check
npm run build
```

`dist/` contains the generated static client. The local server includes the
voice and offline recognition routes; on Vercel, `api/guild.mjs` serves Sota's
routes without depending on a computer being switched on. The tool inventory
is in `docs/voice/clickables.json`; the engine contract is in
`docs/engine-interface.md`.

### Deploying on Vercel

Import this repository with Node 24 and keep `vercel.json`. The client is
built into `dist/`; the `/api/*` routes run as a Node function with no
additional dependencies. Matches are saved in your browser or exported to
JSON. Vosk offline recognition remains available in the local version; on the
public Vercel link, use Browser voice or type orders.

Enable **Vercel Authentication → Standard Protection** on the project. The
production domain lets people play without signing in. Unique deployment
URLs stay private: personal Sota only issues authorizations from the protected
host that Vercel provides in `VERCEL_URL`. Browser voice and typed orders are
available in the public game. Set these as encrypted production variables:
`ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`,
`GUILD_PUBLIC_ORIGIN` (the exact HTTPS origin), `GUILD_SESSION_SECRET` (random,
at least 32 characters) and `GUILD_DEPLOYMENT_PROTECTION=vercel-auth`.
Never commit their values to GitHub. The flag declares the configured
protection; it does not replace Vercel's access control. Do not disable
protection on unique URLs if you enable the paid agent. The public domain never
issues ElevenLabs authorizations, even with a valid session and CSRF token.

The session and CSRF use a signed, HttpOnly, Secure and SameSite cookie. The
issuance and concurrent-call limits are per function instance; they are not
equivalent to a global quota or a billing limit. Keep private access protected
and configure usage limits at your provider. The client's call ends after five
minutes or after 90 seconds of inactivity.

There are two optional benchmarks of 120 seconds each. Run them separately so
their loads don't mix:

```sh
npm run benchmark
node scripts/benchmark-formations.mjs
```

The first keeps the combat and economy scenario with 1,000 residents per city;
the second exercises the three formations with an active economy. The
generated local reports describe the scenario, the measurements and their
limits; no private results are included, and performance on other machines is
not assumed.

Browser tests require installing Playwright and its browser separately; they
are not a dependency for playing. There are Python regression tests for the
harness and a runner in `scripts/run-browser-acceptance.py`.

## Project status

This is a prototype in development. Local separation during movement is
approximate and allows overlaps; visual interpolation and better behavior in
dense situations are still pending. Performance under heavy loads depends on
the scenario and hardware. The full browser harness has shown Chrome/Playwright
shutdown problems; a partial check is not equivalent to full E2E.

Movement, formations and gathering are original implementations. The reference
research with REA remains partial: it did not recover the exact navigation,
formation or gathering algorithms of Age of Empires. No equivalence with its
engine is claimed.

This repository contains original code and generated assets. It does not
contain a recovered commercial engine, Age of Empires files, account data,
private development history or shared keys.

## Licenses and contributions

**Original code and documentation: MIT. Included art: CC BY 4.0**, with attribution.
Third-party software keeps its own licenses. See `LICENSE`,
`assets/LICENSE.md` and `THIRD_PARTY_NOTICES.md`.

You may use, modify and redistribute the project in accordance with those
licenses. Issues and pull requests are welcome. For engine changes, include a
reproducible test and avoid presenting partial measurements as full acceptance.
