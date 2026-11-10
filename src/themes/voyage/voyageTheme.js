import {defineTheme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral';

// Figtree stays the Latin face named by Neutral. Source Han Serif SC is only
// the fallback, so CJK uses the self-hosted 思源宋体 and Latin stays Figtree.
const cjkFallbacks =
  '"Source Han Serif SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const voyageTheme = defineTheme({
  name: 'voyage',
  extends: neutralTheme,
  typography: {
    scale: {base: 14, ratio: 1.2},
    body: {
      family: 'Figtree',
      fallbacks: cjkFallbacks,
    },
    heading: {
      family: 'Figtree',
      fallbacks: cjkFallbacks,
      weights: {3: 'bold', 4: 'bold'},
    },
    code: {
      family: 'ui-monospace',
      fallbacks:
        '"SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
  },
});
