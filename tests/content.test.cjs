const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");

const extensionRoot = path.join(__dirname, "../extension");
const chromeExecutable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function loadContentScript(page) {
  await page.addStyleTag({ path: path.join(extensionRoot, "content.css") });
  await page.addScriptTag({ path: path.join(extensionRoot, "local-translator.js") });
  await page.addScriptTag({ path: path.join(extensionRoot, "content-lib.js") });
  await page.addScriptTag({ path: path.join(extensionRoot, "content.js") });
}

function mockOpenAI() {
  const listeners = [];
  window.__translationRequests = [];
  window.chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        }
      },
      async sendMessage(message) {
        if (message.type === "GET_PUBLIC_SETTINGS") {
          return {
            ok: true,
            configured: true,
            provider: "openai",
            settings: {
              targetLanguage: "English",
              model: "gpt-5.6-luna",
              autoTranslate: window.__autoTranslate ?? true
            }
          };
        }
        if (message.type === "TRANSLATE_COMMENTS") {
          window.__translationRequests.push(message);
          return {
            ok: true,
            targetLanguage: "English",
            translations: Object.fromEntries(message.texts.map(({ id, text }) => [
              id,
              /^[\x00-\x7F\s]+$/.test(text) ? null : `English translation: ${text}`
            ]))
          };
        }
        return { ok: false };
      }
    }
  };
  window.__extensionListeners = listeners;
}

