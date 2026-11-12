# Credits

Learn with Kiko was created by **Lathan**.

## Fonts (SIL Open Font License 1.1)
- **Andika** by SIL International: a typeface designed for beginning readers (single-storey a and g, clear letter shapes). Used for all reading text.
- **Grandstander** by Tyler Finck: headings.
- **Playwrite US Trad** by TypeTogether: joined-up (cursive) writing models.

All fonts are bundled from the @fontsource packages.

## Kiko's voice
Every fixed line, word, letter name and letter sound was recorded ahead of time with **Kokoro-82M** (hexgrad, Apache-2.0), voice `af_heart`, run locally with [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) (MIT). Pronunciation comes from espeak-ng (GPL-3.0, used as a separate tool at build time only), converted to Kokoro's phoneme style; letter sounds are given as exact phonemes. See `tools/voice/make_voice.py`. Lines not yet recorded fall back to the best voice on the device. Grown-ups can replace any letter sound with their own recording in the app.

## Pictures
- **Microsoft Fluent Emoji (3D)**, MIT License, Copyright (c) Microsoft Corporation, via the `@lobehub/fluent-emoji-3d` package. Used for every emoji picture in the app (`assets/fx/`).
- Kiko the parrot, the island scenes, the icons, shoelace and money pictures are original drawings made for this app.
