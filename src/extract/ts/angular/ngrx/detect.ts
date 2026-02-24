import ts from 'typescript';

export type NgRxConceptKind = 'action' | 'selector' | 'effect';

export type NgRxConceptDecl = {
  kind: NgRxConceptKind;
  /** variable name bound to createAction/createSelector/createEffect */
  ident: string;
  /** deterministic key used to build classifier id */
  qualifiedKey: string;
  sf: ts.SourceFile;
  node: ts.Node;
};

export type NgRxOfTypeFinding = {
  sf: ts.SourceFile;
  node: ts.CallExpression; // ofType(...)
  effectIdent: string;
  actionIdent: string;
  pos: number;
};

export type NgRxDispatchFinding = {
  sf: ts.SourceFile;
  node: ts.CallExpression;
  classId: string;
  actionIdent: string;
};

export type NgRxSelectFinding = {
  sf: ts.SourceFile;
  node: ts.CallExpression;
  classId: string;
  selectorIdent: string;
};

export type NgRxInlineOfTypeFinding = {
  sf: ts.SourceFile;
  node: ts.CallExpression; // ofType(...)
  effectIdent: string;
  actionIdent: string;
};

/** const X = <init> */
export function varNameForInit(node: ts.Node): string | undefined {
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  return undefined;
}

export function isCallNamed(call: ts.CallExpression, name: string): boolean {
  return ts.isIdentifier(call.expression) && call.expression.text === name;
}

function getIdentFromExpr(e: ts.Expression | undefined): string | undefined {
  if (!e) return undefined;
  if (ts.isIdentifier(e)) return e.text;
  return undefined;
}

function isThisDotStore(expr: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(expr) &&
    expr.expression.kind === ts.SyntaxKind.ThisKeyword &&
    ts.isIdentifier(expr.name) &&
    expr.name.text === 'store'
  );
}

function isIdent(expr: ts.Expression, name: string): boolean {
  return ts.isIdentifier(expr) && expr.text === name;
}

/**
 * Detect NgRx concept declarations (createAction/createSelector/createEffect) in a source file.
 * Pure detection: does not mutate model or maps.
 */
export function detectNgRxConceptDeclsInSourceFile(args: {
  sf: ts.SourceFile;
}): NgRxConceptDecl[] {
  const { sf } = args;
  const decls: NgRxConceptDecl[] = [];

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      if (isCallNamed(n, 'createAction')) {
        const ident = varNameForInit(n);
        if (ident) {
          decls.push({
            kind: 'action',
            ident,
            qualifiedKey: `state:ngrx:action:${sf.fileName}:${ident}`,
            sf,
            node: n,
          });
        }
      } else if (isCallNamed(n, 'createSelector')) {
        const ident = varNameForInit(n);
        if (ident) {
          decls.push({
            kind: 'selector',
            ident,
            qualifiedKey: `state:ngrx:selector:${sf.fileName}:${ident}`,
            sf,
            node: n,
          });
        }
      } else if (isCallNamed(n, 'createEffect')) {
        const ident = varNameForInit(n);
        if (ident) {
          decls.push({
            kind: 'effect',
            ident,
            qualifiedKey: `state:ngrx:effect:${sf.fileName}:${ident}`,
            sf,
            node: n,
          });
        }
      }
    }
    ts.forEachChild(n, visit);
  };

  visit(sf);
  return decls;
}

/**
 * Detect global ofType(ActionX) references within createEffect initializers across a source file.
 * Returns findings effectIdent -> actionIdent, with the ofType call node for source refs.
 */
export function detectNgRxOfTypeInCreateEffects(args: { sf: ts.SourceFile }): NgRxOfTypeFinding[] {
  const { sf } = args;
  const out: NgRxOfTypeFinding[] = [];

  const visitEffect = (call: ts.CallExpression) => {
    const effectIdent = varNameForInit(call);
    if (!effectIdent) return;

    const scan = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'ofType') {
        for (const a of n.arguments) {
          const actionIdent =
            getIdentFromExpr(a) ?? (ts.isPropertyAccessExpression(a) && ts.isIdentifier(a.name) ? a.name.text : undefined);
          if (!actionIdent) continue;
          out.push({ sf, node: n, effectIdent, actionIdent, pos: n.pos });
        }
      }
      ts.forEachChild(n, scan);
    };

    for (const a of call.arguments) scan(a);
  };

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && isCallNamed(n, 'createEffect')) {
      visitEffect(n);
    }
    ts.forEachChild(n, visit);
  };

  visit(sf);
  return out;
}

/**
 * Detect NgRx usage edges inside a class declaration:
 * - store.dispatch(ActionCreator(...)) => class -> action
 * - store.select(selector) => class -> selector
 * - ofType(ActionX) within createEffect initializer => effect -> action (inline variant)
 */
export function detectNgRxEdgesInClass(args: { sf: ts.SourceFile; node: ts.ClassDeclaration; classId: string }) : {
  dispatches: NgRxDispatchFinding[];
  selects: NgRxSelectFinding[];
  inlineOfType: NgRxInlineOfTypeFinding[];
} {
  const { sf, node, classId } = args;
  const dispatches: NgRxDispatchFinding[] = [];
  const selects: NgRxSelectFinding[] = [];
  const inlineOfType: NgRxInlineOfTypeFinding[] = [];

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.name)) {
      const method = n.expression.name.text;

      if (method === 'dispatch' && (isThisDotStore(n.expression.expression) || isIdent(n.expression.expression, 'store'))) {
        const arg0 = n.arguments[0];
        const actionCall = arg0 && ts.isCallExpression(arg0) ? arg0 : undefined;
        const actionIdent = actionCall ? getIdentFromExpr(actionCall.expression) : getIdentFromExpr(arg0);
        if (actionIdent) dispatches.push({ sf, node: n, classId, actionIdent });
      }

      if (method === 'select' && (isThisDotStore(n.expression.expression) || isIdent(n.expression.expression, 'store'))) {
        const selectorIdent = getIdentFromExpr(n.arguments[0]);
        if (selectorIdent) selects.push({ sf, node: n, classId, selectorIdent });
      }
    }

    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'ofType') {
      // find enclosing effect variable name
      let cur: ts.Node | undefined = n;
      let effectIdent: string | undefined;
      while (cur) {
        if (ts.isCallExpression(cur) && isCallNamed(cur, 'createEffect')) {
          effectIdent = varNameForInit(cur);
          break;
        }
        cur = cur.parent;
      }
      if (effectIdent) {
        for (const a of n.arguments) {
          const actionIdent =
            getIdentFromExpr(a) ?? (ts.isPropertyAccessExpression(a) && ts.isIdentifier(a.name) ? a.name.text : undefined);
          if (!actionIdent) continue;
          inlineOfType.push({ sf, node: n, effectIdent, actionIdent });
        }
      }
    }

    ts.forEachChild(n, visit);
  };

  visit(node);
  return { dispatches, selects, inlineOfType };
}
