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
    // Refuse to hide anything holding this many organic results. AI Overview candidates are held
    // to 1 (BP-08): an Overview card never legitimately contains a real result, so a candidate
    // that does is a wrapper and hiding it would remove real results.
    organicResultThreshold: 3,
    overviewOrganicResultThreshold: 1,
    // How far findOverviewHeadingContainer may walk up from an "AI Overview" heading (BP-08).
    maxAncestorDepth: 8,
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
      // No [data-hveid] (BP-08): Google puts it on most result blocks, so the nearest one can
      // be a wrapper that also holds organic results.
      containerAncestors: [
        "[data-mcpr]",
        "[data-attrid]",
        "[data-async-type]",
        "div#eKIzJc"
      ]
    },
    aiModeUi: {
      // Google destinations only (BP-08): relative links or the two google.com hosts. A link to
      // another site whose URL merely contains "udm=50" or "/aimode" is an organic result.
      // Keep in sync with static-guard.css.
      directSelectors: [
        // A query-only relative link (href="?q=x&udm=50") resolves to /search on a results page.
        'a[href^="?"][href*="udm=50"]',
        'a[href^="/search"][href*="udm=50"]',
        'a[href^="https://www.google.com/search"][href*="udm=50"]',
        'a[href^="https://google.com/search"][href*="udm=50"]',
        'a[href^="/aimode"]',
        'a[href^="https://www.google.com/aimode"]',
        'a[href^="https://google.com/aimode"]',
        'a[href="/ai"]',
        'a[href^="/ai?"]',
        'a[href^="/ai/"]',
        'a[href="https://www.google.com/ai"]',
        'a[href^="https://www.google.com/ai?"]',
        'a[href^="https://www.google.com/ai/"]',
        'a[href="https://google.com/ai"]',
        'a[href^="https://google.com/ai?"]',
        'a[href^="https://google.com/ai/"]'
      ],
      textCandidateSelectors: [
        '[role="tab"]',
        '[role="listitem"] a',
        '[role="listitem"] span',
        "button",
        '[role="button"]'
      ],
      // BP-09 Option D: anchors outside nav listitems are checked separately and skipped when
      // trimmed text exceeds 40 chars, avoiding regex normalization on long organic-result links.
      maxAnchorTextLength: 40,
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
