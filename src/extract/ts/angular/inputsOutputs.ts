import ts from 'typescript';
import type { IrClassifier, IrAttribute, IrTypeRef, IrTaggedValue, IrRelationKind } from '../../../ir/irV1';
import type { ExtractionReport } from '../../../report/extractionReport';
import { addFinding } from '../../../report/reportBuilder';
import { hashId } from '../../../util/id';
import { typeNodeToIrTypeRef } from '../typeRef';
import { decoratorCallName, decoratorArgString0, getDecorators, memberName, sourceRefForNode } from './util';

export type AddAngularRelation = (
  sf: ts.SourceFile,
  kind: IrRelationKind,
  fromId: string,
  toId: string,
  node: ts.Node,
  tags: IrTaggedValue[],
) => void;

export function extractInputsOutputs(args: {
  sf: ts.SourceFile;
  node: ts.ClassDeclaration;
  rel: string;
  projectRoot: string;
  c: IrClassifier;
  checker: ts.TypeChecker;
  classifierByName: Map<string, IrClassifier>;
  includeDeps?: boolean;
  addRelation: AddAngularRelation;
  report?: ExtractionReport;
}) {
  const { sf, node, rel, projectRoot, c, checker, classifierByName, includeDeps, addRelation, report } = args;

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
