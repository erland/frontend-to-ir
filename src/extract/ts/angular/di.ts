import ts from 'typescript';
import type { IrClassifier, IrTaggedValue, IrRelationKind } from '../../../ir/irV1';
import type { ExtractionReport } from '../../../report/extractionReport';
import { addFinding } from '../../../report/reportBuilder';
import { decoratorCallName, getDecoratorArgObject, getDecorators } from './util';
import { safeNodeText } from '../util/safeText';

export type AddAngularRelation = (
  sf: ts.SourceFile,
  kind: IrRelationKind,
  fromId: string,
  toId: string,
  node: ts.Node,
  tags: IrTaggedValue[],
) => void;

function findParamInjectToken(p: ts.ParameterDeclaration, sf: ts.SourceFile): string | undefined {
  const decs = getDecorators(p);
  for (const d of decs) {
    const nm = decoratorCallName(d, sf);
    if (nm !== 'Inject') continue;
    // @Inject(TOKEN)
    const expr = d.expression;
    if (!ts.isCallExpression(expr)) return undefined;
    const a0 = expr.arguments[0];
    if (!a0) return undefined;
    if (ts.isIdentifier(a0)) return a0.text;
    if (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) return a0.text;
    if (ts.isPropertyAccessExpression(a0)) return a0.name.text;
    return safeNodeText(a0, sf);
  }
  return undefined;
}

export function extractConstructorDiEdges(args: {
  sf: ts.SourceFile;
  rel: string;
  node: ts.ClassDeclaration;
  c: IrClassifier;
  checker: ts.TypeChecker;
  classifierByName: Map<string, IrClassifier>;
  addRelation: AddAngularRelation;
  report?: ExtractionReport;
}) {
  const { sf, rel, node, c, checker, classifierByName, addRelation, report } = args;

  const getTypeNameFromParam = (p: ts.ParameterDeclaration): string | undefined => {
    const t = p.type ? checker.getTypeFromTypeNode(p.type) : checker.getTypeAtLocation(p);
    const sym = t.getSymbol() ?? (t as any).aliasSymbol;
    const n = sym?.getName();
    return n && n !== '__type' ? n : undefined;
  };

  const ctor = node.members.find((m) => ts.isConstructorDeclaration(m)) as ts.ConstructorDeclaration | undefined;
  if (!ctor) return;

  for (const p of ctor.parameters) {
    const injectToken = findParamInjectToken(p, sf);
    const tn = injectToken ?? getTypeNameFromParam(p);
    if (!tn) continue;
    const to = classifierByName.get(tn);
    if (to) {
      const tags: IrTaggedValue[] = [{ key: 'origin', value: 'constructor' }];
      if (injectToken) tags.push({ key: 'token', value: injectToken });
      addRelation(sf, 'DI', c.id, to.id, p, tags);
    } else if (report) {
      addFinding(report, {
        kind: 'unresolvedType',
        severity: 'warning',
        message: `Constructor DI parameter token/type '${tn}' on ${c.name} was not found as a classifier`,
        location: { file: rel },
        tags: { owner: c.name, type: tn, origin: 'constructor', ...(injectToken ? { token: injectToken } : {}) },
      });
    }
  }
}

function readProvidersArray(obj: ts.ObjectLiteralExpression): ts.Expression[] {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const pn = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
    if (pn !== 'providers') continue;
    const init = p.initializer;
    if (!ts.isArrayLiteralExpression(init)) return [];
    return [...init.elements];
  }
  return [];
}

function readProviderObject(e: ts.ObjectLiteralExpression, sf: ts.SourceFile): {
  provide?: string;
  useClass?: string;
  useValue?: string;
  useFactory?: string;
  deps?: string[];
} {
  const out: any = {};
  for (const p of e.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const pn = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : undefined;
    if (!pn) continue;
    const init = p.initializer;
    const asName = (x: ts.Expression): string | undefined => {
      if (ts.isIdentifier(x)) return x.text;
      if (ts.isPropertyAccessExpression(x)) return x.name.text;
      if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return x.text;
      return safeNodeText(x, sf);
    };

    if (pn === 'provide') out.provide = asName(init);
    if (pn === 'useClass') out.useClass = asName(init);
    if (pn === 'useValue') out.useValue = asName(init);
    if (pn === 'useFactory') out.useFactory = asName(init);
    if (pn === 'deps' && ts.isArrayLiteralExpression(init)) {
      out.deps = init.elements.map((el) => asName(el as any)).filter(Boolean);
    }
  }
  return out;
}

