import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ACCESSIBILITY_ROUTES } from "../e2e/route-inventory";

function possibleHrefs(node: ts.Expression): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [node.head.text + node.templateSpans.map(part => "test-id" + part.literal.text).join("")];
  }
  if (ts.isConditionalExpression(node))
    return [...possibleHrefs(node.whenTrue), ...possibleHrefs(node.whenFalse)];
  if (ts.isParenthesizedExpression(node)) return possibleHrefs(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    return possibleHrefs(node.right);
  throw new Error("Unhandled Today link: " + node.getText());
}

function hrefsIn(file: string): string[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const hrefs: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "href") {
      hrefs.push(...possibleHrefs(node.initializer));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return hrefs;
}

function routeMatches(href: string) {
  const parts = new URL(href, "https://example.test").pathname.split("/").filter(Boolean);
  return ACCESSIBILITY_ROUTES.some(route => {
    const routeParts = route.path.split("/").filter(Boolean);
    return parts.length === routeParts.length && parts.every((part, idx) =>
      routeParts[idx] === part || /^\[[^\]]+\]$/.test(routeParts[idx]));
  });
}

describe("Today items lead to existing pages", () => {
  it("checks all static and templated exception-rule destinations", () => {
    const links = hrefsIn(path.join(process.cwd(), "src/domains/exceptions/rules.ts"));
    expect(links.length).toBeGreaterThan(20);
    for (const href of links) expect(routeMatches(href), href).toBe(true);
  });
  it("checks the purchase-use-tax and retail-delivery-fee destinations", () => {
    const links = hrefsIn(path.join(process.cwd(), "src/domains/tax/acquisition-attention.ts"));
    expect(links).toContain("/desk/sales-tax/delivery-fees");
    for (const href of links) expect(routeMatches(href), href).toBe(true);
  });
});
