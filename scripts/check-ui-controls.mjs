import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const forbidden = new Set(['select', 'option', 'optgroup']);
const failures = [];

function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { scan(path); continue; }
    if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true,
      /[jt]sx$/.test(entry.name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = node => {
      let tag;
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) tag = node.tagName.getText(source);
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
        if (name === 'createElement' && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) tag = node.arguments[0].text;
      }
      if (forbidden.has(tag)) {
        const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
        failures.push(`${relative(root, path)}:${line + 1}:${character + 1} 禁止原生 <${tag}>；请复用 Select / GroupSelect（见 AGENTS.md）。`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

scan(join(root, 'src'));
if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('UI 控件检查通过：未发现原生下拉框。\n');
}
