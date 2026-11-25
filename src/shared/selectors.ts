/**
 * Versioned selector registry for the DOM engine: Tier 1 (semantic attributes and localized
 * English/Spanish label text), Tier 2 (Google's generated class names / jsname values), leak
 * detector config, and the safety-guard landmarks.
 * Runs in: content script on google.com.
 * Must never: be fetched or extended remotely (no remote config); changes ship in a release.
 * Shared with: content/dom-engine.ts. The same selectors are mirrored in content/static-guard.css.
 */

export const SUPPORTED_UI_LANGUAGES = ["en", "es"] as const;

/** UI language whose Google Search labels are bundled in SELECTORS (D5: English + Spanish). */
export type SupportedUiLanguage = (typeof SUPPORTED_UI_LANGUAGES)[number];

/** Result of resolving document.documentElement.lang against supported UI languages (BP-03). */
export interface UiLanguageResolution {
  language: SupportedUiLanguage;
  normalizedTag: string;
  supported: boolean;
}

/**
 * Resolve Google Search's <html lang="..."> value to a supported label set using primary-subtag
 * prefix matching (e.g. "es-419" and "es-US" -> "es", "fr-CA" -> unsupported "fr").
 * @param rawLang - document.documentElement.lang value.
 * @returns Active language ("en" fallback when unsupported), sanitized subtag, and support flag.
 * Fails safe: missing/blank lang attributes default to "en" without emitting a warning.
 */
export function resolveUiLanguage(rawLang: string | null | undefined): UiLanguageResolution {
  if (typeof rawLang !== "string") {
    return { language: "en", normalizedTag: "", supported: true };
  }
  const cleaned = rawLang.trim().toLowerCase();
  if (!cleaned) {
    return { language: "en", normalizedTag: "", supported: true };
  }
  const primarySubtag = cleaned.split(/[-_\s]/)[0].replace(/[^a-z0-9-]/g, "").slice(0, 16);
  if (primarySubtag === "en") {
    return { language: "en", normalizedTag: "en", supported: true };
  }
  if (primarySubtag === "es") {
    return { language: "es", normalizedTag: "es", supported: true };
  }
  return {
    language: "en",
    normalizedTag: primarySubtag || "unknown",
    supported: false
  };
}

