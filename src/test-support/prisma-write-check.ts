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
 *
 * M4-R1 also flags: a computed property name inside data; a nested relation write
 * (create / connect / update … under a relation key) whose value is not written
 * out in place; a write through a delegate held in a variable or reached by
 * element access (`tx['payment']`, `(tx as any)[model]`) or by `.call` /
 * `.apply`; createManyAndReturn / updateManyAndReturn; `$executeRawUnsafe` /
 * `$queryRawUnsafe`; and `deleteMany` whose `where` is not written out in place.
 */

export const PRISMA_WRITE_METHODS = new Set(['create', 'update', 'upsert', 'createMany', 'updateMany', 'createManyAndReturn', 'updateManyAndReturn']);
/** Raw SQL built from strings: never with request values (M4-R1). */
const RAW_UNSAFE_METHODS = new Set(['$executeRawUnsafe', '$queryRawUnsafe']);
/** Nested writes on a relation: their value must be written out in place too (M4-R1). */
const NESTED_WRITE_KEYS = new Set(['create', 'createMany', 'connectOrCreate', 'update', 'updateMany', 'upsert', 'connect']);

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

const isLiteralOrLiteralArray = (value: ts.Expression): boolean => {
  const v = unwrap(value);
  if (ts.isObjectLiteralExpression(v)) return true;
  return ts.isArrayLiteralExpression(v) && v.elements.every((el) => ts.isObjectLiteralExpression(unwrap(el)));
};

/** Inside a data literal: a computed key, or a nested relation write whose value is not written out in place. */
function nestedProblem(literal: ts.ObjectLiteralExpression): string | null {
  let problem: string | null = null;
  const visit = (obj: ts.ObjectLiteralExpression, inNestedWrite: boolean) => {
    for (const prop of obj.properties) {
      if (problem) return;
      if (prop.name && ts.isComputedPropertyName(prop.name)) {
        problem = 'computed-key';
        return;
      }
      if (ts.isShorthandPropertyAssignment(prop)) {
        const name = prop.name.text;
        if (NESTED_WRITE_KEYS.has(name) || (inNestedWrite && name === 'data')) problem = 'relation-not-literal';
        continue;
      }
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = prop.name.getText();
      const value = unwrap(prop.initializer);
      const nestedKey = NESTED_WRITE_KEYS.has(name) || (inNestedWrite && name === 'data');
      if (nestedKey && !isLiteralOrLiteralArray(value)) {
        problem = 'relation-not-literal';
        return;
      }
      if (ts.isObjectLiteralExpression(value)) visit(value, inNestedWrite || nestedKey);
      if (ts.isArrayLiteralExpression(value)) {
        for (const el of value.elements) {
          const item = unwrap(el);
          if (ts.isObjectLiteralExpression(item)) visit(item, inNestedWrite || nestedKey);
        }
      }
    }
  };
  visit(literal, false);
  return problem;
}

/** null when the value is written out in place; otherwise what is wrong with it. */
function problemWith(value: ts.Expression | undefined, allowArray: boolean): string | null {
  if (!value) return null;
  const v = unwrap(value);
  if (ts.isObjectLiteralExpression(v)) return hasSpread(v) ? 'spread' : nestedProblem(v);
  if (allowArray && ts.isArrayLiteralExpression(v)) {
    if (hasSpread(v)) return 'spread';
    if (!v.elements.every((el) => ts.isObjectLiteralExpression(unwrap(el)))) return 'not-literal';
    for (const el of v.elements) {
      const nested = nestedProblem(unwrap(el) as ts.ObjectLiteralExpression);
      if (nested) return nested;
    }
    return null;
  }
  return 'not-literal';
}

