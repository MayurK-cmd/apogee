import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";

const popupHtmlPath = new URL("../../popup/popup.html", import.meta.url);
const popupHtmlRaw = readFileSync(popupHtmlPath, "utf8");

test("popup.html parses into valid DOM structure", () => {
  const { document } = parseHTML(popupHtmlRaw);
  assert.ok(document.body, "popup.html body must exist");
  assert.ok(
    document.querySelector(".container"),
    "Container element must exist",
  );
});

test("popup.html includes all primary view panels", () => {
  const { document } = parseHTML(popupHtmlRaw);
  const requiredViews = [
    "homeView",
    "summaryView",
    "settingsView",
    "contactView",
  ];

  requiredViews.forEach((id) => {
    const view = document.getElementById(id);
    assert.ok(view, `Application view #${id} must exist in popup.html`);
  });
});

test("popup.html includes key UI action buttons", () => {
  const { document } = parseHTML(popupHtmlRaw);
  const requiredButtons = ["summarizeBtn", "askBtn", "settingsBtn", "closeBtn"];

  requiredButtons.forEach((id) => {
    const btn = document.getElementById(id);
    assert.ok(btn, `Action button #${id} must exist in popup.html`);
  });
});

test("popup.html includes summary text container and chat controls", () => {
  const { document } = parseHTML(popupHtmlRaw);
  const requiredElements = [
    "summaryText",
    "questionInput",
    "sendBtn",
    "summaryCard",
  ];

  requiredElements.forEach((id) => {
    const el = document.getElementById(id);
    assert.ok(el, `UI element #${id} must exist in popup.html`);
  });
});

test("popup.html includes settings configuration controls", () => {
  const { document } = parseHTML(popupHtmlRaw);
  const requiredSettings = [
    "summaryLanguageSelect",
    "customInstructionsInput",
    "privateHostsInput",
    "clearDataBtn",
  ];

  requiredSettings.forEach((id) => {
    const el = document.getElementById(id);
    assert.ok(el, `Settings control #${id} must exist in popup.html`);
  });
});
