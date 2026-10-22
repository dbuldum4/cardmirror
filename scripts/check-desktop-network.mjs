// Guard against accidentally reintroducing Node client networking in desktop
// application code. The real Electron probe checks the shared transport.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../apps/desktop/src/', import.meta.url));
function inspect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { inspect(file); continue; }
    if (!entry.name.endsWith('.ts')) continue;
    const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const sharedFetch = ast.statements.some((statement) =>
      ts.isImportDeclaration(statement) &&
      /(?:^|\/)desktop-fetch\.js$/.test(statement.moduleSpecifier.text) &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some((item) =>
        item.name.text === 'fetch' && item.propertyName?.text === 'desktopFetch'));
    const location = path.relative(root, file);
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const expr = node.expression;
        if (ts.isIdentifier(expr) && expr.text === 'fetch') {
          assert.ok(sharedFetch, location + ': use desktopFetch instead of Node global fetch');
        }
        if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'fetch') {
          assert.equal(location, 'desktop-fetch.ts', location + ': route fetch through desktop-fetch.ts');
        }
      }
      if (ts.isImportDeclaration(node)) {
        assert.ok(!['https', 'node:https', 'tls', 'node:tls', 'undici'].includes(node.moduleSpecifier.text),
          location + ': review new Node client networking before use');
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
}
inspect(root);
console.log('Desktop fetch callers use the shared Chromium transport.');
