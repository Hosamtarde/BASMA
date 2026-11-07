// @ts-check
/**
 * Local rule: user-facing text must come from the i18n catalogs (SPEC §6.1), never from JSX.
 * Reports JSX text, string children and user-visible attributes (aria-label, title, alt,
 * placeholder, label) that contain a letter of any script. Digits, punctuation and symbols
 * (e.g. "·", "—", "#") are allowed. Values from variables or t() are never reported.
 */

const LETTER = /\p{L}/u;
const VISIBLE_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'label',
  'placeholder',
  'title',
]);

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow hard-coded user-facing text in JSX; use the ar/en catalogs' },
    schema: [],
    messages: {
      literal: 'Hard-coded text "{{text}}": add it to ar.json and en.json and render it with t().',
    },
  },
  create(context) {
    /** @param {import('estree').Node} node @param {string} text */
    const report = (node, text) =>
      context.report({ node, messageId: 'literal', data: { text: text.trim().slice(0, 40) } });

    /** @param {any} expr */
    const checkExpression = (expr) => {
      if (expr?.type === 'Literal' && typeof expr.value === 'string' && LETTER.test(expr.value)) {
        report(expr, expr.value);
      } else if (expr?.type === 'TemplateLiteral') {
        const text = expr.quasis.map((/** @type {any} */ q) => q.value.cooked ?? '').join('');
        if (LETTER.test(text)) report(expr, text);
      } else if (expr?.type === 'ConditionalExpression') {
        checkExpression(expr.consequent);
        checkExpression(expr.alternate);
      } else if (expr?.type === 'LogicalExpression') {
        checkExpression(expr.right);
      }
    };

    return {
      /** @param {any} node */
      JSXText(node) {
        if (LETTER.test(node.value)) report(node, node.value);
      },
      /** @param {any} node */
      JSXAttribute(node) {
        const name = typeof node.name.name === 'string' ? node.name.name : '';
        if (!VISIBLE_ATTRIBUTES.has(name) || node.value == null) return;
        if (node.value.type === 'Literal') checkExpression(node.value);
        else if (node.value.type === 'JSXExpressionContainer') checkExpression(node.value.expression);
      },
      /** String children: <p>{'text'}</p> */
      /** @param {any} node */
      'JSXElement > JSXExpressionContainer, JSXFragment > JSXExpressionContainer'(node) {
        checkExpression(node.expression);
      },
    };
  },
};

export default { rules: { 'no-literal-text': rule } };
