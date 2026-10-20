# Third-party notices

## ElevenLabs browser SDK

`assets/vendor/elevenlabs-client.js` is the self-contained browser distribution
of `@elevenlabs/client` 1.27.0, with its source-map comment removed and an ESM
export appended. `elevenlabs-raw-audio-processor.js` is the corresponding worklet.
Copyright 2025 ElevenLabs; MIT license retained in
`assets/vendor/elevenlabs-client.LICENSE`. Package origins, source and vendored
digests are recorded in `elevenlabs-client.provenance.json`.

Upstream: https://github.com/elevenlabs/packages/tree/main/packages/client

The SDK uses LiveKit and ElevenLabs types as described in the upstream package.
LiveKit Client SDK is Apache-2.0; its license and upstream notice are retained
under `assets/vendor/livekit-client.LICENSE` and `livekit-client.NOTICE`.
Any notices embedded in the self-contained bundle remain intact.

## Generated artwork

Artwork provenance, attribution and the separate CC BY 4.0 license are described
in `assets/LICENSE.md`. Some unit sprites are rendered/edited derivatives of
Meshy-generated models; retain the Meshy attribution. No raw models or provider
credentials are included.

## Optional tools

Python, Vosk, FFmpeg, speech models, browsers and online voice services are not
distributed here. Install or configure those optional tools separately under
their own terms. They are not needed for ordinary mouse/keyboard gameplay.
