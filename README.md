# Docs Comment Translator

A Manifest V3 browser extension that translates Google Docs comments and Google Meet in-call messages in place. Hover over a translation to read the original. Meet translations appear only in your own chat panel.

## Features

- Shows translations in place with the original text available on hover. Messages with links keep the original above the translation so the links stay clickable.
- Defaults to English and supports common languages plus a custom target.
- Uses Chrome's on-device Translator API when no OpenAI key is saved.
- Automatically detects new Docs comments and replies, and new messages in the open Meet chat panel.
- Batches visible comments and caches translations locally for 30 days.
- Keeps the OpenAI API key in the extension background worker when making requests.
- Uses `gpt-5.6-luna` by default, with Terra and Sol available in settings.

## Download

For Google Docs and Meet support in Chrome, follow the [Chrome installation steps](#chrome). The downloads listed here are for the Google Docs 0.3.0 preview.

- [Download the Chrome extension](https://github.com/cinkster/translate-google-doc-comments/releases/download/v0.3.0/docs-comment-translator-chrome-0.3.0.zip)
- [Download the full test kit](https://github.com/cinkster/translate-google-doc-comments/releases/download/v0.3.0/docs-comment-translator-test-kit-0.3.0.zip)
- [Download SHA-256 checksums](https://github.com/cinkster/translate-google-doc-comments/releases/download/v0.3.0/SHA256SUMS.txt)

See [all GitHub releases](https://github.com/cinkster/translate-google-doc-comments/releases), browse the [version tags](https://github.com/cinkster/translate-google-doc-comments/tags), or read [DISTRIBUTION.md](DISTRIBUTION.md) for the complete installation and testing guide.

## Chrome

1. Use your checkout of this branch, or choose **Code** → **Download ZIP** on the branch's GitHub page and extract the source.
2. Open `chrome://extensions` and enable **Developer mode**. Choose **Load unpacked** and select the [extension folder](extension/) that contains `manifest.json`.
3. Open the extension popup. Choose a language under **Translate to**, then choose **Save**. To use OpenAI, enter an API key before saving. When no API key is saved, supported desktop versions of Chrome can translate on-device.

If Chrome already loads the extension from your checkout, update the checkout and choose **Reload** on the extension card. Open a fresh Docs or Meet tab to use the updated version.

## Use Google Meet chat

In a Meet call, choose **Chat with everyone** to open **In-call messages**. With **Translate automatically** enabled, the extension translates messages already in the panel and new messages as they arrive. For example, with English selected, `図書館は午後3時に開きます。` appears as “The library opens at 3 p.m.”

This also works when the host enables continuous meeting chat. Allow access to `chat.google.com` if your browser asks. The extension reads posted messages from the Google Chat conversation embedded in Meet. Other participants still see the original messages.

For manual translation, turn off **Translate automatically** in the popup and choose **Save**. Choose **Translate now** to translate the messages currently in the panel. Choose it again to include later messages.

## Safari

Safari Web Extensions require the full Xcode app for conversion and signing. Once Xcode is installed and selected:

```bash
./scripts/package-safari.sh
```

Open the generated project in `Safari/Docs Comment Translator/Docs Comment Translator.xcodeproj`, select the macOS app target, and run it. Then enable **Docs Comment Translator** in Safari Settings > Extensions and allow access to the sites where you want translation (`docs.google.com` or `meet.google.com`, plus `chat.google.com` for continuous meeting chat).

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
