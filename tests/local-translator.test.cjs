const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../extension/local-translator.js"), "utf8");

function loadLocalTranslator(runtime = {}) {
  const context = { globalThis: { ...runtime } };
  vm.runInNewContext(source, context);
  return context.globalThis.DCTLocalTranslator;
}

test("maps configured languages to Chrome translation codes", () => {
  const lib = loadLocalTranslator();
  assert.equal(lib.targetLanguageCode("English"), "en");
  assert.equal(lib.targetLanguageCode("Traditional Chinese"), "zh-Hant");
  assert.equal(lib.targetLanguageCode("  Japanese  "), "ja");
  assert.equal(lib.targetLanguageCode("Klingon"), null);
});

test("translates locally while skipping target-language and URL-only comments", async () => {
  const createdPairs = [];
  const lib = loadLocalTranslator({
    LanguageDetector: class FakeLanguageDetector {
      static async availability() {
        return "available";
      }

      static async create() {
        return {
          async detect(text) {
            return [{
              detectedLanguage: /^[\x00-\x7F\s]+$/.test(text) ? "en" : "ja",
              confidence: 1
            }];
          }
        };
      }
    },
    Translator: class FakeTranslator {
      static async availability() {
        return "available";
      }

      static async create(options) {
        createdPairs.push(options);
        return {
          async translate(text) {
            return `Translated: ${text}`;
          }
        };
      }
    }
  });

  const response = await lib.translateBatch([
    { id: "ja", text: "こんにちは" },
    { id: "en", text: "Already English" },
    { id: "url", text: "https://example.com/path" }
  ], "English");

  assert.equal(response.ok, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(response.translations)),
    { ja: "Translated: こんにちは", en: null, url: null }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(createdPairs)),
    [{ sourceLanguage: "ja", targetLanguage: "en" }]
  );
});

test("reports when on-device translation is unavailable", async () => {
  const lib = loadLocalTranslator();
  assert.deepEqual(
    JSON.parse(JSON.stringify(await lib.getStatus("English"))),
    { available: false, reason: "unavailable", state: "unavailable" }
  );
  const response = await lib.translateBatch([{ id: "a", text: "Bonjour" }], "English");
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "ON_DEVICE_UNAVAILABLE");
});

test("translates Japanese when Chrome's language detector is unavailable", async () => {
  const lib = loadLocalTranslator({
    Translator: class FakeTranslator {
      static async availability() {
        return "available";
      }

      static async create() {
        return {
          async translate() {
            return "Hello";
          }
        };
      }
    }
  });

  const status = await lib.getStatus("English");
  assert.equal(status.available, true);
  const response = await lib.translateBatch([
    { id: "ja", text: "こんにちは" },
    { id: "latin", text: "Already English" }
  ], "English");
  assert.deepEqual(
    JSON.parse(JSON.stringify(response.translations)),
    { ja: "Hello", latin: null }
  );
});