export const SELECTORS = {
  safetyGuard: {
    protectedTags: ["HTML", "BODY", "HEAD", "MAIN"],
    // FRAGILE(google-dom, last verified NONE, see tests L-01/L-07): Google Search structural landmarks, organic heading selectors, and main search input.
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
    // FRAGILE(google-dom, last verified NONE, see tests L-01/L-07): organic result heading selectors used by the safety guard.
    organicResultSelector: "a > h3, a h3, h3.LC20lb",
    // Refuse to hide anything holding this many organic results. AI Overview and AI Mode
    // candidates are held to 1 (BP-08 / security hardening): neither legitimately contains a real
    // organic search result, so a candidate that does is a wrapper and hiding it would remove real results.
    organicResultThreshold: 3,
    overviewOrganicResultThreshold: 1,
    // How far findOverviewHeadingContainer may walk up from an "AI Overview" heading (BP-08).
    maxAncestorDepth: 8,
    // FRAGILE(google-dom, last verified NONE, see tests L-01/L-07): Google Search main query input selector.
    searchInputSelector: 'textarea[name="q"], input[name="q"]'
  },
  // FRAGILE(google-dom, last verified 2026-11-21): Tier 1 semantic attrs, localized en/es labels
  // collected from live Google (?hl=en, ?hl=es -> es-US, ?hl=es-419), and Google-only AI Mode hrefs.
  // Legacy attrs [data-attrid="AIOverview"], [data-async-type="aiOverview"], [aria-label="AI Overview"],
  // div.Fzsovc, and [data-base-lens-url] had 0 live matches on 2026-11-21 and stay as fallbacks.
  tier1: {
    aiOverviews: {
      directSelectors: [
        '[data-attrid="AIOverview"]',
        '[data-async-type="aiOverview"]'
      ],
      localizedDirectSelectors: {
        // FRAGILE(google-dom, last verified 2026-11-21): legacy exact aria-label fallback (0 matches on hl=en 2026-11-21; live uses div[role="heading"] > strong.WJFise).
        en: ['[aria-label="AI Overview"]'],
        // FRAGILE(google-dom, last verified 2026-11-21): Spanish heading text from live Google (?hl=es / ?hl=es-419).
        es: ['[aria-label="Visión general creada por IA"]']
      },
      headingSelectors: ["h1", "h2", '[role="heading"]', "div.Fzsovc"],
      headingTexts: {
        // FRAGILE(google-dom, last verified 2026-11-21): observed on live Google (?hl=en) in div[role="heading"][aria-level="2"] > strong.WJFise.
        en: ["ai overview"],
        // FRAGILE(google-dom, last verified 2026-11-21): observed verbatim on live Google (?hl=es and ?hl=es-419).
        es: ["visión general creada por ia"]
      },
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
      exactTexts: {
        // FRAGILE(google-dom, last verified 2026-11-21): "AI Mode" observed on live Google (?hl=en) nav tab and search-bar button.
        en: ["ai mode", "dive deeper in ai mode", "ask ai mode"],
        // FRAGILE(google-dom, last verified 2026-11-21): "Modo IA" observed verbatim on live Google (?hl=es and ?hl=es-419) nav tab and search-bar button.
        es: ["modo ia"]
      },
      navItemAncestor: '[role="listitem"]'
    },
    auxiliaryAi: {
      directSelectors: [
        'a[href*="labs.google.com"]',
        "[data-base-lens-url]",
        // FRAGILE(google-dom, last verified 2026-11-21): embedded follow-up input plate inside #eKIzJc on live Google (EN/ES/ES-419).
        '[data-xid="aim-mars-input-plate"]'
      ],
      localizedDirectSelectors: {
        en: [
          // FRAGILE(google-dom, last verified 2026-11-21): Search Labs did not render in test account; retained from prior DOM capture.
          '[aria-label*="Search Labs" i]',
          // FRAGILE(google-dom, last verified 2026-11-21): observed verbatim on live Google (?hl=en) Lens button.
          '[aria-label*="Search by image" i]',
          // FRAGILE(google-dom, last verified 2026-11-21): legacy follow-up wording (0 matches on hl=en 2026-11-21; replaced by "Ask anything").
          '[aria-label*="Ask a follow up" i]',
          '[placeholder*="Ask a follow up" i]',
          // FRAGILE(google-dom, last verified 2026-11-21): observed verbatim on live Google (?hl=en) follow-up textarea; :not([name="q"]) protects search input.
          '[aria-label*="Ask anything" i]:not([name="q"])',
          '[placeholder*="Ask anything" i]:not([name="q"])'
        ],
        es: [
          // FRAGILE(google-dom, last verified 2026-11-21): observed verbatim on live Google (?hl=es and ?hl=es-419) Lens button.
          '[aria-label*="Búsqueda por imagen" i]',
          // FRAGILE(google-dom, last verified 2026-11-21): observed verbatim on live Google (?hl=es and ?hl=es-419) follow-up textarea; :not([name="q"]) protects search input.
          '[aria-label*="Haz una pregunta" i]:not([name="q"])',
          '[placeholder*="Haz una pregunta" i]:not([name="q"])'
        ]
      },
      // FRAGILE(google-dom, last verified NONE, see tests L-01/L-07): People Also Ask card wrapper selectors.
      paaCardSelectors: [
        '[jsname="yEVEwb"]',
        '[data-sgrd="true"]',
        "[data-q]",
        "div.related-question-pair"
      ],
      aiAttributionMarkers: {
        // FRAGILE(google-dom, last verified NONE, see tests L-01/L-07): "ai overview" confirmed 2026-11-21; "generative ai" and "ai-generated" did not render on test PAA headers and remain as fallbacks.
        en: ["ai overview", "generative ai", "ai-generated"],
        // FRAGILE(google-dom, last verified 2026-11-21): only observed Spanish AI badge/heading verbatim on live Google; "Generative AI" / "AI-generated" did not render on es PAA headers.
        es: ["visión general creada por ia"]
      }
    }
  },
  tier2: {
    aiOverviews: [
      // FRAGILE(google-dom, last verified 2026-11-21): confirmed on live Google (?hl=en, ?hl=es, ?hl=es-419; 1 match, canonical AIO root).
      "#eKIzJc",
      // FRAGILE(google-dom, last verified 2026-11-21): 0 matches on live Google 2026-11-21; kept as legacy fallback (never drop [data-mcpr] because bare div.YzCcne matches PAA skeletons).
      "div.YzCcne[data-mcpr]",
      // FRAGILE(google-dom, last verified 2026-11-21): 0 matches on live Google 2026-11-21; kept as legacy fallback.
      'div[data-mcp="18"]'
    ],
    aiModeUi: [
      // FRAGILE(google-dom, last verified 2026-11-21): confirmed on live Google (?hl=en, ?hl=es, ?hl=es-419; 1 match wrapping AI Mode nav tab).
      "div.olrp5b",
      // FRAGILE(google-dom, last verified 2026-11-21): confirmed on live Google (?hl=en, ?hl=es, ?hl=es-419; 1 match on homepage and SERP search bar).
      "button.plR5qb",
      // FRAGILE(google-dom, last verified 2026-11-21): confirmed on live Google (?hl=en, ?hl=es, ?hl=es-419; 1 match on homepage and SERP search bar).
      'button[jsname="B6rgad"]'
    ],
    auxiliaryAi: [
      // FRAGILE(google-dom, last verified 2026-11-21): confirmed on live Google (?hl=en, ?hl=es, ?hl=es-419; 1 match for Google Lens button).
      'div[jsname="R5mgy"]'
    ]
  },
  leakDetector: {
    // Limit leak scanning to headings, tabs and buttons so organic article titles aren't flagged (BP-04).
    candidateSelector: 'h1, h2, [role="heading"], [role="tab"], button',
    maxLabelTextLength: 60
  }
};
