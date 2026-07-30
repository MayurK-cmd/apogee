import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "content/Readability.js"],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        // Vite's `define` (see vite.config.js) string-replaces
        // `process.env.TARGET_BROWSER` at build time; it isn't a real
        // runtime global, but source files reference it as one.
        process: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["vite.config.js", "tests/**/*.js", "scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Content scripts are injected as plain (non-module) scripts, one per
    // file, into the same page global scope (see popup.js's
    // extractFromActiveTab), so functions declared in one file are called
    // from another with no import/export between them.
    files: ["content/**/*.js"],
    languageOptions: { sourceType: "script" },
    rules: {
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^extract" },
      ],
    },
  },
  {
    // Only content.js *consumes* the other files' globals; declaring these
    // as globals on the files that define them would make ESLint flag the
    // declarations themselves as redeclaring a global.
    files: ["content/content.js"],
    languageOptions: {
      globals: {
        Readability: "readonly",
        extractGeneric: "readonly",
        extractGmail: "readonly",
        extractYoutube: "readonly",
        extractHackerNews: "readonly",
        extractReddit: "readonly",
        extractGitHub: "readonly",
      },
    },
  },
  {
    // generic.js consumes Readability.js's global (loaded first, see
    // popup.js's extractFromActiveTab injection order), but doesn't declare it.
    files: ["content/extractors/generic.js"],
    languageOptions: {
      globals: { Readability: "readonly" },
    },
  },
  {
    // thread.js DEFINES the shared discussion-thread helpers that hackernews.js
    // and reddit.js consume; within thread.js itself they read as unused.
    files: ["content/extractors/thread.js"],
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern:
            "^(threadTruncate|buildThreadNodes|selectThreadComments|formatThreadComments|THREAD_COMMENTS_HEADER)$",
        },
      ],
    },
  },
  {
    // These CONSUME thread.js's globals (loaded first, see the extractor
    // injection order in lib/extract/pageExtraction.js).
    files: [
      "content/extractors/hackernews.js",
      "content/extractors/reddit.js",
      "content/extractors/github.js",
    ],
    languageOptions: {
      globals: {
        threadTruncate: "readonly",
        buildThreadNodes: "readonly",
        selectThreadComments: "readonly",
        formatThreadComments: "readonly",
        THREAD_COMMENTS_HEADER: "readonly",
      },
    },
  },
  prettier,
];
