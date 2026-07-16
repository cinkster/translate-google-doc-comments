importScripts("background-lib.js");

(function initBackground(global) {
  "use strict";

  const api = global.browser && global.browser.runtime && global.browser.runtime.onMessage
    ? global.browser
    : global.chrome;
  const lib = global.DCTBackgroundLib;
  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const MAX_CACHE_ENTRIES = 300;

  function translationProvider(apiKey) {
    return apiKey ? "openai" : "on-device";
  }

  if (api.storage.local.setAccessLevel) {
    api.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
  }

  async function getStoredSettings() {
    const stored = await api.storage.local.get({
      ...lib.DEFAULT_SETTINGS,
      apiKey: "",
      translationCache: {}
    });
    return {
      ...lib.sanitizeSettings(stored),
      apiKey: typeof stored.apiKey === "string" ? stored.apiKey : "",
      translationCache: stored.translationCache && typeof stored.translationCache === "object"
        ? stored.translationCache
        : {}
    };
  }

  async function saveSettings(message) {
    const current = await getStoredSettings();
    const settings = lib.sanitizeSettings(message.settings || {});
    const next = { ...settings };

    if (typeof message.apiKey === "string" && message.apiKey.trim()) {
      next.apiKey = message.apiKey.trim();
    } else if (message.removeApiKey) {
      next.apiKey = "";
    } else {
      next.apiKey = current.apiKey;
    }

    await api.storage.local.set(next);
    return {
      ok: true,
      settings,
      hasApiKey: Boolean(next.apiKey),
      provider: translationProvider(next.apiKey)
    };
  }

  function validateTexts(input) {
    if (!Array.isArray(input) || input.length === 0 || input.length > 20) {
      throw new Error("A translation batch must contain between 1 and 20 comments.");
    }

    return input.map((item, index) => {
      const id = String(item && item.id || `comment-${index}`).slice(0, 100);
      const text = String(item && item.text || "").trim();
      if (!text || text.length > 12000) {
        throw new Error("Each comment must contain between 1 and 12,000 characters.");
      }
      return { id, text };
    });
  }

  function pruneCache(cache) {
    const now = Date.now();
    const entries = Object.entries(cache)
      .filter(([, value]) => value && now - value.createdAt < CACHE_TTL_MS)
      .sort((left, right) => right[1].createdAt - left[1].createdAt)
      .slice(0, MAX_CACHE_ENTRIES);
    return Object.fromEntries(entries);
  }

  async function callOpenAI(apiKey, requestBody) {
    let response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });
    } catch (_error) {
      const error = new Error("Could not reach OpenAI. Check your network connection.");
      error.code = "NETWORK_ERROR";
      throw error;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error && data.error.message || `OpenAI returned HTTP ${response.status}.`);
      error.code = response.status === 401 ? "INVALID_API_KEY" : "OPENAI_ERROR";
      throw error;
    }
    return data;
  }

  async function translateComments(message) {
    const settings = await getStoredSettings();
    if (!settings.autoTranslate && !message.force) {
      return { ok: true, translations: {}, skipped: true };
    }
    if (!settings.apiKey) {
      return {
        ok: false,
        error: { code: "MISSING_API_KEY", message: "Add an OpenAI API key in the extension settings." }
      };
    }

    const texts = validateTexts(message.texts);
    const cache = pruneCache(settings.translationCache);
    const translations = {};
    const uncached = [];

    for (const item of texts) {
      const key = lib.cacheKey(settings.model, settings.targetLanguage, item.text);
      const cached = cache[key];
      if (cached) {
        translations[item.id] = cached.translation;
      } else {
        uncached.push({ ...item, cacheKey: key });
      }
    }

    if (uncached.length > 0) {
      const response = await callOpenAI(
        settings.apiKey,
        lib.buildRequestBody(uncached, settings.targetLanguage, settings.model)
      );
      const fresh = lib.parseTranslations(response, uncached.map(({ id }) => id));
      const createdAt = Date.now();

      for (const item of uncached) {
        translations[item.id] = fresh[item.id];
        cache[item.cacheKey] = {
          translation: fresh[item.id],
          createdAt
        };
      }
      await api.storage.local.set({ translationCache: pruneCache(cache) });
    }

    return {
      ok: true,
      targetLanguage: settings.targetLanguage,
      translations
    };
  }

  async function handleMessage(message) {
    switch (message && message.type) {
      case "GET_SETTINGS": {
        const settings = await getStoredSettings();
        return {
          ok: true,
          settings: lib.sanitizeSettings(settings),
          hasApiKey: Boolean(settings.apiKey),
          provider: translationProvider(settings.apiKey)
        };
      }
      case "GET_PUBLIC_SETTINGS": {
        const settings = await getStoredSettings();
        return {
          ok: true,
          settings: lib.sanitizeSettings(settings),
          configured: Boolean(settings.apiKey),
          provider: translationProvider(settings.apiKey)
        };
      }
      case "SAVE_SETTINGS":
        return saveSettings(message);
      case "TRANSLATE_COMMENTS":
        return translateComments(message);
      default:
        return { ok: false, error: { code: "UNKNOWN_MESSAGE", message: "Unknown request." } };
    }
  }

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: {
          code: error.code || "EXTENSION_ERROR",
          message: error.message || "Translation failed."
        }
      }));
    return true;
  });
})(globalThis);