test("translates existing and dynamically rendered Google Docs comments", {
  skip: !fs.existsSync(chromeExecutable) && "Google Chrome is not installed"
}, async () => {
  const browser = await chromium.launch({
    executablePath: chromeExecutable,
    headless: true
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

    await page.addInitScript(mockOpenAI);

    const fixtureHtml = `
      <!doctype html>
      <html>
        <body>
          <aside style="width: 340px; padding: 20px">
            <section aria-label="Comments dialog. Open comment. Author Example User. 2 replies.">
              <div class="docos-replyview-body">公園のセンサーが気温と湿度を測定します。</div>
              <div class="docos-replyview-body">Yes I agree completely</div>
            </section>
            <section id="secondThread" aria-label="Comments dialog. Open comment. Author Example User. 0 replies.">
              <div class="docos-replyview-body">サンプル企業がお送りする技術速報です。</div>
            </section>
          </aside>
        </body>
      </html>
    `;
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(fixtureHtml)}`);
    await loadContentScript(page);

    await page.waitForFunction(() => document.querySelectorAll(".dct-translated-source").length === 2);
    assert.equal(await page.locator(".dct-translation").count(), 0);
    assert.match(await page.locator(".docos-replyview-body").first().textContent(), /English translation/);
    assert.equal(await page.locator(".docos-replyview-body").nth(1).textContent(), "Yes I agree completely");
    const translatedStyle = await page.locator(".dct-translated-source").first().evaluate((node) => ({
      borderLeftStyle: getComputedStyle(node).borderLeftStyle,
      label: getComputedStyle(node, "::before").content,
      hasLanguageAttribute: node.hasAttribute("data-dct-target-language")
    }));
    assert.equal(translatedStyle.borderLeftStyle, "solid");
    assert.equal(translatedStyle.label, "none");
    assert.equal(translatedStyle.hasLanguageAttribute, false);
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => window.__translationRequests.length), 1);

    await page.evaluate(() => {
      const reply = document.createElement("div");
      reply.className = "docos-replyview-body";
      reply.textContent = "新しい返信です。";
      document.getElementById("secondThread").append(reply);
    });

    await page.waitForFunction(() => document.querySelectorAll(".dct-translated-source").length === 3);
    assert.equal(await page.locator(".dct-translation").count(), 0);
    assert.ok(await page.evaluate(() => window.__translationRequests.length >= 2));

    await page.locator(".docos-replyview-body").first().evaluate((node) => {
      node.textContent = "更新されたコメントです。";
    });
    await page.waitForFunction(() => window.__translationRequests.length >= 3);
    assert.equal(await page.locator(".dct-translated-source").count(), 3);
    assert.equal(await page.locator("section").first().locator(".dct-translated-source").count(), 1);
  } finally {
    await browser.close();
  }
});

async function openMeetFixture(browser) {
  const page = await browser.newPage();
  await page.addInitScript(mockOpenAI);
  await page.route("**/*", (route) => route.fulfill({
    path: path.join(__dirname, "meet-chat.html"),
    contentType: "text/html"
  }));
  await page.goto("https://meet.google.com/test-call");
  return page;
}

async function holdNextResponse(page, type) {
  await page.evaluate((type) => {
    const runtime = window.chrome.runtime;
    const send = runtime.sendMessage;
    delete window.__releaseResponse;
    runtime.sendMessage = async (message) => {
      if (message.type !== type) return send(message);
      runtime.sendMessage = send;
      const response = await send(message);
      await new Promise((resolve) => { window.__releaseResponse = resolve; });
      return response;
    };
  }, type);
}

test("translates only Meet chat bodies, including arriving messages", {
  skip: !fs.existsSync(chromeExecutable) && "Google Chrome is not installed"
}, async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutable, headless: true });
  try {
    const page = await openMeetFixture(browser);
    await loadContentScript(page);

    const translated = page.locator(".dct-translated-source");
    await translated.waitFor();
    assert.equal(await translated.textContent(), "English translation: これは日本語");
    assert.equal(await translated.getAttribute("title"), "Original: これは日本語");
    assert.deepEqual(await page.evaluate(() => window.__translationRequests.flatMap(
      (request) => request.texts.map((item) => item.text)
    )), ["Here is a comment in English", "これは日本語"]);
    assert.equal(await page.getByRole("button", { name: "Pin message" }).count(), 2);
    assert.equal(await page.getByRole("textbox").inputValue(), "下書き");

    // Let the initial batch drain before testing the mutation observer.
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const row = document.createElement("div");
      row.dataset.messageId = "third";
      row.innerHTML = '<div jsname="dTKtvb"><div>次のメッセージ</div></div>';
      document.querySelector(".beTDc").append(row);
    });
    const arriving = page.locator("[data-message-id='third'] .dct-translated-source");
    await arriving.waitFor();
    assert.equal(await arriving.textContent(), "English translation: 次のメッセージ");
    assert.equal(await page.evaluate(() => window.__translationRequests.length), 2);

    await page.evaluate(() => {
      window.__autoTranslate = false;
      window.__extensionListeners[0]({ type: "SETTINGS_UPDATED" }, null, () => {});
    });
    assert.equal(await translated.count(), 0);
    assert.equal(await page.getByText("これは日本語", { exact: true }).count(), 1);
    await page.evaluate(async () => {
      const row = document.querySelector("[data-message-id='third']");
      function appendMessage(index) {
        const copy = row.cloneNode(true);
        copy.dataset.messageId = String(index);
        copy.querySelector("[jsname] > div").textContent = "メッセージ " + index;
        row.parentElement.append(copy);
      }
      for (let i = 0; i < 22; i++) appendMessage(i);
      const finished = new Promise((done) => {
        window.__extensionListeners[0]({ type: "TRANSLATE_NOW" }, null, done);
      });
      appendMessage("late");
      await finished;
    });
    assert.equal(await translated.count(), 24);
    assert.equal(await page.locator("[data-message-id='late']").textContent(), "メッセージ late");
    assert.deepEqual(await page.evaluate(() => window.__translationRequests
      .filter((request) => request.force).map((request) => request.texts.length)), [20, 5]);
  } finally {
    await browser.close();
  }
});

test("preserves Meet message links during translation and restoration", {
  skip: !fs.existsSync(chromeExecutable) && "Google Chrome is not installed"
}, async (t) => {
  const browser = await chromium.launch({ executablePath: chromeExecutable, headless: true });
  t.after(() => browser.close());
  const page = await openMeetFixture(browser);
  const row = page.locator("div[data-message-id='second']");
  const body = row.locator("[jsname='dTKtvb'] > div").first();
  await body.evaluate((node) => {
    const link = document.createElement("a");
    link.href = "https://example.org/report";
    link.textContent = "報告書";
    window.originalLink = link;
    node.replaceChildren("資料はこちら ", link);
  });
  await loadContentScript(page);
  const translation = row.locator(".dct-translated-source");
  await translation.waitFor();
  assert.equal(await translation.textContent(), "English translation: 資料はこちら 報告書");
  const link = row.getByRole("link", { name: "報告書" });
  assert.equal(await link.count(), 1);
  assert.equal(await link.getAttribute("href"), "https://example.org/report");
  assert.equal(await link.evaluate((node) => node === window.originalLink), true);

  await holdNextResponse(page, "TRANSLATE_COMMENTS");
  await body.evaluate((node) => { node.firstChild.textContent = "前の資料 "; });
  await page.waitForFunction(() => Boolean(window.__releaseResponse));
  await body.evaluate((node) => { node.firstChild.textContent = "詳細はこちら "; });
  await page.getByText("English translation: 詳細はこちら 報告書", { exact: true }).waitFor();
  await page.evaluate(() => window.__releaseResponse());
  assert.equal(await translation.count(), 1);
  await page.evaluate(() => {
    window.__autoTranslate = false;
    window.__extensionListeners[0]({ type: "SETTINGS_UPDATED" }, null, () => {});
  });
  assert.equal(await translation.count(), 0);
  assert.equal(await body.textContent(), "詳細はこちら 報告書");
  assert.equal(await link.evaluate((node) => node === window.originalLink), true);
  await page.evaluate(() => new Promise((done) => {
    window.__extensionListeners[0]({ type: "TRANSLATE_NOW" }, null, done);
  }));
  await translation.waitFor();
  await body.evaluate((node) => node.remove());
  await translation.waitFor({ state: "detached" });
});

test("ignores late Meet responses after automatic translation is disabled", {
  skip: !fs.existsSync(chromeExecutable) && "Google Chrome is not installed"
}, async (t) => {
  const browser = await chromium.launch({ executablePath: chromeExecutable, headless: true });
  t.after(() => browser.close());
  for (const type of ["GET_PUBLIC_SETTINGS", "TRANSLATE_COMMENTS"]) {
    await t.test(type, async () => {
      const page = await openMeetFixture(browser);
      await page.clock.install();
      await holdNextResponse(page, type);
      await loadContentScript(page);
      await page.clock.runFor(500);
      await page.waitForFunction(() => Boolean(window.__releaseResponse));
      await page.evaluate(() => {
        window.__autoTranslate = false;
        window.__extensionListeners[0]({ type: "SETTINGS_UPDATED" }, null, () => {});
        window.__releaseResponse();
      });
      await page.clock.runFor(1000);
      assert.equal(await page.locator(".dct-translated-source, .dct-translating").count(), 0);
      assert.equal(await page.getByText("これは日本語", { exact: true }).count(), 1);
      assert.equal(await page.evaluate(() => window.__translationRequests.length),
        type === "GET_PUBLIC_SETTINGS" ? 0 : 1);
      await page.close();
    });
  }
});

test("uses Chrome on-device translation when no OpenAI key is saved", {
  skip: !fs.existsSync(chromeExecutable) && "Google Chrome is not installed"
}, async () => {
  const browser = await chromium.launch({
    executablePath: chromeExecutable,
    headless: true
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

    await page.addInitScript(() => {
      const listeners = [];
      window.__backgroundTranslationRequests = [];
      window.__localTranslationPairs = [];
      window.LanguageDetector = class FakeLanguageDetector {
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
      };
      window.Translator = class FakeTranslator {
        static async availability() {
          return "available";
        }

        static async create(options) {
          window.__localTranslationPairs.push(options);
          return {
            async translate(text) {
              return `Local English translation: ${text}`;
            }
          };
        }
      };
      window.chrome = {
        runtime: {
          onMessage: {
            addListener(listener) {
              listeners.push(listener);
            }
          },
          async sendMessage(message) {
            if (message.type === "GET_PUBLIC_SETTINGS") {
              return {
                ok: true,
                configured: false,
                provider: "on-device",
                settings: {
                  targetLanguage: "English",
                  model: "gpt-5.6-luna",
                  autoTranslate: true
                }
              };
            }
            if (message.type === "TRANSLATE_COMMENTS") {
              window.__backgroundTranslationRequests.push(message);
            }
            return { ok: false };
          }
        }
      };
      window.__extensionListeners = listeners;
    });

    const fixtureHtml = `
      <!doctype html>
      <html>
        <body>
          <aside style="width: 340px; padding: 20px">
            <section aria-label="Comments dialog. Open comment.">
              <div class="docos-replyview-body">新しい返信です。</div>
              <div class="docos-replyview-body">Already in English</div>
            </section>
          </aside>
        </body>
      </html>
    `;
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(fixtureHtml)}`);
    await loadContentScript(page);

    await page.waitForFunction(() => document.querySelectorAll(".dct-translated-source").length === 1);
    assert.match(await page.locator(".docos-replyview-body").first().textContent(), /Local English translation/);
    assert.equal(await page.locator(".docos-replyview-body").nth(1).textContent(), "Already in English");
    assert.equal(await page.evaluate(() => window.__backgroundTranslationRequests.length), 0);
    assert.deepEqual(
      await page.evaluate(() => window.__localTranslationPairs),
      [{ sourceLanguage: "ja", targetLanguage: "en" }]
    );
  } finally {
    await browser.close();
  }
});
