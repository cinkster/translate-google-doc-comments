(function initContentScript(global) {
  "use strict";

  const api = global.browser && global.browser.runtime && global.browser.runtime.onMessage
    ? global.browser
    : global.chrome;
  const lib = global.DCTContentLib;
  const localTranslator = global.DCTLocalTranslator;
  const inFlight = new Set();
  const translatedBodies = new Map();
  let scanTimer = null;
  let publicSettings = null;

  function sendMessage(message) {
    return api.runtime.sendMessage(message);
  }

  function clearBodyStatus(body) {
    body.classList.remove("dct-translating", "dct-translation-error");
    body.removeAttribute("aria-busy");
    body.removeAttribute("aria-description");
    delete body.dataset.dctErrorHash;
    delete body.dataset.dctTranslationError;
  }

  function restoreTitle(body, state) {
    if (state.hadTitle) {
      body.setAttribute("title", state.originalTitle);
    } else {
      body.removeAttribute("title");
    }
  }

  function releaseTranslatedBody(body, restoreOriginal) {
    const state = translatedBodies.get(body);
    if (!state) {
      return;
    }

    translatedBodies.delete(body);
    body.classList.remove("dct-translated-source");
    delete body.dataset.dctSourceHash;
    restoreTitle(body, state);

    if (
      restoreOriginal &&
      body.isConnected &&
      lib.normalizeText(body.textContent) === lib.normalizeText(state.translation)
    ) {
      body.textContent = state.originalText;
    }
  }

  function restoreOriginalComments() {
    clearTimeout(scanTimer);
    for (const body of Array.from(translatedBodies.keys())) {
      releaseTranslatedBody(body, true);
    }
    for (const body of document.querySelectorAll("[data-dct-skipped-hash], [data-dct-error-hash]")) {
      delete body.dataset.dctSkippedHash;
      clearBodyStatus(body);
    }
    for (const body of document.querySelectorAll(".dct-translating")) {
      clearBodyStatus(body);
    }
    inFlight.clear();
  }

  function translatedBodyIsCurrent(body) {
    const state = translatedBodies.get(body);
    if (!state) {
      return false;
    }
    if (lib.normalizeText(body.textContent) === lib.normalizeText(state.translation)) {
      return true;
    }

    releaseTranslatedBody(body, false);
    return false;
  }

  function clearStaleStatus(body, hash) {
    if (body.dataset.dctSkippedHash && body.dataset.dctSkippedHash !== hash) {
      delete body.dataset.dctSkippedHash;
    }
    if (body.dataset.dctErrorHash && body.dataset.dctErrorHash !== hash) {
      clearBodyStatus(body);
    }
  }

  function markLoading(body) {
    clearBodyStatus(body);
    body.classList.add("dct-translating");
    body.setAttribute("aria-busy", "true");
  }

  function renderTranslation(body, hash, translation, originalText) {
    clearBodyStatus(body);
    if (!translation) {
      body.dataset.dctSkippedHash = hash;
      return;
    }

    delete body.dataset.dctSkippedHash;
    const originalTitle = body.getAttribute("title") || "";
    const hoverOriginal = originalText.length > 2000
      ? `${originalText.slice(0, 2000)}...`
      : originalText;
    const state = {
      originalText,
      translation,
      hadTitle: body.hasAttribute("title"),
      originalTitle
    };

    translatedBodies.set(body, state);
    body.classList.add("dct-translated-source");
    body.dataset.dctSourceHash = hash;
    body.setAttribute("title", `Original: ${hoverOriginal}`);
    body.textContent = translation;
  }

  function renderError(body, hash, message) {
    clearBodyStatus(body);
    body.classList.add("dct-translation-error");
    body.dataset.dctErrorHash = hash;
    body.dataset.dctTranslationError = message;
    body.setAttribute("aria-description", message);
  }

  async function loadSettings() {
    if (!publicSettings) {
      publicSettings = await sendMessage({ type: "GET_PUBLIC_SETTINGS" });
    }
    return publicSettings;
  }

  async function scan(options = {}) {
    const force = Boolean(options.force);
    const settingsResponse = await loadSettings().catch(() => null);
    if (!settingsResponse || !settingsResponse.ok) {
      return;
    }
    if (!settingsResponse.settings.autoTranslate && !force) {
      return;
    }

    const provider = settingsResponse.provider || (settingsResponse.configured ? "openai" : "on-device");
    for (const body of Array.from(translatedBodies.keys())) {
      if (!body.isConnected) {
        translatedBodies.delete(body);
      }
    }

    const targetLanguage = settingsResponse.settings.targetLanguage;
    if (provider === "on-device" && (!localTranslator || !localTranslator.supports(targetLanguage))) {
      return;
    }
    if (provider === "openai" && !settingsResponse.configured) {
      return;
    }

    const pending = [];
    let pendingCharacters = 0;
    for (const body of lib.findCommentBodies(document)) {
      if (translatedBodyIsCurrent(body)) {
        continue;
      }

      const text = lib.normalizeText(body.textContent);
      const hash = lib.fingerprint(`${targetLanguage}\n${text}`);
      clearStaleStatus(body, hash);
      if (
        inFlight.has(hash) ||
        body.dataset.dctSkippedHash === hash ||
        body.dataset.dctErrorHash === hash
      ) {
        continue;
      }
      if (pending.length > 0 && pendingCharacters + text.length > 24000) {
        break;
      }

      inFlight.add(hash);
      markLoading(body);
      pending.push({ id: hash, text, body, hash });
      pendingCharacters += text.length;
      if (pending.length === 20) {
        break;
      }
    }

    if (pending.length === 0) {
      return;
    }

    const requestTexts = pending.map(({ id, text }) => ({ id, text }));
    const response = provider === "on-device"
      ? await localTranslator.translateBatch(requestTexts, targetLanguage)
      : await sendMessage({
        type: "TRANSLATE_COMMENTS",
        force,
        texts: requestTexts
      }).catch(() => ({
        ok: false,
        error: { code: "EXTENSION_ERROR", message: "Translation failed." }
      }));

    for (const item of pending) {
      inFlight.delete(item.hash);
    }

    if (!response.ok) {
      if (response.error && response.error.code === "MISSING_API_KEY") {
        for (const item of pending) {
          clearBodyStatus(item.body);
        }
        return;
      }
      const message = response.error && response.error.message || "Translation failed.";
      for (const item of pending) {
        renderError(item.body, item.hash, message);
      }
      return;
    }

    for (const item of pending) {
      const translation = response.translations[item.id];
      renderTranslation(
        item.body,
        item.hash,
        lib.normalizeText(translation) === item.text ? null : translation,
        item.text
      );
    }

    scheduleScan();
  }

  function scheduleScan(options = {}) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scan(options), 450);
  }

  function mutationsNeedScan(mutations) {
    return mutations.some((mutation) => {
      if (mutation.type === "characterData") {
        return true;
      }
      if (
        mutation.type === "childList" &&
        mutation.target &&
        mutation.target.nodeType === Node.ELEMENT_NODE &&
        (mutation.target.matches(lib.PRIMARY_BODY_SELECTOR) || mutation.target.closest(lib.PRIMARY_BODY_SELECTOR))
      ) {
        return true;
      }
      return [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])]
        .some((node) => node.nodeType === Node.ELEMENT_NODE);
    });
  }

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "TRANSLATE_NOW") {
      publicSettings = null;
      restoreOriginalComments();
      scan({ force: true }).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message && message.type === "SETTINGS_UPDATED") {
      publicSettings = null;
      restoreOriginalComments();
      scheduleScan();
      sendResponse({ ok: true });
    }
    return false;
  });

  const observer = new MutationObserver((mutations) => {
    if (mutationsNeedScan(mutations)) {
      scheduleScan();
    }
  });

  observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  scheduleScan();
})(globalThis);
