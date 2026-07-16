(function initGoogleDocsReplica(global) {
  "use strict";

  const translations = {
    platform: "Sensors in the park measure temperature and humidity and send the data to a public community dashboard. Staff use the information to adjust watering times.",
    company: "Example Company presents Technology News. This edition introduces a regional library lending service. Networked terminals connect participating locations so people can borrow and return books wherever it is convenient.",
    reply: "This is a newly added reply.",
    edited: "This comment has been updated."
  };

  function translationFor(text) {
    if (/^[\x00-\x7F\s]+$/.test(text)) {
      return null;
    }
    if (text.startsWith("公園のセンサー")) {
      return translations.platform;
    }
    if (text.startsWith("サンプル企業")) {
      return translations.company;
    }
    if (text.includes("更新")) {
      return translations.edited;
    }
    return translations.reply;
  }

  global.__extensionListeners = [];
  global.__translationRequests = [];
  global.LanguageDetector = class ReplicaLanguageDetector {
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
  global.Translator = class ReplicaTranslator {
    static async availability() {
      return "available";
    }

    static async create() {
      return { translate: translationFor };
    }
  };
  global.chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          global.__extensionListeners.push(listener);
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
          global.__translationRequests.push(message);
          return { ok: false };
        }
        return { ok: false };
      }
    }
  };

  global.DCTReplica = {
    addReply(text = "新しい返信です。") {
      const entry = document.createElement("article");
      entry.className = "comment-entry reply-entry";
      entry.innerHTML = `
        <div class="comment-meta">
          <span class="avatar">EU</span>
          <div><strong>Example User</strong><time>Just now</time></div>
          <button class="comment-menu" type="button" aria-label="More options">⋮</button>
        </div>
        <div class="docos-replyview-body" dir="auto"></div>
      `;
      entry.querySelector(".docos-replyview-body").textContent = text;
      document.getElementById("secondThread").append(entry);
      return entry;
    },
    editFirstTranslatedComment(text = "更新されたコメントです。") {
      const bodies = document.querySelectorAll(".docos-replyview-body");
      bodies[1].textContent = text;
    }
  };
})(globalThis);
