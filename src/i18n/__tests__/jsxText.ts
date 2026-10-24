import ts from "typescript";

const textProps = new Set([
  "title",
  "subtitle",
  "description",
  "label",
  "placeholder",
  "alt",
  "aria-label",
  "aria-description",
  "seoTitle",
  "keywords",
  "emptyMessage",
  "copyLabel",
  "linkLabel",
  "children",
  "header",
]);
const productTerms = new Set([
  "Quanta",
  "QRL",
  "QRL 2.0",
  "MyQRLWallet",
  "Testnet",
  "UNK",
  "Google Play",
  "myqrlwallet.com",
]);

/** AST guard limited to the converted surfaces; attributes used for code are excluded. */
export function jsxTextFindings(
  source: string,
  file = "fixture.tsx",
): string[] {
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings: string[] = [];
  const report = (node: ts.Node, text: string) => {
    const value = text.replace(/\s+/g, " ").trim();
    if (!/\p{L}/u.test(value) || productTerms.has(value)) return;
    const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast));
    findings.push(`${file}:${line + 1}: ${value}`);
  };
  const visible = (node: ts.Node | undefined): void => {
    if (!node) return;
    if (ts.isStringLiteralLike(node)) report(node, node.text);
    else if (ts.isJsxExpression(node)) visible(node.expression);
    else if (ts.isConditionalExpression(node)) {
      visible(node.whenTrue);
      visible(node.whenFalse);
    } else if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
        visible(node.right);
      else if (
        [
          ts.SyntaxKind.PlusToken,
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.BarBarToken,
        ].includes(node.operatorToken.kind)
      ) {
        visible(node.left);
        visible(node.right);
      }
    } else if (ts.isTemplateExpression(node)) {
      report(node.head, node.head.text);
      for (const span of node.templateSpans)
        report(span.literal, span.literal.text);
    } else if (ts.isParenthesizedExpression(node)) visible(node.expression);
  };
  const visit = (node: ts.Node): void => {
    // CSS and scripts are code, not copy.
    if (
      ts.isJsxElement(node) &&
      ["style", "script"].includes(node.openingElement.tagName.getText(ast))
    )
      return;
    if (ts.isJsxText(node)) report(node, node.text);
    else if (ts.isJsxAttribute(node) && textProps.has(node.name.getText(ast)))
      visible(node.initializer);
    else if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent))
      visible(node.expression);
    else if (
      ts.isPropertyAssignment(node) &&
      textProps.has(node.name.getText(ast))
    )
      visible(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return findings;
}
