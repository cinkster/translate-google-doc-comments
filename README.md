# Docs Comment Translator

A Manifest V3 browser extension that translates Google Docs comments in place. It uses one shared extension codebase for Chrome and Safari and calls the OpenAI Responses API from the extension background worker.

## Features

- Replaces each translatable comment and reply in place, frames the translated text, and keeps the original available on hover.
- Defaults to English and supports common languages plus a custom target.
- Uses Chrome's on-device Translator API when no OpenAI key is saved.
- Automatically detects new comments and replies rendered by Google Docs.
- Batches visible comments and caches translations locally for 30 days.
- Keeps the OpenAI API key out of the Google Docs page context.
- Uses `gpt-5.6-luna` by default, with Terra and Sol available in settings.

## Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the `extension` directory.
4. Open a Google Docs document and choose the extension toolbar icon.
5. Save an OpenAI API key for OpenAI translation, or leave it empty to use Chrome's on-device translation on supported desktop versions.

## Safari

Safari Web Extensions require the full Xcode app for conversion and signing. Once Xcode is installed and selected:

```bash
./scripts/package-safari.sh
```

Open the generated project in `Safari/Docs Comment Translator/Docs Comment Translator.xcodeproj`, select the macOS app target, and run it. Then enable **Docs Comment Translator** in Safari Settings > Extensions and allow access to `docs.google.com`.

The current machine has the Command Line Tools but not full Xcode, so the Safari host project cannot be generated until Xcode is available.

## Privacy

When an OpenAI key is saved, the extension sends comment text to OpenAI only when translation is enabled or manually requested. The API key and translation cache are stored in the browser's local extension storage, and API requests set `store: false`. Without a key, supported Chrome versions translate on-device and do not send comment text to the background translation request. Safari and browsers without the built-in Translator API still require OpenAI. For a distributed multi-user release, replace the bring-your-own-key flow with a small authenticated backend so API credentials are never shipped to or stored by end-user browsers.

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
