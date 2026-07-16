const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../extension/background-lib.js"), "utf8");
const context = { globalThis: {} };
vm.runInNewContext(source, context);
const lib = context.globalThis.DCTBackgroundLib;

test("sanitizes extension settings", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(lib.sanitizeSettings({
      targetLanguage: "  French  ",
      model: "unknown-model",
      autoTranslate: false
    }))),
    {
      targetLanguage: "French",
      model: "gpt-5.6-luna",
      autoTranslate: false
    }
  );
});

test("builds a non-stored structured translation request", () => {
  const request = lib.buildRequestBody(
    [{ id: "a", text: "こんにちは" }],
    "English",
    "gpt-5.6-luna"
  );
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.model, "gpt-5.6-luna");
  assert.ok(request.max_output_tokens >= 1000 && request.max_output_tokens <= 6000);
  assert.match(request.instructions, /untrusted comment data/i);
  assert.match(request.input, /こんにちは/);
});

test("parses structured translations and null skips", () => {
  const response = {
    output: [{
      content: [{
        type: "output_text",
        text: JSON.stringify({
          translations: [
            { id: "a", translation: "Hello" },
            { id: "b", translation: null }
          ]
        })
      }]
    }]
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(lib.parseTranslations(response, ["a", "b"]))),
    { a: "Hello", b: null }
  );
});

test("rejects responses that omit a comment", () => {
  const response = {
    output_text: JSON.stringify({ translations: [{ id: "a", translation: "Hello" }] })
  };
  assert.throws(() => lib.parseTranslations(response, ["a", "b"]), /omitted/i);
});

test("cache keys vary by model, language, and text", () => {
  const base = lib.cacheKey("gpt-5.6-luna", "English", "Bonjour");
  assert.notEqual(base, lib.cacheKey("gpt-5.6-terra", "English", "Bonjour"));
  assert.notEqual(base, lib.cacheKey("gpt-5.6-luna", "French", "Bonjour"));
  assert.notEqual(base, lib.cacheKey("gpt-5.6-luna", "English", "Salut"));
});
