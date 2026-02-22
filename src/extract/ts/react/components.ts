import ts from 'typescript';
import { safeNodeText } from '../util/safeText';
import path from 'node:path';
import type { IrClassifier } from '../../../ir/irV1';
import { hashId } from '../../../util/id';
import type { ReactWorkContext } from './types';
import { functionLikeReturnsJsx, toPosixPath } from './util';
import { applyReactPropsState, isReactFcType } from './propsState';

function ensureComponentClassifier(rctx: ReactWorkContext, sf: ts.SourceFile, node: ts.Node, name: string): IrClassifier {
  const { projectRoot, model, classifierByFileAndName } = rctx;
  const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
  const key = `${relFile}::${name}`;
  let c = classifierByFileAndName.get(key);
  if (!c) {
    const pkgDir = toPosixPath(path.dirname(relFile));
    const pkgKey = pkgDir === '.' ? '' : pkgDir;
    const pkgId = hashId('pkg:', pkgKey === '' ? '(root)' : pkgKey);
    const id = hashId('c:', `COMPONENT:${relFile}:${name}`);
    c = {
      id,
      name,
      qualifiedName: name,
      packageId: pkgId,
      kind: 'FUNCTION',
      source: rctx.sourceRefForNode(sf, node),
      attributes: [],
      operations: [],
      stereotypes: [],
      taggedValues: [],
    };
    model.classifiers.push(c);
    classifierByFileAndName.set(key, c);
  }

  c.kind = 'COMPONENT';
  rctx.addStereotype(c, 'ReactComponent');
  rctx.setClassifierTag(c, 'framework', 'react');
  return c;
}

function markOwner(ownerByNode: Map<ts.Node, string>, root: ts.Node, ownerName: string) {
  const visit = (n: ts.Node) => {
    ownerByNode.set(n, ownerName);
    ts.forEachChild(n, visit);
  };
  visit(root);
}

function isReactComponentBase(heritage: ts.ExpressionWithTypeArguments, sf: ts.SourceFile): { props?: ts.TypeNode; state?: ts.TypeNode } | null {
  const exprText = safeNodeText(heritage.expression, sf);
  const isBase = exprText === 'React.Component' || exprText === 'Component' || exprText === 'React.PureComponent' || exprText === 'PureComponent';
  if (!isBase) return null;
  const args = heritage.typeArguments ?? [];
  return { props: args[0], state: args[1] };
}

export function detectReactComponents(rctx: ReactWorkContext): { ownerByNode: Map<ts.Node, string> } {
  const { program, projectRoot, scannedRel } = rctx;
  const ownerByNode = new Map<ts.Node, string>();

  for (const rel of scannedRel) {
    const abs = path.join(projectRoot, rel);
    const sf = program.getSourceFile(abs);
    if (!sf) continue;

    // function Foo() { return <JSX/> }
    sf.forEachChild((node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text) {
        if (functionLikeReturnsJsx(node, sf)) {
          const c = ensureComponentClassifier(rctx, sf, node, node.name.text);
          rctx.setClassifierTag(c, 'react.componentKind', 'function');
          applyReactPropsState(rctx, c, sf, node.parameters[0]?.type ?? null, null);
          markOwner(ownerByNode, node, c.name);
        }
      }

      // class Foo extends React.Component<P,S>
      if (ts.isClassDeclaration(node) && node.name?.text) {
        const hs = node.heritageClauses ?? [];
        const ext = hs.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
        if (ext?.types?.length) {
          const base = isReactComponentBase(ext.types[0], sf);
          if (base) {
            const c = ensureComponentClassifier(rctx, sf, node, node.name.text);
            rctx.setClassifierTag(c, 'react.componentKind', 'class');
            applyReactPropsState(rctx, c, sf, base.props ?? null, base.state ?? null);
            markOwner(ownerByNode, node, c.name);
          }
        }
      }

      // const Foo = () => <JSX/>  OR const Foo: React.FC<P> = ...
      if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (!ts.isIdentifier(d.name)) continue;
          const nm = d.name.text;
          if (!rctx.isPascalCase(nm)) continue;
          const init = d.initializer;
          if (!init) continue;

          let isComponent = false;
          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
            if (functionLikeReturnsJsx(init, sf)) isComponent = true;
          }

          // typed const: React.FC<P>
          let propsType: ts.TypeNode | null = null;
          if (d.type) {
            const maybe = isReactFcType(d.type, sf);
            if (maybe) {
              propsType = maybe;
              isComponent = true;
            }
          }

          if (isComponent) {
            const c = ensureComponentClassifier(rctx, sf, d, nm);
            rctx.setClassifierTag(c, 'react.componentKind', ts.isClassDeclaration(node) ? 'class' : 'function');
            // props from first param if present
            const p0 = (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init.parameters[0]?.type ?? null : null;
            applyReactPropsState(rctx, c, sf, propsType ?? p0, null);
            markOwner(ownerByNode, d, c.name);
            if (init) markOwner(ownerByNode, init, c.name);
          }
        }
      }
    });
  }

  return { ownerByNode };
}
