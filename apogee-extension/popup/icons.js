/**
 * Duotone icon set, shared in spirit with the landing page (docs/app.js): every
 * glyph is a 24x24 box holding a soft accent fill layer (.f) under an ink
 * stroke layer, so icons pick up the surrounding text colour instead of being
 * PNG-tinted with a filter. Markup is inlined rather than loaded as <img> so
 * the stroke can inherit currentColor.
 */

/** Fill + stroke the same outline, then add any detail strokes on top. */
function duo(body, extra = "") {
  return `<path class="f" d="${body}"/><path d="${body}"/>${extra}`;
}

export const ICONS = {
  // --- straight from the landing page's set ---
  sparkle: duo(
    "M12 2.6l2.3 6.1 6.1 2.3-6.1 2.3L12 19.4l-2.3-6.1L3.6 11l6.1-2.3z",
    '<path d="M19 3.5v3M20.5 5h-3"/>',
  ),
  chat: '<path class="f" d="M4 4h16v12H8l-4 4z"/><path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h4"/>',
  clock:
    '<circle class="f" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  filetext:
    '<path class="f" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  translate:
    '<path class="f" d="M3 5h11v10H3z"/><path d="M3 6h10M8 6v1.5c0 3-2 5-4.5 6M6 9c.8 2 2.5 3.4 5 4"/><path d="M13.5 20l3.5-8 3.5 8M15 17h4"/>',
  chip: '<rect class="f" x="5" y="5" width="14" height="14" rx="2.5"/><rect x="5" y="5" width="14" height="14" rx="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>',
  server:
    '<rect class="f" x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="3" width="18" height="7" rx="2"/><rect class="f" x="3" y="14" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
  mail: '<rect class="f" x="2" y="4" width="20" height="16" rx="2.5"/><rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="m3 6.5 9 6.5 9-6.5"/>',
  moon: duo("M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5z"),
  shield: duo(
    "M12 22s8-3.5 8-9.5V5l-8-3-8 3v7.5C4 18.5 12 22 12 22z",
    '<path d="M9 12l2 2 4-4"/>',
  ),
  skip: duo("M6 5l10 7-10 7z", '<path d="M19 5v14"/>'),

  // --- drawn to match, for controls the landing page has no icon for ---
  sliders:
    '<circle class="f" cx="16" cy="7" r="2.4"/><circle cx="16" cy="7" r="2.4"/><circle class="f" cx="9" cy="17" r="2.4"/><circle cx="9" cy="17" r="2.4"/><path d="M3 7h10.5M18.5 7H21M3 17h3.5M11.5 17H21"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  arrow: '<path d="M4.5 12h14M13 6.5l5.5 5.5-5.5 5.5"/>',
  chevron: '<path d="M6 14.5l6-6 6 6"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  copy: '<rect class="f" x="9" y="9" width="12" height="12" rx="2.5"/><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5"/>',
  refresh:
    '<path d="M20.5 11A8.5 8.5 0 0 0 6.2 5.8L3 8.8"/><path d="M3.5 13a8.5 8.5 0 0 0 14.3 5.2l3.2-3"/><path d="M3 4v5h5M21 20v-5h-5"/>',
  activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  lines: '<path d="M5 6h14M5 12h14M5 18h9"/>',
  robot:
    '<rect class="f" x="3.5" y="8" width="17" height="12" rx="3"/><rect x="3.5" y="8" width="17" height="12" rx="3"/><path d="M12 4.5V8M9 13h.01M15 13h.01M9.5 16.5h5"/><circle cx="12" cy="3.2" r="1.3"/>',
  send: duo(
    "M21.5 2.5l-7 19-3.8-8.2-8.2-3.8z",
    '<path d="M21.5 2.5L10.7 13.3"/>',
  ),
  bug: '<rect class="f" x="7" y="7.5" width="10" height="12" rx="5"/><rect x="7" y="7.5" width="10" height="12" rx="5"/><path d="M9 7.5a3 3 0 0 1 6 0M2.5 11H7M17 11h4.5M2.5 17H7M17 17h4.5M12 12v5"/>',
  bulb: duo(
    "M12 2.5a6.5 6.5 0 0 1 3.8 11.8V16.5h-7.6V14.3A6.5 6.5 0 0 1 12 2.5z",
    '<path d="M9.5 19.5h5M10.5 22h3"/>',
  ),
  download:
    '<path class="f" d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3z"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/><path d="M12 3v11m0 0 4-4m-4 4-4-4"/>',
  trash:
    '<path class="f" d="M6 8h12l-1 12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z"/><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M10 11v6M14 11v6"/>',

  // Brand marks stay as their official filled glyph rather than being redrawn.
  github:
    '<path class="brand" d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.9 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.2 4.7 18.2 5 18.2 5c.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3z"/>',
};

/**
 * Swaps every [data-ico] placeholder for its inline SVG. Runs on load (this
 * module is its own <script> in popup.html, so icons appear even if popup.js
 * fails to boot) and can be re-run for markup rendered later.
 */
export function applyIcons(root = document) {
  root.querySelectorAll("[data-ico]").forEach((el) => {
    const glyph = ICONS[el.getAttribute("data-ico")];
    if (glyph) {
      el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${glyph}</svg>`;
    }
  });
}

/** Icon markup for the places that build their button contents in JS. */
export function icon(name) {
  return `<span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[name] || ""}</svg></span>`;
}

applyIcons();
