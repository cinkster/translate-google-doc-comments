(function initContentScript(global) {
  "use strict";

  const api = global.browser && global.browser.runtime && global.browser.runtime.onMessage
    ? global.browser
    : global.chrome;
  const lib = global.DCTContentLib;
  const isMeet = global.location.hostname === "meet.google.com";
  const findBodies = isMeet ? lib.findMeetMessageBodies : lib.findCommentBodies;
  const localTranslator = global.DCTLocalTranslator;
  const inFlight = new Set();
  const translatedBodies = new Map();
  let scanTimer = null;
  let publicSettingsRequest = null;

  async function sendMessage(message) {
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

  function releaseTranslatedBody(body) {
    const state = translatedBodies.get(body);
    if (!state) {
      return;
    }

    translatedBodies.delete(body);
    if (state.output !== body) {
      state.output.remove();
      return;
    }
    body.classList.remove("dct-translated-source");
    delete body.dataset.dctSourceHash;
    restoreTitle(body, state);

    if (lib.normalizeText(body.textContent) === lib.normalizeText(state.translation)) {
      body.textContent = state.originalText;
    }
  }

  function restoreOriginalComments() {
    publicSettingsRequest = null;
    clearTimeout(scanTimer);
    scanTimer = null;
    for (const body of Array.from(translatedBodies.keys())) {
      releaseTranslatedBody(body);
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

  function releaseStaleTranslations() {
    for (const [body, state] of translatedBodies) {
      const inline = state.output === body;
      const expected = inline ? state.translation : state.originalText;
      if (!body.isConnected || (!inline && state.output.previousElementSibling !== body) ||
          lib.normalizeText(body.textContent) !== lib.normalizeText(expected)) {
        releaseTranslatedBody(body);
      }
    }
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
    // Keep the page's original links and event handlers in place.
    const output = body.querySelector("a[href]") ? document.createElement("span") : body;
    if (output !== body) {
      output.classList.add("dct-translation");
      body.after(output);
    }
    const originalTitle = body.getAttribute("title") || "";
    const hoverOriginal = originalText.length > 2000
      ? `${originalText.slice(0, 2000)}...`
      : originalText;
    const state = {
      output,
      originalText,
      translation,
      hadTitle: body.hasAttribute("title"),
      originalTitle
    };

    translatedBodies.set(body, state);
    output.classList.add("dct-translated-source");
    output.dataset.dctSourceHash = hash;
    output.setAttribute("title", `Original: ${hoverOriginal}`);
    output.textContent = translation;
  }

  function renderError(body, hash, message) {
    clearBodyStatus(body);
    body.classList.add("dct-translation-error");
    body.dataset.dctErrorHash = hash;
    body.dataset.dctTranslationError = message;
    body.setAttribute("aria-description", message);
  }

  function loadSettings() {
    if (!publicSettingsRequest) {
      publicSettingsRequest = sendMessage({ type: "GET_PUBLIC_SETTINGS" });
    }
    return publicSettingsRequest;
  }

  async function scan(manualBodies) {
    releaseStaleTranslations();
    const force = Boolean(manualBodies);
    const settingsRequest = loadSettings();
    const settingsResponse = await settingsRequest.catch(() => null);
    if (settingsRequest !== publicSettingsRequest) {
      return;
    }
    if (!settingsResponse || !settingsResponse.ok) {
      publicSettingsRequest = null;
      return;
    }
    if (!settingsResponse.settings.autoTranslate && !force) {
      return;
    }

    const provider = settingsResponse.provider || (settingsResponse.configured ? "openai" : "on-device");
    const targetLanguage = settingsResponse.settings.targetLanguage;
    if (provider === "on-device" && (!localTranslator || !localTranslator.supports(targetLanguage))) {
      return;
    }
    if (provider === "openai" && !settingsResponse.configured) {
      return;
    }

    const bodies = manualBodies || findBodies(document);
    while (await translateNextBatch(bodies, provider, targetLanguage, force)) {
      if (!force) {
        scheduleScan();
        return;
      }
      if (publicSettingsRequest !== settingsRequest) {
        return;
      }
    }
  }

  async function translateNextBatch(bodies, provider, targetLanguage, force) {
    const pending = [];
    let pendingCharacters = 0;
    for (const body of bodies) {
      if (!body.isConnected || translatedBodies.has(body)) {
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
    const settingsRequest = publicSettingsRequest;
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

    // A settings change or another manual run has already reset these bodies.
    if (settingsRequest !== publicSettingsRequest) {
      return;
    }
    for (const item of pending) {
      inFlight.delete(item.hash);
    }
    const current = pending.filter(({ body, text }) =>
      body.isConnected && !translatedBodies.has(body) && lib.normalizeText(body.textContent) === text);

    if (!response.ok) {
      if (response.error && response.error.code === "MISSING_API_KEY") {
        for (const item of current) {
          clearBodyStatus(item.body);
        }
        return;
      }
      const message = response.error && response.error.message || "Translation failed.";
      for (const item of current) {
        renderError(item.body, item.hash, message);
      }
      return;
    }

    for (const item of current) {
      const translation = response.translations[item.id];
      renderTranslation(
        item.body,
        item.hash,
        lib.normalizeText(translation) === item.text ? null : translation,
        item.text
      );
    }

    return true;
  }

  function scheduleScan() {
    if (scanTimer !== null) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      void scan();
    }, 450);
  }

  function mutationsNeedScan(mutations) {
    return mutations.some((mutation) => {
      if (isMeet) {
        if (Array.from(mutation.removedNodes).some((node) => translatedBodies.has(node))) {
          return true;
        }
        const target = mutation.target.nodeType === Node.TEXT_NODE
          ? mutation.target.parentElement
          : mutation.target;
        return target?.closest(lib.MEET_BODY_SELECTOR) || Array.from(mutation.addedNodes).some(
          (node) => node.nodeType === Node.ELEMENT_NODE &&
            (node.matches(lib.MEET_BODY_SELECTOR) || node.querySelector(lib.MEET_BODY_SELECTOR))
        );
      }
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
      restoreOriginalComments();
      scan(findBodies(document)).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message && message.type === "SETTINGS_UPDATED") {
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
