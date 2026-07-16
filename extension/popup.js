(function initPopup(global) {
  "use strict";

  const api = global.browser && global.browser.runtime && global.browser.runtime.sendMessage
    ? global.browser
    : global.chrome;
  const form = document.getElementById("settingsForm");
  const targetLanguage = document.getElementById("targetLanguage");
  const customLanguageField = document.getElementById("customLanguageField");
  const customLanguage = document.getElementById("customLanguage");
  const model = document.getElementById("model");
  const apiKey = document.getElementById("apiKey");
  const autoTranslate = document.getElementById("autoTranslate");
  const removeKey = document.getElementById("removeKey");
  const translateNow = document.getElementById("translateNow");
  const connectionStatus = document.getElementById("connectionStatus");
  const connectionText = document.getElementById("connectionText");
  const message = document.getElementById("message");
  const localTranslator = global.DCTLocalTranslator;
  let hasApiKey = false;
  let statusRevision = 0;

  function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("error", isError);
  }

  async function setProviderStatus(configured) {
    hasApiKey = configured;
    removeKey.disabled = !configured;
    const revision = ++statusRevision;

    if (configured) {
      connectionStatus.classList.add("connected");
      connectionText.textContent = "OpenAI API key saved";
      translateNow.disabled = false;
      return;
    }

    connectionStatus.classList.remove("connected");
    connectionText.textContent = "Checking on-device translation...";
    translateNow.disabled = true;
    const status = await localTranslator.getStatus(selectedLanguage());
    if (revision !== statusRevision) {
      return;
    }

    if (status.available) {
      connectionStatus.classList.add("connected");
      connectionText.textContent = status.state === "available"
        ? "On-device translation ready"
        : "On-device model available";
      translateNow.disabled = false;
      return;
    }

    connectionText.textContent = status.reason === "unsupported-target"
      ? "API key needed for this language"
      : "OpenAI API key needed";
  }

  function setLanguage(language) {
    const option = Array.from(targetLanguage.options).find((item) => item.value === language);
    if (option) {
      targetLanguage.value = language;
      customLanguageField.classList.add("hidden");
    } else {
      targetLanguage.value = "__custom__";
      customLanguage.value = language;
      customLanguageField.classList.remove("hidden");
    }
  }

  function selectedLanguage() {
    return targetLanguage.value === "__custom__"
      ? customLanguage.value.trim()
      : targetLanguage.value;
  }

  async function activeTab() {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }

  async function notifyContent(type) {
    const tab = await activeTab();
    if (!tab || !tab.id) {
      return false;
    }
    try {
      await api.tabs.sendMessage(tab.id, { type });
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function load() {
    const response = await api.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (!response || !response.ok) {
      setMessage("Could not load settings.", true);
      return;
    }
    setLanguage(response.settings.targetLanguage);
    model.value = response.settings.model;
    autoTranslate.checked = response.settings.autoTranslate;
    await setProviderStatus(response.hasApiKey);
  }

  targetLanguage.addEventListener("change", () => {
    customLanguageField.classList.toggle("hidden", targetLanguage.value !== "__custom__");
    if (targetLanguage.value === "__custom__") {
      customLanguage.focus();
    }
    if (!hasApiKey) {
      void setProviderStatus(false);
    }
  });

  customLanguage.addEventListener("input", () => {
    if (!hasApiKey && targetLanguage.value === "__custom__") {
      void setProviderStatus(false);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const language = selectedLanguage();
    if (!language) {
      setMessage("Enter a target language.", true);
      return;
    }

    const response = await api.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings: {
        targetLanguage: language,
        model: model.value,
        autoTranslate: autoTranslate.checked
      },
      apiKey: apiKey.value
    });

    if (!response || !response.ok) {
      setMessage(response && response.error && response.error.message || "Could not save settings.", true);
      return;
    }

    apiKey.value = "";
    await setProviderStatus(response.hasApiKey);
    await notifyContent("SETTINGS_UPDATED");
    setMessage("Saved.");
  });

  removeKey.addEventListener("click", async () => {
    const response = await api.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings: {
        targetLanguage: selectedLanguage() || "English",
        model: model.value,
        autoTranslate: autoTranslate.checked
      },
      removeApiKey: true
    });
    if (response && response.ok) {
      await setProviderStatus(false);
      await notifyContent("SETTINGS_UPDATED");
      setMessage("API key removed.");
    }
  });

  translateNow.addEventListener("click", async () => {
    setMessage("Translating visible comments...");
    const sent = await notifyContent("TRANSLATE_NOW");
    setMessage(sent ? "Translation started." : "Open a Google Docs document first.", !sent);
  });

  load();
})(globalThis);
