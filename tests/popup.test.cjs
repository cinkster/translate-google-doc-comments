const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const extensionRoot = path.join(__dirname, "../extension");
const chromeExecutable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("popup enables on-device translation when no OpenAI key is saved", {
  skip: !fs.existsSync(chromeExecutable) && "Google Chrome is not installed"
}, async () => {
  const browser = await chromium.launch({
    executablePath: chromeExecutable,
    headless: true
  });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.Translator = class FakeTranslator {
        static async availability() {
          return "downloadable";
        }

        static async create() {
          throw new Error("The popup must not download the model.");
        }
      };
      window.chrome = {
        runtime: {
          async sendMessage(message) {
            if (message.type === "GET_SETTINGS") {
              return {
                ok: true,
                hasApiKey: false,
                provider: "on-device",
                settings: {
                  targetLanguage: "English",
                  model: "gpt-5.6-luna",
                  autoTranslate: true
                }
              };
            }
            return { ok: false };
          }
        },
        tabs: {
          async query() {
            return [];
          }
        }
      };
    });

    await page.goto(pathToFileURL(path.join(extensionRoot, "popup.html")).href);
    await page.waitForFunction(() => (
      document.getElementById("connectionText").textContent === "On-device model available"
    ));

    assert.equal(await page.locator("#translateNow").isEnabled(), true);
    assert.equal(await page.locator("#removeKey").isDisabled(), true);
    assert.equal(await page.locator("#connectionStatus").evaluate((node) => node.classList.contains("connected")), true);
    const apiKeyField = page.locator("label.field", { has: page.locator("#apiKey") });
    assert.match(await apiKeyField.textContent(), /OpenAI API key \(optional\)/);
  } finally {
    await browser.close();
  }
});