/** Names bound to a model delegate: `const d = tx.payment`, `const d = tx[model]`, a `...Delegate` parameter. */
function delegateVariables(sf: ts.SourceFile, delegates: Set<string>): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrap(node.initializer);
      const isDelegate = (ts.isPropertyAccessExpression(init) && delegates.has(init.name.text)) || ts.isElementAccessExpression(init);
      if (isDelegate && ts.isIdentifier(node.name)) names.add(node.name.text);
      if (ts.isObjectBindingPattern(node.name) && !ts.isObjectLiteralExpression(init)) {
        for (const el of node.name.elements) {
          const key = (el.propertyName ?? el.name).getText(sf);
          if (delegates.has(key) && ts.isIdentifier(el.name)) names.add(el.name.text);
        }
      }
    }
    if (ts.isParameter(node) && node.type && ts.isIdentifier(node.name) && /Delegate\b/.test(node.type.getText(sf))) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

export function findPrismaWriteIssues(source: string, file: string, delegates: Set<string> = prismaModelDelegates()): PrismaWriteFinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings: PrismaWriteFinding[] = [];
  const add = (node: ts.Node, what: string, problem: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    findings.push({ key: `${file} :: ${enclosingName(node)} :: ${what} :: ${problem}`, file, line, problem });
  };
  const delegateVars = delegateVariables(sf, delegates);
  /** The receiver of `.create(...)` etc. is a model delegate reached some other way than `x.<model>`. */
  const indirectDelegate = (receiver: ts.Expression): string | null => {
    const r = unwrap(receiver);
    if (ts.isElementAccessExpression(r)) return 'delegate-element-access';
    if (ts.isIdentifier(r) && delegateVars.has(r.text)) return 'delegate-in-variable';
    return null;
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      const receiver = node.expression.expression;
      if (RAW_UNSAFE_METHODS.has(name)) add(node, name, 'raw-unsafe');
      if (PRISMA_WRITE_METHODS.has(name)) {
        const indirect = indirectDelegate(receiver);
        if (indirect) add(node, `${unwrap(receiver).getText(sf).slice(0, 40)}.${name}`, indirect);
      }
      // tx.payment.create.call(tx.payment, args) / .apply(...)
      if ((name === 'call' || name === 'apply') && ts.isPropertyAccessExpression(unwrap(receiver))) {
        const inner = unwrap(receiver) as ts.PropertyAccessExpression;
        const target = unwrap(inner.expression);
        const viaDelegate = (ts.isPropertyAccessExpression(target) && delegates.has(target.name.text)) || indirectDelegate(target);
        if (PRISMA_WRITE_METHODS.has(inner.name.text) && viaDelegate) add(node, `${inner.name.text}.${name}`, 'write-via-call');
      }
      // deleteMany: which rows go is decided by `where`, written out in place.
      if (name === 'deleteMany' && ts.isPropertyAccessExpression(unwrap(receiver)) && delegates.has((unwrap(receiver) as ts.PropertyAccessExpression).name.text)) {
        const what = `${(unwrap(receiver) as ts.PropertyAccessExpression).name.text}.deleteMany`;
        const arg = node.arguments[0] ? unwrap(node.arguments[0]) : undefined;
        if (arg && !ts.isObjectLiteralExpression(arg)) add(node, what, 'args-not-literal');
        if (arg && ts.isObjectLiteralExpression(arg)) {
          if (arg.properties.some((p) => ts.isSpreadAssignment(p))) add(node, what, 'args-spread');
          const where = arg.properties.find((p) => p.name && p.name.getText(sf) === 'where');
          if (where && (ts.isShorthandPropertyAssignment(where) || (ts.isPropertyAssignment(where) && !ts.isObjectLiteralExpression(unwrap(where.initializer))))) {
            add(node, what, 'where-not-literal');
          } else if (where && ts.isPropertyAssignment(where) && hasSpread(where.initializer)) {
            add(node, what, 'where-spread');
          }
        }
      }
    }
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
        const allowArray = method === 'createMany' || method === 'createManyAndReturn';
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
          const problem = problemWith(prop.initializer, allowArray);
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