export function extractProviderRegistrationEdges(args: {
  sf: ts.SourceFile;
  rel: string;
  node: ts.ClassDeclaration;
  c: IrClassifier;
  classifierByName: Map<string, IrClassifier>;
  addRelation: AddAngularRelation;
  report?: ExtractionReport;
}) {
  const { sf, rel, node, c, classifierByName, addRelation, report } = args;

  const decorators = getDecorators(node);
  const d = decorators.find((dd) => {
    const nm = decoratorCallName(dd, sf);
    return nm === 'NgModule' || nm === 'Component';
  });
  if (!d) return;

  const decoratorName = decoratorCallName(d, sf)!;
  const obj = getDecoratorArgObject(d);
  if (!obj) return;

  const providers = readProvidersArray(obj);
  for (const entry of providers) {
    if (ts.isIdentifier(entry)) {
      const to = classifierByName.get(entry.text);
      if (to) {
        addRelation(sf, 'DI', c.id, to.id, entry, [
          { key: 'origin', value: 'provider' },
          { key: 'role', value: 'providers' },
          { key: 'scope', value: decoratorName === 'NgModule' ? 'ngmodule' : 'component' },
          { key: 'providerKind', value: 'class' },
        ]);
      } else if (report) {
        addFinding(report, {
          kind: 'unresolvedDecoratorRef',
          severity: 'warning',
          message: `${decoratorName} providers references '${entry.text}' but it was not found as a classifier`,
          location: { file: rel },
          tags: { owner: c.name, role: 'providers', ref: entry.text },
        });
      }
      continue;
    }

    if (ts.isObjectLiteralExpression(entry)) {
      const po = readProviderObject(entry, sf);
      const provide = po.provide;
      const useClass = po.useClass;

      // Best-effort target: prefer useClass, then provide
      const targetName = useClass ?? provide;
      if (!targetName) continue;

      const to = classifierByName.get(targetName);
      if (to) {
        const tags: IrTaggedValue[] = [
          { key: 'origin', value: 'provider' },
          { key: 'role', value: 'providers' },
          { key: 'scope', value: decoratorName === 'NgModule' ? 'ngmodule' : 'component' },
          { key: 'providerKind', value: useClass ? 'useClass' : 'provide' },
        ];
        if (provide) tags.push({ key: 'provide', value: provide });
        if (useClass) tags.push({ key: 'useClass', value: useClass });
        if (po.useFactory) tags.push({ key: 'useFactory', value: po.useFactory });
        if (po.useValue) tags.push({ key: 'useValue', value: po.useValue });
        if (po.deps?.length) tags.push({ key: 'deps', value: po.deps.join(',') });
        addRelation(sf, 'DI', c.id, to.id, entry, tags);
      } else if (report) {
        addFinding(report, {
          kind: 'unresolvedDecoratorRef',
          severity: 'warning',
          message: `${decoratorName} providers references '${targetName}' but it was not found as a classifier`,
          location: { file: rel },
          tags: { owner: c.name, role: 'providers', ref: targetName, provide: provide ?? '' },
        });
      }
    }
  }
}

export function extractInjectFunctionEdges(args: {
  sf: ts.SourceFile;
  rel: string;
  node: ts.ClassDeclaration;
  c: IrClassifier;
  classifierByName: Map<string, IrClassifier>;
  addRelation: AddAngularRelation;
  report?: ExtractionReport;
}) {
  const { sf, rel, node, c, classifierByName, addRelation, report } = args;

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      // inject(TOKEN)
      if (ts.isIdentifier(n.expression) && n.expression.text === 'inject' && n.arguments.length >= 1) {
        const a0 = n.arguments[0];
        let token: string | undefined;
        if (ts.isIdentifier(a0)) token = a0.text;
        else if (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) token = a0.text;
        else if (ts.isPropertyAccessExpression(a0)) token = a0.name.text;
        else token = safeNodeText(a0, sf);

        if (token) {
          const to = classifierByName.get(token);
          if (to) {
            addRelation(sf, 'DI', c.id, to.id, n, [{ key: 'origin', value: 'injectFn' }, { key: 'token', value: token }]);
          } else if (report) {
            addFinding(report, {
              kind: 'unresolvedType',
              severity: 'warning',
              message: `inject(${token}) in ${c.name} was not found as a classifier`,
              location: { file: rel },
              tags: { owner: c.name, token, origin: 'injectFn' },
            });
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };

  for (const m of node.members) visit(m);
}
