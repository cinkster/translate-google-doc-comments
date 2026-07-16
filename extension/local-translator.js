(function initLocalTranslator(global) {
  "use strict";

  const TARGET_LANGUAGE_CODES = Object.freeze({
    "english": "en",
    "spanish": "es",
    "french": "fr",
    "german": "de",
    "italian": "it",
    "portuguese": "pt",
    "japanese": "ja",
    "korean": "ko",
    "simplified chinese": "zh",
    "traditional chinese": "zh-Hant",
    "dutch": "nl",
    "arabic": "ar"
  });

  const translatorPromises = new Map();
  const translationCache = new Map();
  let detectorPromise = null;

  function targetLanguageCode(language) {
    return TARGET_LANGUAGE_CODES[String(language || "").trim().toLocaleLowerCase()] || null;
  }

  function createError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function runtimeAvailable() {
    return Boolean(
      global.Translator &&
      typeof global.Translator.availability === "function" &&
      typeof global.Translator.create === "function"
    );
  }

  function detectorRuntimeAvailable() {
    return Boolean(
      global.LanguageDetector &&
      typeof global.LanguageDetector.availability === "function" &&
      typeof global.LanguageDetector.create === "function"
    );
  }

  function supports(targetLanguage) {
    return runtimeAvailable() && Boolean(targetLanguageCode(targetLanguage));
  }

  function combinedAvailability(states) {
    if (states.includes("unavailable")) {
      return "unavailable";
    }
    if (states.includes("downloading")) {
      return "downloading";
    }
    if (states.includes("downloadable")) {
      return "downloadable";
    }
    return "available";
  }

  async function getStatus(targetLanguage) {
    const targetCode = targetLanguageCode(targetLanguage);
    if (!targetCode) {
      return { available: false, reason: "unsupported-target", state: "unavailable" };
    }
    if (!runtimeAvailable()) {
      return { available: false, reason: "unavailable", state: "unavailable" };
    }

    const probeSource = targetCode === "en" ? "ja" : "en";
    try {
      const state = combinedAvailability([await global.Translator.availability({
        sourceLanguage: probeSource,
        targetLanguage: targetCode
      })]);
      return {
        available: state !== "unavailable",
        reason: state === "unavailable" ? "unavailable" : null,
        state
      };
    } catch (_error) {
      return { available: false, reason: "unavailable", state: "unavailable" };
    }
  }

  async function getDetector() {
    if (!detectorRuntimeAvailable()) {
      return null;
    }
    if (!detectorPromise) {
      detectorPromise = (async () => {
        const state = await global.LanguageDetector.availability();
        if (state === "unavailable") {
          return null;
        }
        return global.LanguageDetector.create();
      })().catch((error) => {
        detectorPromise = null;
        throw error;
      });
    }
    return detectorPromise;
  }

  function normalizedLanguageCode(code) {
    const value = String(code || "").toLocaleLowerCase();
    if (["zh", "zh-cn", "zh-hans"].includes(value)) {
      return "zh";
    }
    if (["zh-tw", "zh-hk", "zh-hant"].includes(value)) {
      return "zh-hant";
    }
    return value.split("-")[0];
  }

  function sameLanguage(sourceCode, targetCode) {
    return normalizedLanguageCode(sourceCode) === normalizedLanguageCode(targetCode);
  }

  function containsTranslatableText(text) {
    const withoutUrls = String(text || "").replace(/https?:\/\/\S+/gi, "");
    return /\p{L}/u.test(withoutUrls);
  }

  function languageFromScript(text) {
    if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) {
      return "ja";
    }
    if (/\p{Script=Hangul}/u.test(text)) {
      return "ko";
    }
    if (/\p{Script=Han}/u.test(text)) {
      return "zh";
    }
    if (/\p{Script=Arabic}/u.test(text)) {
      return "ar";
    }
    if (/\p{Script=Greek}/u.test(text)) {
      return "el";
    }
    if (/\p{Script=Thai}/u.test(text)) {
      return "th";
    }
    if (/\p{Script=Bengali}/u.test(text)) {
      return "bn";
    }
    if (/\p{Script=Tamil}/u.test(text)) {
      return "ta";
    }
    if (/\p{Script=Telugu}/u.test(text)) {
      return "te";
    }
    if (/\p{Script=Kannada}/u.test(text)) {
      return "kn";
    }
    return null;
  }

  async function detectLanguage(text) {
    const scriptedLanguage = languageFromScript(text);
    if (scriptedLanguage) {
      return scriptedLanguage;
    }

    const detector = await getDetector();
    if (!detector) {
      return null;
    }
    const results = await detector.detect(text);
    const detection = Array.isArray(results)
      ? results.find((item) => item && item.detectedLanguage)
      : null;
    return detection ? detection.detectedLanguage : null;
  }

  async function getTranslator(sourceLanguage, targetLanguage) {
    const key = `${sourceLanguage}\n${targetLanguage}`;
    if (!translatorPromises.has(key)) {
      const promise = (async () => {
        const state = await global.Translator.availability({
          sourceLanguage,
          targetLanguage
        });
        if (state === "unavailable") {
          throw createError(
            "ON_DEVICE_LANGUAGE_UNAVAILABLE",
            "Chrome does not support this language pair. Add an OpenAI API key."
          );
        }
        return global.Translator.create({ sourceLanguage, targetLanguage });
      })().catch((error) => {
        translatorPromises.delete(key);
        throw error;
      });
      translatorPromises.set(key, promise);
    }
    return translatorPromises.get(key);
  }

  async function translateText(text, targetCode) {
    if (!containsTranslatableText(text)) {
      return null;
    }

    const sourceCode = await detectLanguage(text);
    if (!sourceCode || sameLanguage(sourceCode, targetCode)) {
      return null;
    }

    const cacheKey = `${sourceCode}\n${targetCode}\n${text}`;
    if (translationCache.has(cacheKey)) {
      return translationCache.get(cacheKey);
    }

    const translator = await getTranslator(sourceCode, targetCode);
    const translated = String(await translator.translate(text)).trim() || null;
    translationCache.set(cacheKey, translated);
    return translated;
  }

  async function translateBatch(texts, targetLanguage) {
    const targetCode = targetLanguageCode(targetLanguage);
    if (!targetCode) {
      return {
        ok: false,
        error: {
          code: "ON_DEVICE_TARGET_UNAVAILABLE",
          message: `On-device translation does not support ${targetLanguage}. Add an OpenAI API key.`
        }
      };
    }
    if (!runtimeAvailable()) {
      return {
        ok: false,
        error: {
          code: "ON_DEVICE_UNAVAILABLE",
          message: "On-device translation is unavailable in this browser. Add an OpenAI API key."
        }
      };
    }

    try {
      const translations = {};
      for (const item of texts) {
        translations[item.id] = await translateText(item.text, targetCode);
      }
      return { ok: true, targetLanguage, translations };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error.code || "ON_DEVICE_TRANSLATION_ERROR",
          message: error.message || "On-device translation failed."
        }
      };
    }
  }

  global.DCTLocalTranslator = {
    TARGET_LANGUAGE_CODES,
    getStatus,
    languageFromScript,
    runtimeAvailable,
    supports,
    targetLanguageCode,
    translateBatch
  };
})(globalThis);
