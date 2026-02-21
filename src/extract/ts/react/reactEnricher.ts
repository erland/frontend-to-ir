import ts from 'typescript';
import path from 'node:path';
import { IrClassifier, IrModel, IrRelation, IrSourceRef, IrTypeRef } from '../../../ir/irV1';
import type { ExtractionReport } from '../../../report/extractionReport';
import { addFinding } from '../../../report/reportBuilder';
import { typeNodeToIrTypeRef } from '../typeRef';
import { hashId } from '../../../util/id';

function toPosixPath(p: string): string {
  return p.split(path.sep).join('/');
}

function sourceRefForNode(sf: ts.SourceFile, node: ts.Node, projectRoot: string): IrSourceRef {
  const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
  const lc = ts.getLineAndCharacterOfPosition(sf, node.getStart(sf, false));
  return { file: rel, line: lc.line + 1 };
}

export type ReactEnrichContext = {
  program: ts.Program;
  checker: ts.TypeChecker;
  projectRoot: string;
  scannedRel: string[];
  model: IrModel;
  report?: ExtractionReport;
  includeFrameworkEdges?: boolean;
};

export function enrichReactModel(ctx: ReactEnrichContext) {
  const { program, projectRoot, scannedRel, model, report, includeFrameworkEdges } = ctx;

  const classifierByFileAndName = new Map<string, IrClassifier>();
  for (const c of model.classifiers) {
    const file = c.source?.file;
    if (!file) continue;
    classifierByFileAndName.set(`${file}::${c.name}`, c);
  }

  const checker = program.getTypeChecker();

  const isPascalCase = (s: string) => /^[A-Z][A-Za-z0-9_]*$/.test(s);
  const hasStereotype = (c: IrClassifier, name: string) => (c.stereotypes ?? []).some((st) => st.name === name);
  const addStereo = (c: IrClassifier, name: string) => {
    c.stereotypes = c.stereotypes ?? [];
    if (!hasStereotype(c, name)) c.stereotypes.push({ name });
  };
  const setTag = (c: IrClassifier, key: string, value: string) => {
    c.taggedValues = c.taggedValues ?? [];
    const existing = c.taggedValues.find((tv) => tv.key === key);
    if (existing) existing.value = value;
    else c.taggedValues.push({ key, value });
  };

  // React Context helpers
  const hasContextStereo = (c: IrClassifier) => (c.stereotypes ?? []).some((st) => st.name === 'ReactContext');
  const ensureContextClassifier = (sf: ts.SourceFile, node: ts.Node, name: string, typeNode?: ts.TypeNode | null) => {
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const pkgDir = toPosixPath(path.dirname(relFile));
    const pkgKey = pkgDir === '.' ? '' : pkgDir;
    const pkgId = hashId('pkg:', pkgKey === '' ? '(root)' : pkgKey);

    const key = `${relFile}::${name}`;
    let c = classifierByFileAndName.get(key);
    if (!c) {
      const existing = model.classifiers.filter((x) => x.name === name && hasContextStereo(x));
      if (existing.length === 1) c = existing[0];
    }

    if (!c) {
      const id = hashId('c:', `REACT_CONTEXT:${relFile}:${name}`);
      c = {
        id,
        name,
        qualifiedName: name,
        packageId: pkgId,
        kind: 'SERVICE',
        source: sourceRefForNode(sf, node, projectRoot),
        attributes: [],
        operations: [],
        stereotypes: [],
        taggedValues: [],
      };
      model.classifiers.push(c);
      classifierByFileAndName.set(key, c);
    }

    c.kind = 'SERVICE';
    addStereo(c, 'ReactContext');
    setTag(c, 'framework', 'react');
    if (typeNode) setTag(c, 'react.contextType', typeNode.getText(sf));
    return c;
  };

const upsertAttr = (c: IrClassifier, name: string, type: IrTypeRef, role: 'props' | 'state') => {
  c.attributes = c.attributes ?? [];
  let a = c.attributes.find((x) => x.name === name);
  if (!a) {
    a = { name, type, taggedValues: [] };
    c.attributes.push(a);
  } else {
    a.type = type;
  }
  a.taggedValues = a.taggedValues ?? [];
  const existing = a.taggedValues.find((tv) => tv.key === 'react.role');
  if (existing) existing.value = role;
  else a.taggedValues.push({ key: 'react.role', value: role });
};

const applyReactPropsState = (
  c: IrClassifier,
  sf: ts.SourceFile,
  propsTypeNode?: ts.TypeNode | null,
  stateTypeNode?: ts.TypeNode | null,
) => {
  if (propsTypeNode) {
    const propsType = typeNodeToIrTypeRef(propsTypeNode, checker);
    upsertAttr(c, 'props', propsType, 'props');
    setTag(c, 'react.propsType', propsTypeNode.getText(sf));
  }
  if (stateTypeNode) {
    const stateType = typeNodeToIrTypeRef(stateTypeNode, checker);
    upsertAttr(c, 'state', stateType, 'state');
    setTag(c, 'react.stateType', stateTypeNode.getText(sf));
  }
};

const isReactFctype = (tn: ts.TypeNode, sf: ts.SourceFile): ts.TypeNode | null => {
  if (!ts.isTypeReferenceNode(tn)) return null;
  const typeName = tn.typeName.getText(sf);
  const isFc =
    typeName === 'React.FC' ||
    typeName === 'FC' ||
    typeName === 'React.FunctionComponent' ||
    typeName === 'FunctionComponent' ||
    typeName.endsWith('.FC') ||
    typeName.endsWith('.FunctionComponent');
  if (!isFc) return null;
  const args = tn.typeArguments ?? [];
  return args.length >= 1 ? args[0] : null;
};
  const ensureComponentClassifier = (sf: ts.SourceFile, node: ts.Node, name: string): IrClassifier => {
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const key = `${relFile}::${name}`;
    let c = classifierByFileAndName.get(key);

    const pkgDir = toPosixPath(path.dirname(relFile));
    const pkgKey = pkgDir === '.' ? '' : pkgDir;
    const pkgId = hashId('pkg:', pkgKey === '' ? '(root)' : pkgKey);

    if (!c) {
      const qn = name;
      const id = hashId('c:', `COMPONENT:${relFile}:${qn}`);
      c = {
        id,
        name,
        qualifiedName: qn,
        packageId: pkgId,
        kind: 'COMPONENT',
        source: sourceRefForNode(sf, node, projectRoot),
        attributes: [],
        operations: [],
        stereotypes: [],
        taggedValues: [],
      };
      model.classifiers.push(c);
      classifierByFileAndName.set(key, c);
    }

    c.kind = 'COMPONENT';
    addStereo(c, 'ReactComponent');
    setTag(c, 'framework', 'react');
    return c;
  };

  // 1) Detect components
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
    if (!scannedRel.includes(rel)) continue;

    const visit = (node: ts.Node) => {
      // const Ctx = React.createContext<T>(...) / createContext<T>(...)
      if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (!ts.isIdentifier(d.name)) continue;
          const nm = d.name.text;
          const init = d.initializer;
          if (!init || !ts.isCallExpression(init)) continue;

          const callee = init.expression;
          const calleeName = ts.isIdentifier(callee)
            ? callee.text
            : ts.isPropertyAccessExpression(callee)
              ? callee.name.text
              : undefined;

          if (calleeName !== 'createContext') continue;
          const typeArg = init.typeArguments?.[0] ?? null;
          ensureContextClassifier(sf, d, nm, typeArg);
        }
      }

      // class Foo extends React.Component / Component
      if (ts.isClassDeclaration(node) && node.name?.text && isPascalCase(node.name.text)) {
        const extendsClause = (node.heritageClauses ?? []).find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
        const t = extendsClause?.types?.[0];
        if (t) {
          const txt = t.expression.getText(sf);
          if (txt === 'React.Component' || txt === 'Component' || txt.endsWith('.Component')) {
            const c = ensureComponentClassifier(sf, node, node.name.text);
            setTag(c, 'react.componentKind', 'class');
            applyReactPropsState(c, sf, t.typeArguments?.[0] ?? null, t.typeArguments?.[1] ?? null);
          }
        }
      }

      // function Foo() { return <div/> }
      if (ts.isFunctionDeclaration(node) && node.name?.text && isPascalCase(node.name.text)) {
        if (functionLikeReturnsJsx(node, sf)) {
          const c = ensureComponentClassifier(sf, node, node.name.text);
          setTag(c, 'react.componentKind', 'function');
          applyReactPropsState(c, sf, node.parameters[0]?.type ?? null, null);
        }
      }

      // const Foo = () => <div/> or function() { return <div/> }
      if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (!ts.isIdentifier(d.name)) continue;
          const nm = d.name.text;
          if (!isPascalCase(nm)) continue;
          const init = d.initializer;
          if (!init) continue;
          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
            if (functionLikeReturnsJsx(init, sf)) {
              const c = ensureComponentClassifier(sf, d, nm);
              setTag(c, 'react.componentKind', 'function');
              applyReactPropsState(c, sf, init.parameters[0]?.type ?? null, null);
              if (d.type) {
                const fcArg = isReactFctype(d.type, sf);
                if (fcArg) applyReactPropsState(c, sf, fcArg, null);
              }
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sf);
  }

  const componentIdByName = new Map<string, string>();
  for (const c of model.classifiers) {
    if (c.kind === 'COMPONENT') componentIdByName.set(c.name, c.id);
  }
  if (!componentIdByName.size) return;

  const contextIdByName = new Map<string, string>();
  for (const c of model.classifiers) {
    if (hasContextStereo(c)) contextIdByName.set(c.name, c.id);
  }

  const existingKeys = new Set<string>();
  for (const r of model.relations ?? []) existingKeys.add(`RENDER:${r.sourceId}:${r.targetId}`);

  const existingDiKeys = new Set<string>();
  for (const r of model.relations ?? []) {
    if (r.kind === 'DI') {
      const origin = (r.taggedValues ?? []).find((tv) => tv.key === 'origin')?.value ?? '';
      existingDiKeys.add(`DI:${r.sourceId}:${r.targetId}:${origin}`);
    }
  }

  const addDi = (sf: ts.SourceFile, fromId: string, toId: string, node: ts.Node, origin: string) => {
    if (includeFrameworkEdges === false) return;
    if (fromId === toId) return;
    const key = `DI:${fromId}:${toId}:${origin}`;
    if (existingDiKeys.has(key)) return;
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const id = hashId('r:', `DI:${relFile}:${fromId}->${toId}:${origin}:${node.pos}`);
    (model.relations ?? (model.relations = [])).push({
      id,
      kind: 'DI',
      sourceId: fromId,
      targetId: toId,
      taggedValues: [{ key: 'origin', value: origin }],
      stereotypes: [],
      source: sourceRefForNode(sf, node, projectRoot),
    });
    existingDiKeys.add(key);
  };

  const addRender = (sf: ts.SourceFile, fromId: string, toId: string, node: ts.Node) => {
    if (includeFrameworkEdges === false) return;
    if (fromId === toId) return;
    const key = `RENDER:${fromId}:${toId}`;
    if (existingKeys.has(key)) return;
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const id = hashId('r:', `RENDER:${relFile}:${fromId}->${toId}:${node.pos}`);
    (model.relations ?? (model.relations = [])).push({
      id,
      kind: 'RENDER',
      sourceId: fromId,
      targetId: toId,
      taggedValues: [{ key: 'origin', value: 'jsx' }],
      stereotypes: [],
      source: sourceRefForNode(sf, node, projectRoot),
    });
    existingKeys.add(key);
  };

  const scanJsx = (sf: ts.SourceFile, root: ts.Node, ownerName: string) => {
    const fromId = componentIdByName.get(ownerName);
    if (!fromId) return;

    const visit = (n: ts.Node) => {
      if (ts.isJsxSelfClosingElement(n)) {
        const tag = jsxTagNameToString(n.tagName);
        const toId = tag ? componentIdByName.get(tag) : undefined;
        if (toId) addRender(sf, fromId, toId, n);
        else if (report && tag && isPascalCase(tag)) {
          addFinding(report, {
            kind: 'unresolvedJsxComponent',
            severity: 'warning',
            message: `JSX renders '${tag}' but no matching component classifier was found`,
            location: { file: toPosixPath(path.relative(projectRoot, sf.fileName)) },
            tags: { owner: ownerName, tag },
          });
        }

        // <Ctx.Provider />
        if (ts.isPropertyAccessExpression(n.tagName) && n.tagName.name.text === 'Provider') {
          const ctxExpr = n.tagName.expression;
          if (ts.isIdentifier(ctxExpr)) {
            const ctxName = ctxExpr.text;
            const ctxId = contextIdByName.get(ctxName);
            if (ctxId) addDi(sf, fromId, ctxId, n, 'provider');
            else if (report) {
              addFinding(report, {
                kind: 'unresolvedContext',
                severity: 'warning',
                message: `JSX Provider for '${ctxName}' but no matching context classifier was found`,
                location: { file: toPosixPath(path.relative(projectRoot, sf.fileName)) },
                tags: { owner: ownerName, context: ctxName, origin: 'provider' },
              });
            }
          }
        }
      } else if (ts.isJsxOpeningElement(n)) {
        const tag = jsxTagNameToString(n.tagName);
        const toId = tag ? componentIdByName.get(tag) : undefined;
        if (toId) addRender(sf, fromId, toId, n);
        else if (report && tag && isPascalCase(tag)) {
          addFinding(report, {
            kind: 'unresolvedJsxComponent',
            severity: 'warning',
            message: `JSX renders '${tag}' but no matching component classifier was found`,
            location: { file: toPosixPath(path.relative(projectRoot, sf.fileName)) },
            tags: { owner: ownerName, tag },
          });
        }

        // <Ctx.Provider>
        if (ts.isPropertyAccessExpression(n.tagName) && n.tagName.name.text === 'Provider') {
          const ctxExpr = n.tagName.expression;
          if (ts.isIdentifier(ctxExpr)) {
            const ctxName = ctxExpr.text;
            const ctxId = contextIdByName.get(ctxName);
            if (ctxId) addDi(sf, fromId, ctxId, n, 'provider');
            else if (report) {
              addFinding(report, {
                kind: 'unresolvedContext',
                severity: 'warning',
                message: `JSX Provider for '${ctxName}' but no matching context classifier was found`,
                location: { file: toPosixPath(path.relative(projectRoot, sf.fileName)) },
                tags: { owner: ownerName, context: ctxName, origin: 'provider' },
              });
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(root);
  };

  const scanUseContext = (sf: ts.SourceFile, root: ts.Node, ownerName: string) => {
    const fromId = componentIdByName.get(ownerName);
    if (!fromId) return;

    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const calleeName = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : undefined;

        if (calleeName === 'useContext') {
          const arg0 = n.arguments[0];
          if (arg0) {
            let ctxName: string | undefined;
            if (ts.isIdentifier(arg0)) ctxName = arg0.text;
            else if (ts.isPropertyAccessExpression(arg0)) ctxName = arg0.name.text;

            if (ctxName) {
              const ctxId = contextIdByName.get(ctxName);
              if (ctxId) addDi(sf, fromId, ctxId, n, 'useContext');
              else if (report) {
                addFinding(report, {
                  kind: 'unresolvedContext',
                  severity: 'warning',
                  message: `useContext('${ctxName}') but no matching context classifier was found`,
                  location: { file: toPosixPath(path.relative(projectRoot, sf.fileName)) },
                  tags: { owner: ownerName, context: ctxName, origin: 'useContext' },
                });
              }
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };

    visit(root);
  };

  // 2) Add RENDER edges
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
    if (!scannedRel.includes(rel)) continue;

    sf.forEachChild((node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text && componentIdByName.has(node.name.text)) {
        scanJsx(sf, node, node.name.text);
        scanUseContext(sf, node, node.name.text);
      }
      if (ts.isClassDeclaration(node) && node.name?.text && componentIdByName.has(node.name.text)) {
        scanJsx(sf, node, node.name.text);
        scanUseContext(sf, node, node.name.text);
      }
      if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (!ts.isIdentifier(d.name)) continue;
          const nm = d.name.text;
          const init = d.initializer;
          if (!init) continue;
          if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && componentIdByName.has(nm)) {
            scanJsx(sf, init, nm);
            scanUseContext(sf, init, nm);
          }
        }
      }
    });
  }
}

function functionLikeReturnsJsx(fn: ts.SignatureDeclarationBase, sf: ts.SourceFile): boolean {
  const anyFn: any = fn as any;

  const unwrap = (expr: ts.Expression): ts.Expression => {
    let e: ts.Expression = expr;
    // ParenthesizedExpression exists in TS 5+; in older versions it's a syntax kind wrapper too.
    // Use the public type guard when available.
    while ((ts as any).isParenthesizedExpression?.(e) || e.kind === ts.SyntaxKind.ParenthesizedExpression) {
      e = (e as any).expression as ts.Expression;
      if (!e) break;
    }
    return e;
  };

  const isJsxExpr = (expr: ts.Expression): boolean => {
    const e = unwrap(expr);
    return ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e);
  };

  // Expression-bodied arrow function
  if (anyFn.body && ts.isExpression(anyFn.body) && isJsxExpr(anyFn.body)) {
    return true;
  }

  const body = anyFn.body;
  if (!body || !ts.isBlock(body)) return false;

  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isReturnStatement(n) && n.expression && isJsxExpr(n.expression)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return found;
}

function jsxTagNameToString(tag: ts.JsxTagNameExpression): string | null {
  return ts.isIdentifier(tag) ? tag.text : null;
}

