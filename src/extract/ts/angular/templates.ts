import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import type { IrClassifier, IrRelationKind, IrTaggedValue } from '../../../ir/irV1';
import type { ExtractionReport } from '../../../report/extractionReport';
import { addFinding } from '../../../report/reportBuilder';
import { hashId } from '../../../util/id';
import { sourceRefForNode, toPosixPath } from './util';
import { ensurePackageHierarchy } from '../packageHierarchy';
import type { AddAngularRelation } from './routing';

function tag(key: string, value: string): IrTaggedValue {
  return { key, value };
}

function getDecoratorObjectLiteral(decorators: readonly ts.Decorator[] | undefined, name: string): ts.ObjectLiteralExpression | undefined {
  if (!decorators) return undefined;
  for (const d of decorators) {
    const expr = d.expression;
    if (!ts.isCallExpression(expr)) continue;
    if (!ts.isIdentifier(expr.expression) || expr.expression.text !== name) continue;
    const arg0 = expr.arguments[0];
    if (arg0 && ts.isObjectLiteralExpression(arg0)) return arg0;
  }
  return undefined;
}

function readObjProp(obj: ts.ObjectLiteralExpression, prop: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const pn = p.name;
    const key = ts.isIdentifier(pn) ? pn.text : ts.isStringLiteral(pn) ? pn.text : undefined;
    if (key === prop) return p.initializer;
  }
  return undefined;
}

function strLit(e: ts.Expression | undefined): string | undefined {
  if (!e) return undefined;
  const x = ts.isAsExpression(e) ? e.expression : e;
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return x.text;
  return undefined;
}

function tplLit(e: ts.Expression | undefined): string | undefined {
  if (!e) return undefined;
  const x = ts.isAsExpression(e) ? e.expression : e;
  if (ts.isNoSubstitutionTemplateLiteral(x)) return x.text;
  if (ts.isTemplateExpression(x)) return x.head.text + x.templateSpans.map((s) => '${...}' + s.literal.text).join('');
  return undefined;
}

