# Docs Comment Translator

A Manifest V3 browser extension that translates Google Docs comments and Google Meet in-call messages in place. Hover over a translation to read the original. Meet translations appear only in your own chat panel.

## Features

- Replaces each translatable comment and reply in place, frames the translated text, and keeps the original available on hover.
- Defaults to English and supports common languages plus a custom target.
- Uses Chrome's on-device Translator API when no OpenAI key is saved.
- Automatically detects new Docs comments and replies, and new messages in the open Meet chat panel.
- Batches visible comments and caches translations locally for 30 days.
- Keeps the OpenAI API key in the extension background worker when making requests.
- Uses `gpt-5.6-luna` by default, with Terra and Sol available in settings.

## Download

For Meet support, load the `extension` folder from this checkout. The published 0.3.0 preview supports Google Docs.

- [Download the Chrome extension](https://github.com/cinkster/translate-google-doc-comments/releases/download/v0.3.0/docs-comment-translator-chrome-0.3.0.zip)
- [Download the full test kit](https://github.com/cinkster/translate-google-doc-comments/releases/download/v0.3.0/docs-comment-translator-test-kit-0.3.0.zip)
- [Download SHA-256 checksums](https://github.com/cinkster/translate-google-doc-comments/releases/download/v0.3.0/SHA256SUMS.txt)

See [all GitHub releases](https://github.com/cinkster/translate-google-doc-comments/releases), browse the [version tags](https://github.com/cinkster/translate-google-doc-comments/tags), or read [DISTRIBUTION.md](DISTRIBUTION.md) for the complete installation and testing guide.

## Chrome

1. Download and extract the Chrome extension ZIP above. If you cloned the repository instead, use the `extension` directory.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.
5. Open a Google Docs document or the **In-call messages** panel in a Google Meet call, then choose the extension toolbar icon.
6. Save an OpenAI API key for OpenAI translation, or leave it empty to use Chrome's on-device translation on supported desktop versions.

## Safari

Safari Web Extensions require the full Xcode app for conversion and signing. Once Xcode is installed and selected:

```bash
./scripts/package-safari.sh
```

Open the generated project in `Safari/Docs Comment Translator/Docs Comment Translator.xcodeproj`, select the macOS app target, and run it. Then enable **Docs Comment Translator** in Safari Settings > Extensions and allow access to the sites where you want translation (`docs.google.com` or `meet.google.com`).

The current machine has the Command Line Tools but not full Xcode, so the Safari host project cannot be generated until Xcode is available.

## Privacy

When an OpenAI key is saved, the extension sends Docs comment text or posted Meet chat text to OpenAI when translation is enabled or manually requested. The API key and translation cache are stored in the browser's local extension storage, and API requests set `store: false`. Without a key, supported Chrome versions translate on-device. Safari and browsers without the built-in Translator API still require OpenAI. For a distributed multi-user release, replace the bring-your-own-key flow with a small authenticated backend so API credentials are never shipped to or stored by end-user browsers.

## Local Google Docs replica

Open `tests/fixture.html` directly in Safari or Chrome. It recreates the authenticated test document layout and runs the production content scripts against a local translation mock.

The replica exposes two DevTools helpers for live-DOM testing:

```js
DCTReplica.addReply();
DCTReplica.editFirstTranslatedComment();
```

## Test

Tests require Node.js and the Playwright package. Browser integration tests use Google Chrome when it is installed:

```bash
npm install --no-save playwright
npm test
```
