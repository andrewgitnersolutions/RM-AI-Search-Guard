/**
 * Versioned selector registry for the DOM engine: Tier 1 (semantic attributes and label text),
 * Tier 2 (Google's generated class names / jsname values) and the safety-guard landmarks.
 * Runs in: content script on google.com.
 * Must never: be fetched or extended remotely (no remote config); changes ship in a release.
 * Shared with: content/dom-engine.ts. The same selectors are mirrored in content/static-guard.css.
 */

export const SELECTORS = {
  safetyGuard: {
    protectedTags: ["HTML", "BODY", "HEAD", "MAIN"],
    protectedSelectors: [
      "#main",
      "#cnt",
      "#rcnt",
      "#center_col",
      "#search",
      "#rso",
      "#botstuff",
      "#top_nav",
      'form[role="search"]',
      "#searchform"
    ],
    organicResultSelector: "a > h3, h3.LC20lb",
    // BP-08 proposes 1 for the overview category; unchanged in Phase 0.
    organicResultThreshold: 3,
    searchInputSelector: 'textarea[name="q"], input[name="q"]'
  },
  // FRAGILE(google-dom, last verified NONE, see test L-07): Tier 1 attributes, label text (English only, BP-03) and /aimode, udm=50 hrefs.
  tier1: {
    aiOverviews: {
      directSelectors: [
        '[data-attrid="AIOverview"]',
        '[data-async-type="aiOverview"]',
        '[aria-label="AI Overview"]'
      ],
      headingSelectors: ["h1", "h2", '[role="heading"]', "div.Fzsovc"],
      headingTexts: ["ai overview"],
      containerAncestors: [
        "[data-mcpr]",
        "[data-attrid]",
        "[data-async-type]",
        "[data-hveid]",
        "div#eKIzJc"
      ]
    },
    aiModeUi: {
      directSelectors: [
        'a[href*="udm=50"]',
        'a[href*="/aimode"]',
        'a[href^="https://www.google.com/ai"]'
      ],
      textCandidateSelectors: [
        '[role="tab"]',
        '[role="listitem"] a',
        '[role="listitem"] span',
        "button",
        "a"
      ],
      exactTexts: ["ai mode", "dive deeper in ai mode", "ask ai mode"],
      navItemAncestor: '[role="listitem"]'
    },
    auxiliaryAi: {
      directSelectors: [
        'a[href*="labs.google.com"]',
        '[aria-label*="Search Labs" i]',
        '[aria-label*="Search by image" i]',
        "[data-base-lens-url]",
        '[aria-label*="Ask a follow up" i]',
        '[placeholder*="Ask a follow up" i]'
      ],
      paaCardSelectors: [
        '[jsname="yEVEwb"]',
        '[data-sgrd="true"]',
        "[data-q]",
        "div.related-question-pair"
      ],
      aiAttributionMarkers: ["ai overview", "generative ai", "ai-generated"]
    }
  },
  // FRAGILE(google-dom, last verified NONE, see test L-07): Tier 2 generated class names and jsname values (BP-04).
  tier2: {
    aiOverviews: ["#eKIzJc", "div.YzCcne[data-mcpr]", 'div[data-mcp="18"]'],
    aiModeUi: ["div.olrp5b", "button.plR5qb", 'button[jsname="B6rgad"]'],
    auxiliaryAi: ['div[jsname="R5mgy"]']
  }
};
