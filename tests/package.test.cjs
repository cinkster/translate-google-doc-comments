const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const extensionRoot = path.join(__dirname, "../extension");
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"));

test("manifest is a narrowly scoped Manifest V3 extension", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://api.openai.com/*"]);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://docs.google.com/document/*"]);
});

test("every manifest resource exists", () => {
  const resources = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => [...script.js, ...script.css]),
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon)
  ];
  for (const resource of new Set(resources)) {
    assert.ok(fs.existsSync(path.join(extensionRoot, resource)), `Missing ${resource}`);
  }
});

