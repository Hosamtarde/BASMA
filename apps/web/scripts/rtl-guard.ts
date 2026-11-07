/**
 * RTL guard: layout must use logical properties only (ms/me/ps/pe/start/end/text-start…), so the
 * same markup mirrors between Arabic (RTL) and English (LTR). A line may opt out with the comment
 * `rtl-guard-ignore` plus a reason (e.g. the tooth chart keeps a fixed anatomical LTR geometry).
 */

export interface Finding {
  file: string;
  line: number;
  match: string;
  hint: string;
}

const CLASS_RULES: { re: RegExp; hint: string }[] = [
  {
    re: /(?<![\w-])-?(?:ml|mr|pl|pr|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-[\w[.\]/-]+/g,
    hint: 'use ms-/me-/ps-/pe-',
  },
  { re: /(?<![\w-])-?(?:left|right)-[\w[.\]/-]+/g, hint: 'use start-/end-' },
  {
    re: /(?<![\w-])(?:text|float|clear)-(?:left|right)(?![\w-])/g,
    hint: 'use text-start/text-end, float-start/float-end',
  },
  { re: /(?<![\w-])border-[lr](?:-[\w[.\]/-]+)?(?![\w-])/g, hint: 'use border-s/border-e' },
  {
    re: /(?<![\w-])rounded-(?:[lr]|tl|tr|bl|br)(?:-[\w[.\]/-]+)?(?![\w-])/g,
    hint: 'use rounded-s/-e/-ss/-se/-es/-ee',
  },
  {
    // A direction on the cell itself flips its start/end, so the value drifts away from its header.
    re: /<t[dh]\b[^>]*?(?:\bdir=|className=["'{][^>]*?(?<![\w-])num(?![\w-]))/g,
    hint: 'never put num/dir on a table cell: use Td kind="number"/"money" or autoDir (components/ui/table)',
  },
];

const CSS_RULES: { re: RegExp; hint: string }[] = [
  {
    re: /(?<![\w-])(?:margin|padding|border|scroll-margin|scroll-padding)-(?:left|right)(?:-[\w-]+)?\s*:/g,
    hint: 'use *-inline-start/end',
  },
  { re: /(?<![\w-])(?:left|right)\s*:/g, hint: 'use inset-inline-start/end' },
  { re: /(?<![\w-])(?:text-align|float|clear)\s*:\s*(?:left|right)\b/g, hint: 'use start/end' },
  {
    re: /(?<![\w-])border-(?:top|bottom)-(?:left|right)-radius\s*:/g,
    hint: 'use border-start-start-radius…',
  },
];

const IGNORE = 'rtl-guard-ignore';

/** Scans one file's text; `kind` picks class rules (TS/TSX) or CSS property rules. */
export function scan(file: string, text: string, kind: 'tsx' | 'css'): Finding[] {
  const rules = kind === 'css' ? CSS_RULES : CLASS_RULES;
  const findings: Finding[] = [];
  text.split(/\r?\n/).forEach((lineText, i) => {
    if (lineText.includes(IGNORE)) return;
    for (const { re, hint } of rules) {
      for (const m of lineText.matchAll(re)) findings.push({ file, line: i + 1, match: m[0], hint });
    }
  });
  return findings;
}
