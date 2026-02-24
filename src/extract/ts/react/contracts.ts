import ts from 'typescript';
import path from 'node:path';

import { hashId } from '../../../util/id';
import type { IrClassifier, IrTaggedValue } from '../../../ir/irV1';
import { ensurePackageHierarchy } from '../packageHierarchy';
import type { ReactWorkContext } from './types';
import { toPosixPath, sourceRefForNode as reactSourceRefForNode } from './util';
import { safeNodeText } from '../util/safeText';

function tag(key: string, value: string): IrTaggedValue {
  return { key, value };
}

function ensureContract(rctx: ReactWorkContext, sf: ts.SourceFile, node: ts.Node, owner: IrClassifier, propsTypeText?: string, events?: { name: string; sig?: string }[]): IrClassifier {
  const relFile = toPosixPath(path.relative(rctx.projectRoot, sf.fileName));
  // Place React contracts in a virtual hierarchical package chain:
  // react / contract / <dir...>
  const dir = toPosixPath(path.dirname(relFile));
  const dirParts = dir === '.' || dir === '' ? [] : dir.split('/');
  const virtualPkgId = ensurePackageHierarchy(rctx.model as any, ['react', 'contract', ...dirParts], 'virtual');

  const key = `react:contract:${relFile}::${owner.name}`;
  const id = hashId('c:', key);

  let c = rctx.model.classifiers.find((x) => x.id === id);
  if (c) return c;

  c = {
    id,
    kind: 'MODULE',
    name: `${owner.name}Contract`,
    qualifiedName: key,
    packageId: virtualPkgId,
    stereotypes: [{ name: 'ReactContract' }],
    taggedValues: [
      tag('framework', 'react'),
      tag('origin', 'contract'),
      ...(propsTypeText ? [tag('react.propsType', propsTypeText)] : []),
      ...(events && events.length > 0 ? [tag('react.events', JSON.stringify(events))] : []),
    ],
    source: reactSourceRefForNode(sf, node, rctx.projectRoot),
  };
  rctx.model.classifiers.push(c);
  return c;
}

function getPropsTypeTextFromParam(param: ts.ParameterDeclaration): string | undefined {
  if (!param.type) return undefined;
  return safeNodeText(param.type);
}

function getPropsTypeFromVarDeclType(type: ts.TypeNode | undefined): string | undefined {
  if (!type) return undefined;
  // React.FC<Props> or FC<Props>
  if (ts.isTypeReferenceNode(type) && type.typeArguments && type.typeArguments.length > 0) {
    const tname = type.typeName;
    const tn = ts.isIdentifier(tname) ? tname.text : ts.isQualifiedName(tname) ? tname.right.text : '';
    if (tn === 'FC' || tn === 'FunctionComponent' || tn === 'ComponentType' || tn === 'Component') {
      return safeNodeText(type.typeArguments[0]);
    }
  }
  return undefined;
}

function extractEventsFromPropsType(checker: ts.TypeChecker, propsTypeNode: ts.TypeNode): { name: string; sig?: string }[] {
  const out: { name: string; sig?: string }[] = [];
  const t = checker.getTypeFromTypeNode(propsTypeNode);
  for (const prop of t.getProperties()) {
    const name = prop.getName();
    if (!/^on[A-Z].*/.test(name)) continue;
    const decl = prop.valueDeclaration ?? prop.declarations?.[0];
    if (decl && ts.isPropertySignature(decl) && decl.type) {
      // best-effort stringify of function type
      const sig = safeNodeText(decl.type);
      out.push({ name, sig });
    } else {
      out.push({ name });
    }
  }
  // stable sort
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function addRelation(rctx: ReactWorkContext, sf: ts.SourceFile, from: IrClassifier, to: IrClassifier, node: ts.Node, tags: IrTaggedValue[]) {
  rctx.model.relations = rctx.model.relations ?? [];
  const relFile = toPosixPath(path.relative(rctx.projectRoot, sf.fileName));
  const id = hashId('r:', `CONTRACT:${relFile}:${from.id}->${to.id}:${node.pos}`);
  if (rctx.model.relations.some((r) => r.id === id)) return;

  rctx.model.relations.push({
    id,
    kind: 'DEPENDENCY',
    sourceId: from.id,
    targetId: to.id,
    taggedValues: tags,
    stereotypes: [],
    source: rctx.sourceRefForNode(sf, node),
  });
}

export function addReactContractEdges(rctx: ReactWorkContext, ownerByNode: Map<ts.Node, string>) {
  if (rctx.includeFrameworkEdges === false) return;

  const checker = rctx.program.getTypeChecker();

  for (const rel of rctx.scannedRel) {
    const abs = path.join(rctx.projectRoot, rel);
    const sf = rctx.program.getSourceFile(abs);
    if (!sf || sf.isDeclarationFile) continue;

    const relFile = toPosixPath(path.relative(rctx.projectRoot, sf.fileName));

    // Map ownerName -> (node, propsTypeNode?) discovered in this file
    const ownerDecls: Array<{ ownerName: string; node: ts.Node; propsTypeText?: string; propsTypeNode?: ts.TypeNode }> = [];

    const visit = (n: ts.Node) => {
      // function Component(props: Props) { ... }
      if (ts.isFunctionDeclaration(n) && n.name && n.parameters.length > 0) {
        const ownerName = n.name.text;
        const param0 = n.parameters[0];
        const propsTypeText = getPropsTypeTextFromParam(param0);
        ownerDecls.push({ ownerName, node: n, propsTypeText, propsTypeNode: param0.type });
      }

      // const Component: React.FC<Props> = (...) => ...
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.type) {
        const ownerName = n.name.text;
        const propsTypeText = getPropsTypeFromVarDeclType(n.type);
        ownerDecls.push({ ownerName, node: n, propsTypeText, propsTypeNode: undefined });
      }

      // const Component = (props: Props) => ...
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        const ownerName = n.name.text;
        const init = n.initializer;
        if (ts.isArrowFunction(init) && init.parameters.length > 0) {
          const propsTypeText = getPropsTypeTextFromParam(init.parameters[0]);
          ownerDecls.push({ ownerName, node: init, propsTypeText, propsTypeNode: init.parameters[0].type });
        } else if (ts.isFunctionExpression(init) && init.parameters.length > 0) {
          const propsTypeText = getPropsTypeTextFromParam(init.parameters[0]);
          ownerDecls.push({ ownerName, node: init, propsTypeText, propsTypeNode: init.parameters[0].type });
        }
      }

      ts.forEachChild(n, visit);
    };

    visit(sf);

    for (const d of ownerDecls) {
      const owner = rctx.classifierByFileAndName.get(`${relFile}::${d.ownerName}`);
      if (!owner) continue;

      let events: { name: string; sig?: string }[] | undefined;
      if (d.propsTypeNode) {
        events = extractEventsFromPropsType(checker, d.propsTypeNode);
      }

      const contract = ensureContract(rctx, sf, d.node, owner, d.propsTypeText, events);

      addRelation(rctx, sf, owner, contract, d.node, [
        tag('origin', 'contract'),
        tag('role', 'exposes'),
        ...(d.propsTypeText ? [tag('react.propsType', d.propsTypeText)] : []),
      ]);
    }
  }
}
