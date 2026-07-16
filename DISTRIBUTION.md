# Try Docs Comment Translator

Version 0.3.0 is a developer build for local testing. It is not signed or published in a browser store.

## Chrome

1. Extract `docs-comment-translator-chrome-0.3.0.zip` into a permanent folder.
2. Open `chrome://extensions` in Google Chrome.
3. Turn on **Developer mode** in the upper-right corner.
4. Choose **Load unpacked**.
5. Select the extracted folder containing `manifest.json`.
6. Open a Google Docs document that has comments and allow the extension access to `docs.google.com` if Chrome asks.
7. Choose the **Docs Comment Translator** toolbar icon.
8. Select a target language and choose **Save**. Add an OpenAI API key to use OpenAI, or leave it empty to use Chrome's on-device translation on supported desktop versions.
9. Reload the Google Docs tab. The first on-device translation may download a language model. Translatable comment text should then be replaced and framed in place; hover over it to see the original.

Create and manage API keys at <https://platform.openai.com/api-keys>. OpenAI API usage is billed separately from a ChatGPT subscription.

The API key is stored in that browser profile's local extension storage. Comment text is sent to the OpenAI Responses API when translation runs. Requests use `store: false`.

## Local demo without an API key

The full test-kit archive includes a local replica of the Google Docs test page:

1. Extract `docs-comment-translator-test-kit-0.3.0.zip`.
2. Open `tests/fixture.html` in Chrome or Safari.
3. The production content scripts run against a local translation mock, so no API key or network request is required.

The replica also exposes these helpers in DevTools:

```js
DCTReplica.addReply();
DCTReplica.editFirstTranslatedComment();
```

## Safari

Safari requires a macOS host app generated and signed on the Mac where you build it. The test kit contains the shared WebExtension source and converter script, but not a pre-signed `.app`.

1. Install the full Xcode app from the Mac App Store.
2. Extract `docs-comment-translator-test-kit-0.3.0.zip`.
3. Open Terminal in the extracted folder.
4. Select Xcode if necessary:

   ```bash
   sudo xcode-select -s /Applications/Xcode.app
   ```

5. Generate the Safari host project:

   ```bash
   ./scripts/package-safari.sh
   ```

6. Open the generated `.xcodeproj` under `Safari/Docs Comment Translator/`.
7. Select the macOS app scheme and run it from Xcode.
8. Open Safari Settings > Extensions and enable **Docs Comment Translator**.
9. Grant access to `docs.google.com`, open a commented document, then enter the OpenAI API key from the extension toolbar popup. Safari does not currently provide Chrome's on-device Translator API.

For local testing, follow any signing prompts Xcode presents for your Mac. Distribution to other Safari users as an installable app requires Apple signing and notarization.

## Updating the developer build

Chrome does not update an unpacked extension automatically. Replace the extracted files with the new version, then choose **Reload** on its card at `chrome://extensions`.
