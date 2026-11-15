import * as ts from 'typescript';
import { Prisma } from '@prisma/client';

/**
 * Security M4: a syntax-tree check of every Prisma write in src/.
 *
 * A write is a call `<anything>.<modelDelegate>.<create|update|upsert|createMany|updateMany>(args)`,
 * where `<modelDelegate>` is a Prisma model (jobSeeker, payment, …), whatever the
 * client variable is called. It is SAFE only when `args` is an object literal and
 * its `data` (or, for upsert, `create` and `update`) is written out in place: an
 * object literal (or an array of them for createMany) with no spread anywhere
 * inside. Anything else — `data: dto`, `data`, `data: { ...body }`, a value built
 * elsewhere — is a FINDING, and must be fixed or listed in
 * prisma-write-allowlist.ts with a one-line reason.
 */

export const PRISMA_WRITE_METHODS = new Set(['create', 'update', 'upsert', 'createMany', 'updateMany']);

export function prismaModelDelegates(): Set<string> {
  const names = Object.values((Prisma as unknown as { ModelName: Record<string, string> }).ModelName);
  return new Set(names.map((name) => name.charAt(0).toLowerCase() + name.slice(1)));
}

export interface PrismaWriteFinding {
  /** `<file> :: <enclosing function> :: <model>.<method> :: <what is wrong>` — stable across line moves. */
  key: string;
  file: string;
  line: number;
  problem: string;
}

function enclosingName(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isGetAccessorDeclaration(n)) && n.name) return n.name.getText();
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent)) return n.parent.name.getText();
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isPropertyDeclaration(n.parent)) return n.parent.name.getText();
  }
  return '(top level)';
}

function hasSpread(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isSpreadAssignment(n) || ts.isSpreadElement(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e) || ts.isNonNullExpression(e)) {
    e = e.expression;
  }
  return e;
}

/** null when the value is written out in place; otherwise what is wrong with it. */
function problemWith(value: ts.Expression | undefined, allowArray: boolean): string | null {
  if (!value) return null;
  const v = unwrap(value);
  if (ts.isObjectLiteralExpression(v)) return hasSpread(v) ? 'spread' : null;
  if (allowArray && ts.isArrayLiteralExpression(v)) {
    if (hasSpread(v)) return 'spread';
    return v.elements.every((el) => ts.isObjectLiteralExpression(unwrap(el))) ? null : 'not-literal';
  }
  return 'not-literal';
}

export function findPrismaWriteIssues(source: string, file: string, delegates: Set<string> = prismaModelDelegates()): PrismaWriteFinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings: PrismaWriteFinding[] = [];
  const add = (node: ts.Node, what: string, problem: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    findings.push({ key: `${file} :: ${enclosingName(node)} :: ${what} :: ${problem}`, file, line, problem });
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      PRISMA_WRITE_METHODS.has(node.expression.name.text) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      delegates.has(node.expression.expression.name.text)
    ) {
      const method = node.expression.name.text;
      const what = `${node.expression.expression.name.text}.${method}`;
      const arg = node.arguments[0] ? unwrap(node.arguments[0]) : undefined;
      if (!arg || !ts.isObjectLiteralExpression(arg)) {
        add(node, what, 'args-not-literal');
      } else {
        const fields = method === 'upsert' ? ['create', 'update'] : ['data'];
        for (const field of fields) {
          const prop = arg.properties.find((p) => p.name && p.name.getText(sf) === field);
          if (!prop) continue;
          if (ts.isShorthandPropertyAssignment(prop)) {
            add(node, what, `${field}-not-literal`);
            continue;
          }
          if (!ts.isPropertyAssignment(prop)) {
            add(node, what, `${field}-not-literal`);
            continue;
          }
          const problem = problemWith(prop.initializer, method === 'createMany');
          if (problem) add(node, what, `${field}-${problem}`);
        }
        if (arg.properties.some((p) => ts.isSpreadAssignment(p))) add(node, what, 'args-spread');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // The same call shape twice in one function gets a running number, so each site has its own key.
  const seen = new Map<string, number>();
  return findings.map((f) => {
    const n = (seen.get(f.key) ?? 0) + 1;
    seen.set(f.key, n);
    return n === 1 ? f : { ...f, key: `${f.key} #${n}` };
  });
}
