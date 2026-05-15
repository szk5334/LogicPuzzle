// Shared fact-rendering helpers used by HintResult and TraceView.
// Kept separate from both files so neither has to import from the other.

import { capit } from '../utils.js';

// Render a fact in theme-aware prose. Uses theme.propLine like the trace view.
export function factSentence(fact, theme) {
  return capit(theme.propLine(fact.catA, fact.a, fact.catB, fact.b, fact.value));
}

// Describe a cascade step in a single readable phrase.
export function cascadePhrase(kind) {
  if (kind === 'exclusivity') return 'by exclusivity';
  if (kind === 'transitivity') return 'by transitivity';
  if (kind === 'last-option') return 'only that option remains';
  return kind;
}
