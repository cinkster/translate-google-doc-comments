const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");

const chromeExecutable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const extensionRoot = path.join(__dirname, "../extension");
const chatUrl = "https://chat.google.com/embed/space/fixture?origin=https%3A%2F%2Fmeet.google.com";
const meetUrl = "https://meet.google.com/fixture";
const otherUrl = "https://example.org/fixture";

test("the unpacked extension translates continuous chat only inside Meet", {
  skip: !fs.existsSync(chromeExecutable) && "Google Chrome is not installed"
}, async (t) => {
  const context = await chromium.launchPersistentContext("", {
    executablePath: chromeExecutable,
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging"]
  });
  t.after(() => context.close());
  const browserSession = await context.browser().newBrowserCDPSession();
  const { id } = await browserSession.send("Extensions.loadUnpacked", { path: extensionRoot });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate(async () => {
    globalThis.requestedTexts = [];
    globalThis.fetch = async (_url, options) => {
      const { comments } = JSON.parse(JSON.parse(options.body).input);
      requestedTexts.push(...comments.map(({ text }) => text));
      const translations = comments.map(({ id, text }) => ({ id, translation: "English: " + text }));
      return Response.json({ output_text: JSON.stringify({ translations }) });
    };
    await chrome.storage.local.set({ apiKey: "fixture-key", autoTranslate: true });
  });

  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url === chatUrl) return route.fulfill({ path: path.join(__dirname, "continuous-chat.html") });
    if (url === meetUrl || url === otherUrl) {
      return route.fulfill({ contentType: "text/html", body: `<iframe src="${chatUrl}"></iframe>` });
    }
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(meetUrl);
  const chat = page.frameLocator("iframe");
  const translation = chat.locator(".dct-translated-source");
  await translation.waitFor();
  assert.equal(await translation.textContent(), "English: 窓を開けます。");
  assert.equal(await translation.getAttribute("title"), "Original: 窓を開けます。");
  assert.deepEqual(await worker.evaluate(() => requestedTexts), ["窓を開けます。"]);

  await chat.locator("main").evaluate((list) => {
    const topic = document.createElement("c-wiz");
    topic.dataset.topicId = "new";
    topic.innerHTML = '<div jsname="bgckF">今から始めます。</div>';
    list.append(topic);
  });
  await chat.getByText("English: 今から始めます。", { exact: true }).waitFor();

  // Supply a deterministic native translator only in the top Meet content script.
  const session = await context.newCDPSession(page);
  const worlds = [];
  session.on("Runtime.executionContextCreated", ({ context }) => worlds.push(context));
  await session.send("Runtime.enable");
  const { frameTree } = await session.send("Page.getFrameTree");
  const meetWorld = worlds.find((world) => world.origin === "chrome-extension://" + id &&
    world.auxData.frameId === frameTree.frame.id);
  assert.ok(meetWorld, "Meet content script is loaded");
  const stub = await session.send("Runtime.evaluate", {
    contextId: meetWorld.id,
    expression: `globalThis.Translator = {
      availability: async () => "available",
      create: async () => ({ translate: async (text) => "Local: " + text })
    }`
  });
  assert.equal(stub.exceptionDetails, undefined);

  const tabId = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.storage.local.set({ apiKey: "", autoTranslate: false });
    await chrome.tabs.sendMessage(tab.id, { type: "SETTINGS_UPDATED" });
    return tab.id;
  });
  await translation.first().waitFor({ state: "detached" });
  await worker.evaluate((id) => chrome.tabs.sendMessage(id, { type: "TRANSLATE_NOW" }), tabId);
  await chat.getByText("Local: 窓を開けます。", { exact: true }).waitFor();
  await chat.getByText("Local: 今から始めます。", { exact: true }).waitFor();
  assert.deepEqual(await worker.evaluate(() => requestedTexts), ["窓を開けます。", "今から始めます。"]);

  // The identical Chat URL, including its Meet query parameter, must stay idle elsewhere.
  for (const url of [chatUrl, otherUrl]) {
    await page.goto(url);
    const document = url === chatUrl ? page : page.frameLocator("iframe");
    await document.getByText("窓を開けます。", { exact: true }).waitFor();
    await assert.rejects(worker.evaluate((id) =>
      chrome.tabs.sendMessage(id, { type: "TRANSLATE_NOW" }), tabId), /receiving end does not exist/i);
    assert.equal(await document.locator(".dct-translated-source").count(), 0);
  }
});
