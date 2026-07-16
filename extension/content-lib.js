(function initContentLib(global) {
  "use strict";

  const PRIMARY_BODY_SELECTOR = [
    ".docos-replyview-body",
    ".docos-anchoredreplyview-body",
    ".docos-replyview-body-contents",
    "[data-comment-text]"
  ].join(",");

  const THREAD_SELECTOR = [
    "[aria-label*='Comments dialog']",
    "[aria-label*='Comment thread']",
    "[role='dialog'][aria-label*='comment' i]",
    ".docos-anchoredreplyview",
    ".docos-comments-sidebar-card"
  ].join(",");

  const FALLBACK_BODY_SELECTOR = [
    "[dir='auto']",
    "[dir='ltr']",
    "[dir='rtl']",
    "[role='paragraph']"
  ].join(",");

  const BLOCKED_TAGS = new Set([
    "BUTTON", "INPUT", "TEXTAREA", "SELECT", "OPTION", "TIME", "IMG", "SVG"
  ]);

  const METADATA_CLASS = /(author|avatar|header|footer|menu|reaction|resolve|timestamp|time-label|reply-button|action)/i;

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[\t ]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim();
  }

  function fingerprint(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function isVisible(element) {
    const view = element.ownerDocument && element.ownerDocument.defaultView;
    if (!view || !view.getComputedStyle) {
      return true;
    }
    const style = view.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function isCandidate(element) {
    if (!element || BLOCKED_TAGS.has(element.tagName)) {
      return false;
    }
    if (element.closest(".dct-translation, [contenteditable='true'], [role='button'], button")) {
      return false;
    }
    if (METADATA_CLASS.test(String(element.className || ""))) {
      return false;
    }
    if (!isVisible(element)) {
      return false;
    }
    const text = normalizeText(element.textContent);
    return text.length >= 2 && text.length <= 12000;
  }

  function dedupeCandidates(candidates) {
    const unique = [];
    for (const candidate of candidates) {
      const text = normalizeText(candidate.textContent);
      const duplicate = unique.some((existing) => {
        if (existing === candidate) {
          return true;
        }
        const existingText = normalizeText(existing.textContent);
        return existingText === text && (existing.contains(candidate) || candidate.contains(existing));
      });
      if (!duplicate) {
        unique.push(candidate);
      }
    }
    return unique;
  }

  function findCommentBodies(root) {
    const documentRoot = root && root.querySelectorAll ? root : global.document;
    const primary = Array.from(documentRoot.querySelectorAll(PRIMARY_BODY_SELECTOR))
      .filter(isCandidate);
    if (primary.length > 0) {
      return dedupeCandidates(primary);
    }

    const fallback = [];
    for (const thread of documentRoot.querySelectorAll(THREAD_SELECTOR)) {
      const bodies = Array.from(thread.querySelectorAll(FALLBACK_BODY_SELECTOR))
        .filter(isCandidate)
        .filter((element) => !Array.from(element.children).some((child) => isCandidate(child)));
      fallback.push(...bodies);
    }
    return dedupeCandidates(fallback);
  }

  global.DCTContentLib = {
    FALLBACK_BODY_SELECTOR,
    PRIMARY_BODY_SELECTOR,
    THREAD_SELECTOR,
    findCommentBodies,
    fingerprint,
    normalizeText
  };
})(globalThis);