function parseSelectorList(selector: string): string[] {
  return selector
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function extractDirectiveAttrNames(selector: string): string[] {
  // Very small subset: [attr], [attr=...], *ngIf style not here (handled in template scan)
  const out: string[] = [];
  for (const part of parseSelectorList(selector)) {
    const m = part.match(/^\[\s*([a-zA-Z_][\w-]*)/);
    if (m) out.push(m[1]);
  }
  return out;
}

function extractComponentElementNames(selector: string): string[] {
  const out: string[] = [];
  for (const part of parseSelectorList(selector)) {
    // element selector like app-foo
    if (/^[a-z][a-z0-9-]*$/.test(part)) out.push(part);
  }
  return out;
}

function ensureTemplateRef(model: { classifiers: IrClassifier[] }, sf: ts.SourceFile, node: ts.Node, projectRoot: string, refKind: string, refName: string): IrClassifier {
  const key = `angular:templateRef:${refKind}:${refName}`;
  const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
  const pkgDir = toPosixPath(path.dirname(relFile));
  const dirParts = pkgDir === '.' ? [] : pkgDir.split('/').filter(Boolean);
  const pkgId = ensurePackageHierarchy(model as any, ['angular', 'templateRef', refKind, ...dirParts], 'virtual');
  const id = hashId('c:', key);
  let c = model.classifiers.find((x) => x.id === id);
  if (c) return c;

  c = {
    id,
    kind: 'MODULE',
    name: `${refKind}:${refName}`,
    qualifiedName: key,
    packageId: pkgId,
    stereotypes: [{ name: 'AngularTemplateRef' }],
    taggedValues: [tag('framework', 'angular'), tag('origin', 'template'), tag('template.refKind', refKind), tag('template.refName', refName)],
    source: sourceRefForNode(sf, node, projectRoot),
  };
  model.classifiers.push(c);
  return c;
}

export type AngularTemplateIndex = {
  pipesByName: Map<string, IrClassifier>;
  componentsByElement: Map<string, IrClassifier>;
  directivesByAttr: Map<string, IrClassifier>;
};

export function buildAngularTemplateIndex(args: {
  program: ts.Program;
  projectRoot: string;
  scannedRel: string[];
  model: { classifiers: IrClassifier[] };
}): AngularTemplateIndex {
  const { program, projectRoot, scannedRel, model } = args;

  const idx: AngularTemplateIndex = {
    pipesByName: new Map(),
    componentsByElement: new Map(),
    directivesByAttr: new Map(),
  };

  for (const rel of scannedRel) {
    const abs = ts.sys.resolvePath(`${projectRoot}/${rel}`);
    const sf = program.getSourceFile(abs);
    if (!sf || sf.isDeclarationFile) continue;

    const visit = (n: ts.Node) => {
      if (ts.isClassDeclaration(n) && n.name) {
        const pipeObj = getDecoratorObjectLiteral(ts.getDecorators(n), 'Pipe');
        if (pipeObj) {
          const name = strLit(readObjProp(pipeObj, 'name')) ?? n.name.text;
          // Prefer existing classifier for the class name if available
          const cls = model.classifiers.find((c) => c.name === n.name!.text) ??
            ensureTemplateRef(model, sf, n, projectRoot, 'pipeClass', n.name.text);
          idx.pipesByName.set(name, cls);
        }

        const compObj = getDecoratorObjectLiteral(ts.getDecorators(n), 'Component');
        if (compObj) {
          const selector = strLit(readObjProp(compObj, 'selector'));
          if (selector) {
            const els = extractComponentElementNames(selector);
            const cls = model.classifiers.find((c) => c.name === n.name!.text) ??
              ensureTemplateRef(model, sf, n, projectRoot, 'componentClass', n.name.text);
            for (const el of els) idx.componentsByElement.set(el, cls);
            // Attribute selectors in component selectors are rare; ignore for now.
          }
        }

        const dirObj = getDecoratorObjectLiteral(ts.getDecorators(n), 'Directive');
        if (dirObj) {
          const selector = strLit(readObjProp(dirObj, 'selector'));
          if (selector) {
            const attrs = extractDirectiveAttrNames(selector);
            const cls = model.classifiers.find((c) => c.name === n.name!.text) ??
              ensureTemplateRef(model, sf, n, projectRoot, 'directiveClass', n.name.text);
            for (const a of attrs) idx.directivesByAttr.set(a, cls);
          }
        }
      }

      ts.forEachChild(n, visit);
    };

    visit(sf);
  }

  return idx;
}

function scanTemplateUsages(template: string): { pipes: string[]; elements: string[]; attrs: string[]; structural: string[] } {
  const pipes = new Set<string>();
  const elements = new Set<string>();
  const attrs = new Set<string>();
  const structural = new Set<string>();

  // Pipes: {{ x | myPipe : arg }}
  const pipeRe = /\|\s*([A-Za-z_][\w]*)/g;
  for (const m of template.matchAll(pipeRe)) pipes.add(m[1]);

  // Elements: <app-foo ...>
  const elRe = /<\s*([a-z][a-z0-9-]*)\b/g;
  for (const m of template.matchAll(elRe)) elements.add(m[1]);

  // Attribute binding: [appDir] or [appDir]="..."
  const attrRe = /\[\s*([A-Za-z_][\w-]*)\s*\]/g;
  for (const m of template.matchAll(attrRe)) attrs.add(m[1]);

  // Structural directive: *ngIf, *appX
  const structRe = /\*\s*([A-Za-z_][\w-]*)\s*=/g;
  for (const m of template.matchAll(structRe)) structural.add(m[1]);

  return { pipes: [...pipes], elements: [...elements], attrs: [...attrs], structural: [...structural] };
}

export function extractAngularTemplateEdges(args: {
  sf: ts.SourceFile;
  rel: string;
  projectRoot: string;
  node: ts.ClassDeclaration;
  c: IrClassifier;
  program: ts.Program;
  model: { classifiers: IrClassifier[] };
  addRelation: AddAngularRelation;
  index: AngularTemplateIndex;
  report?: ExtractionReport;
}) {
  const { sf, projectRoot, node, c, program, model, addRelation, index, report } = args;

  const compObj = getDecoratorObjectLiteral(ts.getDecorators(node), 'Component');
  if (!compObj) return;

  const tplInline = tplLit(readObjProp(compObj, 'template'));
  const tplUrl = strLit(readObjProp(compObj, 'templateUrl'));

  let tpl: string | undefined = tplInline;
  let tplSourceTag: IrTaggedValue[] = [];

  if (!tpl && tplUrl) {
    const absTpl = path.resolve(path.dirname(sf.fileName), tplUrl);
    if (fs.existsSync(absTpl)) {
      tpl = fs.readFileSync(absTpl, 'utf8');
      const relTpl = path.relative(projectRoot, absTpl).split(path.sep).join('/');
      tplSourceTag = [tag('template.file', relTpl)];
    } else if (report) {
      addFinding(report, {
        kind: 'note',
        severity: 'warning',
        message: `Component templateUrl not found: ${tplUrl}`,
        location: { file: sourceRefForNode(sf, node, projectRoot).file },
      });
    }
  } else if (tplInline) {
    tplSourceTag = [tag('template.inline', 'true')];
  }

  if (!tpl) return;

  const usages = scanTemplateUsages(tpl);

  const addUse = (target: IrClassifier, refKind: string, refName: string, n: ts.Node) => {
    addRelation(sf, 'DEPENDENCY' as IrRelationKind, c.id, target.id, n, [
      tag('origin', 'template'),
      tag('role', 'uses'),
      tag('template.refKind', refKind),
      tag('template.refName', refName),
      ...tplSourceTag,
    ]);
  };

  // Pipes
  for (const pName of usages.pipes) {
    const target = index.pipesByName.get(pName) ?? ensureTemplateRef(model, sf, node, projectRoot, 'pipe', pName);
    addUse(target, 'pipe', pName, node);
  }

  // Elements (component selectors)
  for (const el of usages.elements) {
    const target = index.componentsByElement.get(el) ?? ensureTemplateRef(model, sf, node, projectRoot, 'element', el);
    addUse(target, 'element', el, node);
  }

  // Attribute directives
  for (const a of usages.attrs) {
    const target = index.directivesByAttr.get(a) ?? ensureTemplateRef(model, sf, node, projectRoot, 'attr', a);
    addUse(target, 'attr', a, node);
  }

  // Structural directives: map as attr too (best-effort)
  for (const s of usages.structural) {
    const target = index.directivesByAttr.get(s) ?? ensureTemplateRef(model, sf, node, projectRoot, 'struct', s);
    addUse(target, 'struct', s, node);
  }
}