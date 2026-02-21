import ts from 'typescript';
import path from 'node:path';
import type { IrModel, IrSourceRef, IrClassifier, IrRelation, IrAttribute, IrTypeRef, IrTaggedValue, IrRelationKind } from '../../../ir/irV1';
import type { ExtractionReport } from '../../../report/extractionReport';
import { addFinding } from '../../../report/reportBuilder';
import { hashId } from '../../../util/id';
import { typeNodeToIrTypeRef } from '../typeRef';
import type { ExtractorContext } from '../context';

function toPosixPath(p: string): string {
  return p.split(path.sep).join('/');
}

function sourceRefForNode(sf: ts.SourceFile, node: ts.Node, projectRoot: string): IrSourceRef {
  const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
  const lc = ts.getLineAndCharacterOfPosition(sf, node.getStart(sf, false));
  return { file: rel, line: lc.line + 1 };
}

export function enrichAngularModel(ctx: ExtractorContext) {

  const { program, projectRoot, scannedRel, model, report } = ctx;
  const checker = ctx.checker;
  const includeFrameworkEdges = ctx.includeFrameworkEdges;
  const includeDeps = ctx.includeDeps;

  const classifierByName = new Map<string, IrClassifier>();
  for (const c of model.classifiers) classifierByName.set(c.name, c);

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

  const existingKeys = new Set<string>();
  for (const r of model.relations ?? []) {
    const role = (r.taggedValues ?? []).find((tv: IrTaggedValue) => tv.key === 'role')?.value ?? '';
    existingKeys.add(`${r.kind}:${r.sourceId}:${r.targetId}:${role}`);
  }

  const addRelation = (
    sf: ts.SourceFile,
    kind: IrRelationKind,
    fromId: string,
    toId: string,
    node: ts.Node,
    tags: IrTaggedValue[],
  ) => {
    if (includeFrameworkEdges === false) return;
    const role = tags.find((t) => t.key === 'role')?.value ?? '';
    const key = `${kind}:${fromId}:${toId}:${role}`;
    if (existingKeys.has(key)) return;
    const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
    const id = hashId('r:', `${kind}:${relFile}:${fromId}->${toId}:${role}:${node.pos}`);
    (model.relations ?? (model.relations = [])).push({
      id,
      kind,
      sourceId: fromId,
      targetId: toId,
      taggedValues: tags,
      stereotypes: [],
      source: sourceRefForNode(sf, node, projectRoot),
    });
    existingKeys.add(key);
  };

  const getDecorators = (node: ts.Node): ts.Decorator[] => {
    const anyTs: any = ts as any;
    if (typeof anyTs.getDecorators === 'function') return anyTs.getDecorators(node) ?? [];
    return (node as any).decorators ?? [];
  };

  const decoratorCallName = (d: ts.Decorator, sf: ts.SourceFile): string | undefined => {
    const expr = d.expression;
    if (ts.isCallExpression(expr)) {
      const callee = expr.expression;
      if (ts.isIdentifier(callee)) return callee.text;
      if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
      return callee.getText(sf);
    }
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
    return undefined;
  };

  const getDecoratorArgObject = (d: ts.Decorator): ts.ObjectLiteralExpression | undefined => {
    const expr = d.expression;
    if (!ts.isCallExpression(expr)) return undefined;
    const arg0 = expr.arguments[0];
    return arg0 && ts.isObjectLiteralExpression(arg0) ? arg0 : undefined;
  };

  const readStringProp = (obj: ts.ObjectLiteralExpression, name: string, sf: ts.SourceFile): string | undefined => {
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const pn = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
      if (pn !== name) continue;
      const init = p.initializer;
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return init.text;
      return init.getText(sf);
    }
    return undefined;
  };

  const readArrayIdentifiers = (obj: ts.ObjectLiteralExpression, name: string): string[] => {
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const pn = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
      if (pn !== name) continue;
      const init = p.initializer;
      if (!ts.isArrayLiteralExpression(init)) return [];
      const out: string[] = [];
      for (const e of init.elements) {
        if (ts.isIdentifier(e)) out.push(e.text);
        else if (ts.isPropertyAccessExpression(e)) out.push(e.name.text);
      }
      return out;
    }
    return [];
  };

  const getTypeNameFromParam = (p: ts.ParameterDeclaration): string | undefined => {
    const t = p.type ? checker.getTypeFromTypeNode(p.type) : checker.getTypeAtLocation(p);
    const sym = t.getSymbol() ?? (t as any).aliasSymbol;
    const n = sym?.getName();
    return n && n !== '__type' ? n : undefined;
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = toPosixPath(path.relative(projectRoot, sf.fileName));
    if (!scannedRel.includes(rel)) continue;

    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node) && node.name?.text) {
        const c = classifierByName.get(node.name.text);
        if (!c) {
          ts.forEachChild(node, visit);
          return;
        }

        const decorators = getDecorators(node);
        if (!decorators.length) {
          ts.forEachChild(node, visit);
          return;
        }

        const decNames = decorators.map((d) => decoratorCallName(d, sf)).filter(Boolean) as string[];
        const isComponent = decNames.includes('Component');
        const isInjectable = decNames.includes('Injectable');
        const isNgModule = decNames.includes('NgModule');

        if (isComponent || isInjectable || isNgModule) setTag(c, 'framework', 'angular');

        if (isComponent) {
          c.kind = 'COMPONENT';
          addStereo(c, 'AngularComponent');
          setTag(c, 'angular.decorator', 'Component');
          const d = decorators.find((dd) => decoratorCallName(dd, sf) === 'Component');
          const obj = d ? getDecoratorArgObject(d) : undefined;
          if (obj) {
            const selector = readStringProp(obj, 'selector', sf);
            const templateUrl = readStringProp(obj, 'templateUrl', sf);
            if (selector) setTag(c, 'angular.selector', selector);
            if (templateUrl) setTag(c, 'angular.templateUrl', templateUrl);
          }
        }

        if (isInjectable) {
          c.kind = 'SERVICE';
          addStereo(c, 'AngularInjectable');
          setTag(c, 'angular.decorator', 'Injectable');
        }

        if (isNgModule) {
          c.kind = 'MODULE';
          addStereo(c, 'AngularNgModule');
          setTag(c, 'angular.decorator', 'NgModule');
          const d = decorators.find((dd) => decoratorCallName(dd, sf) === 'NgModule');
          const obj = d ? getDecoratorArgObject(d) : undefined;
          if (obj) {
            for (const role of ['imports', 'providers', 'declarations'] as const) {
              const names = readArrayIdentifiers(obj, role);
              for (const nm of names) {
                const to = classifierByName.get(nm);
                if (to) {
                  addRelation(sf, 'DEPENDENCY', c.id, to.id, node, [
                    { key: 'origin', value: 'ngmodule' },
                    { key: 'role', value: role },
                  ]);
                }
                else if (report) {
                  addFinding(report, {
                    kind: 'unresolvedDecoratorRef',
                    severity: 'warning',
                    message: `NgModule ${role} references '${nm}' but it was not found as a classifier`,
                    location: { file: rel },
                    tags: { owner: c.name, role, ref: nm },
                  });
                }
              }
            }
          }
        }

        // Step 11: Inputs/Outputs extraction (component API)
        if (isComponent) {
          const ensureAttr = (name: string, typeRef: IrTypeRef, sourceNode: ts.Node): IrAttribute => {
            c.attributes = c.attributes ?? [];
            const existing = c.attributes.find((a) => a.name === name);
            if (existing) return existing;
            const id = hashId('a:', `${c.id}:${name}:${rel}:${sourceNode.pos}`);
            const attr: IrAttribute = {
              id,
              name,
              type: typeRef,
              source: sourceRefForNode(sf, sourceNode, projectRoot),
            };
            c.attributes.push(attr);
            return attr;
          };

          const setAttrTag = (a: IrAttribute, key: string, value: string) => {
            a.taggedValues = a.taggedValues ?? [];
            const tv = a.taggedValues.find((t) => t.key === key);
            if (tv) tv.value = value;
            else a.taggedValues.push({ key, value });
          };

          const decoratorArgString0 = (d: ts.Decorator): string | undefined => {
            const expr = d.expression;
            if (!ts.isCallExpression(expr)) return undefined;
            const a0 = expr.arguments[0];
            if (a0 && (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0))) return a0.text;
            return undefined;
          };

          const extractEventEmitterPayloadName = (member: ts.ClassElement): string | undefined => {
            // Prefer explicit type annotation: EventEmitter<T>
            const anyMember: any = member as any;
            if (anyMember.type && ts.isTypeReferenceNode(anyMember.type)) {
              const tr = anyMember.type as ts.TypeReferenceNode;
              const tn = tr.typeName;
              const nm = ts.isIdentifier(tn) ? tn.text : ts.isQualifiedName(tn) ? tn.right.text : undefined;
              if (nm === 'EventEmitter' && tr.typeArguments?.length) return tr.typeArguments[0].getText(sf);
            }
            // Or initializer: new EventEmitter<T>()
            if (ts.isPropertyDeclaration(member) && member.initializer && ts.isNewExpression(member.initializer)) {
              const ne = member.initializer;
              const ex = ne.expression;
              const nm = ts.isIdentifier(ex) ? ex.text : undefined;
              if (nm === 'EventEmitter' && ne.typeArguments?.length) return ne.typeArguments[0].getText(sf);
            }
            return undefined;
          };

          const memberName = (m: ts.ClassElement): string | undefined => {
            const anyM: any = m as any;
            const nameNode: ts.PropertyName | undefined = anyM.name;
            if (!nameNode) return undefined;
            if (ts.isIdentifier(nameNode)) return nameNode.text;
            if (ts.isStringLiteral(nameNode)) return nameNode.text;
            return undefined;
          };

          const handleInputOutput = (m: ts.ClassElement) => {
            const decs = getDecorators(m);
            if (!decs.length) return;
            const names = decs.map((d) => decoratorCallName(d, sf)).filter(Boolean) as string[];
            if (!names.includes('Input') && !names.includes('Output')) return;
            const propName = memberName(m);
            if (!propName) return;

            const anyM: any = m as any;
            const typeRef: IrTypeRef = anyM.type
              ? typeNodeToIrTypeRef(anyM.type as ts.TypeNode, checker)
              : { kind: 'UNKNOWN', name: 'unknown' };

            const attr = ensureAttr(propName, typeRef, m);

            if (names.includes('Input')) {
              setAttrTag(attr, 'angular.role', 'input');
              const d = decs.find((dd) => decoratorCallName(dd, sf) === 'Input');
              const alias = d ? decoratorArgString0(d) : undefined;
              if (alias) setAttrTag(attr, 'angular.inputAlias', alias);
            }

            if (names.includes('Output')) {
              setAttrTag(attr, 'angular.role', 'output');
              const d = decs.find((dd) => decoratorCallName(dd, sf) === 'Output');
              const alias = d ? decoratorArgString0(d) : undefined;
              if (alias) setAttrTag(attr, 'angular.outputAlias', alias);

              const payload = extractEventEmitterPayloadName(m);
              if (payload) {
                setAttrTag(attr, 'angular.outputPayloadType', payload);
                if (includeDeps) {
                  const payloadSimple = payload.includes('.') ? payload.split('.').pop()! : payload;
                  const to = classifierByName.get(payloadSimple);
                  if (to) {
                    addRelation(sf, 'DEPENDENCY', c.id, to.id, m, [
                      { key: 'origin', value: 'output' },
                      { key: 'role', value: 'eventPayload' },
                      { key: 'member', value: propName },
                    ]);
                  } else if (report) {
                    addFinding(report, {
                      kind: 'unresolvedType',
                      severity: 'warning',
                      message: `@Output payload type '${payload}' on ${c.name}.${propName} was not found as a classifier`,
                      location: { file: rel },
                      tags: { owner: c.name, member: propName, type: payload, origin: 'output' },
                    });
                  }
                }
              }
            }
          };

          for (const m of node.members) handleInputOutput(m);
        }

        // DI edges for Component/Injectable
        if (isComponent || isInjectable) {
          const ctor = node.members.find((m) => ts.isConstructorDeclaration(m)) as ts.ConstructorDeclaration | undefined;
          if (ctor) {
            for (const p of ctor.parameters) {
              const tn = getTypeNameFromParam(p);
              if (!tn) continue;
              const to = classifierByName.get(tn);
              if (to) addRelation(sf, 'DI', c.id, to.id, p, [{ key: 'origin', value: 'constructor' }]);
              else if (report) {
                addFinding(report, {
                  kind: 'unresolvedType',
                  severity: 'warning',
                  message: `Constructor DI parameter type '${tn}' on ${c.name} was not found as a classifier`,
                  location: { file: rel },
                  tags: { owner: c.name, type: tn, origin: 'constructor' },
                });
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sf);

    // Step 12: Angular routing extraction
    // Best-effort parse of RouterModule.forRoot/forChild route arrays (and exported routes constants).
    const routeClassifiersByKey = new Map<string, IrClassifier>();

    const ensureRouteClassifier = (key: string, routeName: string, routePath: string, lazy: boolean, sourceNode: ts.Node) => {
      if (routeClassifiersByKey.has(key)) return routeClassifiersByKey.get(key)!;
      const id = hashId('c:', `angular-route:${rel}:${key}:${sourceNode.pos}`);
      const c: IrClassifier = {
        id,
        kind: 'MODULE',
        name: routeName,
        qualifiedName: `${rel}#route:${routePath}`,
        stereotypes: [{ name: 'AngularRoute' }],
        taggedValues: [
          { key: 'framework', value: 'angular' },
          { key: 'angular.routePath', value: routePath },
          { key: 'angular.routeLazy', value: lazy ? 'true' : 'false' },
        ],
        source: sourceRefForNode(sf, sourceNode, projectRoot),
      };
      model.classifiers.push(c);
      routeClassifiersByKey.set(key, c);
      return c;
    };

    const resolveLocalArrayInitializer = (ident: ts.Identifier): ts.ArrayLiteralExpression | undefined => {
      // Only resolve within the same source file.
      const sym = checker.getSymbolAtLocation(ident);
      const decl = sym?.valueDeclaration;
      if (!decl) return undefined;
      if (ts.isVariableDeclaration(decl) && decl.initializer && ts.isArrayLiteralExpression(decl.initializer)) {
        return decl.initializer;
      }
      return undefined;
    };

    const getObjectProp = (obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined => {
      for (const p of obj.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const pn = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
        if (pn !== name) continue;
        return p.initializer;
      }
      return undefined;
    };

    const readString = (e: ts.Expression | undefined): string | undefined => {
      if (!e) return undefined;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
      return undefined;
    };

    const readIdentifierName = (e: ts.Expression | undefined): string | undefined => {
      if (!e) return undefined;
      if (ts.isIdentifier(e)) return e.text;
      if (ts.isPropertyAccessExpression(e)) return e.name.text;
      return undefined;
    };

    const parseLazyModuleName = (e: ts.Expression | undefined): { moduleName?: string; specifier?: string } => {
      // Handles: () => import('./x').then(m => m.FooModule)
      if (!e) return {};
      if (!ts.isArrowFunction(e) && !ts.isFunctionExpression(e)) return {};
      const body = e.body;
      const expr = ts.isBlock(body)
        ? body.statements.find((s) => ts.isReturnStatement(s)) && (body.statements.find((s) => ts.isReturnStatement(s)) as ts.ReturnStatement).expression
        : body;
      if (!expr || !ts.isCallExpression(expr)) return {};
      // expr should be: import('...').then(...)
      if (!ts.isPropertyAccessExpression(expr.expression) || expr.expression.name.text !== 'then') return {};
      const importCall = expr.expression.expression;
      let specifier: string | undefined;
      if (ts.isCallExpression(importCall) && importCall.expression.kind === ts.SyntaxKind.ImportKeyword) {
        specifier = readString(importCall.arguments[0]);
      }
      const thenArg = expr.arguments[0];
      if (!thenArg) return { specifier };
      if (ts.isArrowFunction(thenArg) || ts.isFunctionExpression(thenArg)) {
        const thenBody = thenArg.body;
        const thenExpr = ts.isBlock(thenBody)
          ? thenBody.statements.find((s) => ts.isReturnStatement(s)) && (thenBody.statements.find((s) => ts.isReturnStatement(s)) as ts.ReturnStatement).expression
          : thenBody;
        if (thenExpr && ts.isPropertyAccessExpression(thenExpr)) {
          return { moduleName: thenExpr.name.text, specifier };
        }
      }
      return { specifier };
    };

    const addRouterEdge = (route: IrClassifier, role: 'component' | 'loadChildren', targetName: string, node: ts.Node, extraTags: Record<string, string> = {}) => {
      const to = classifierByName.get(targetName);
      if (to) {
        addRelation(sf, 'DEPENDENCY', route.id, to.id, node, [
          { key: 'origin', value: 'router' },
          { key: 'role', value: role },
          ...Object.entries(extraTags).map(([key, value]) => ({ key, value })),
        ]);
      } else if (report) {
        addFinding(report, {
          kind: role === 'component' ? 'unresolvedRouteTarget' : 'unresolvedLazyModule',
          severity: 'warning',
          message:
            role === 'component'
              ? `Route target component '${targetName}' was not found as a classifier`
              : `Lazy route module '${targetName}' was not found as a classifier`,
          location: { file: rel },
          tags: { role, target: targetName, ...extraTags },
        });
      }
    };

    const parseRoutesArray = (arr: ts.ArrayLiteralExpression, originNode: ts.Node) => {
      let idx = 0;
      for (const el of arr.elements) {
        if (!ts.isObjectLiteralExpression(el)) {
          idx++;
          continue;
        }
        const pathVal = readString(getObjectProp(el, 'path')) ?? '';
        const compName = readIdentifierName(getObjectProp(el, 'component'));
        const lazyInfo = parseLazyModuleName(getObjectProp(el, 'loadChildren'));
        const lazyName = lazyInfo.moduleName;
        const lazy = !!lazyName;

        const target = compName ?? lazyName ?? '(unknown)';
        const key = `${pathVal}::${target}::${idx}`;
        const routeName = `route:${pathVal || '(root)'} -> ${target}`;
        const routeC = ensureRouteClassifier(key, routeName, pathVal, lazy, el);

        if (compName) {
          addRouterEdge(routeC, 'component', compName, el);
        }
        if (lazyName) {
          const extra: Record<string, string> = {};
          if (lazyInfo.specifier) extra.specifier = lazyInfo.specifier;
          addRouterEdge(routeC, 'loadChildren', lazyName, el, extra);
        }
        idx++;
      }
    };

    const routeVisit = (node: ts.Node) => {
      // RouterModule.forRoot([...]) / forChild([...])
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.text;
        if (name === 'forRoot' || name === 'forChild') {
          const lhs = node.expression.expression;
          const lhsName = ts.isIdentifier(lhs) ? lhs.text : ts.isPropertyAccessExpression(lhs) ? lhs.name.text : undefined;
          if (lhsName === 'RouterModule') {
            const a0 = node.arguments[0];
            let arr: ts.ArrayLiteralExpression | undefined;
            if (a0 && ts.isArrayLiteralExpression(a0)) arr = a0;
            else if (a0 && ts.isIdentifier(a0)) arr = resolveLocalArrayInitializer(a0);
            if (arr) parseRoutesArray(arr, node);
          }
        }
      }

      // export const routes: Routes = [...]
      if (ts.isVariableStatement(node)) {
        const isExport = (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (isExport) {
          for (const d of node.declarationList.declarations) {
            if (!ts.isIdentifier(d.name) || !d.initializer || !ts.isArrayLiteralExpression(d.initializer)) continue;
            const varName = d.name.text;
            const typeText = d.type ? d.type.getText(sf) : '';
            if (varName.toLowerCase().includes('route') || typeText.includes('Routes')) {
              parseRoutesArray(d.initializer, d);
            }
          }
        }
      }

      ts.forEachChild(node, routeVisit);
    };

    routeVisit(sf);
  }

}