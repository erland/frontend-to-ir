import ts from 'typescript';
import type { IrClassifier, IrTypeRef } from '../../../ir/irV1';
import { typeNodeToIrTypeRef } from '../typeRef';
import type { ReactWorkContext } from './types';

function upsertAttr(c: IrClassifier, name: string, type: IrTypeRef, role: 'props' | 'state') {
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
}

export function applyReactPropsState(
  rctx: ReactWorkContext,
  c: IrClassifier,
  sf: ts.SourceFile,
  propsTypeNode?: ts.TypeNode | null,
  stateTypeNode?: ts.TypeNode | null,
) {
  const { checker } = rctx;
  if (propsTypeNode) {
    const propsType = typeNodeToIrTypeRef(propsTypeNode, checker);
    upsertAttr(c, 'props', propsType, 'props');
    rctx.setClassifierTag(c, 'react.propsType', propsTypeNode.getText(sf));
  }
  if (stateTypeNode) {
    const stateType = typeNodeToIrTypeRef(stateTypeNode, checker);
    upsertAttr(c, 'state', stateType, 'state');
    rctx.setClassifierTag(c, 'react.stateType', stateTypeNode.getText(sf));
  }
}

export function isReactFcType(tn: ts.TypeNode, sf: ts.SourceFile): ts.TypeNode | null {
  if (!ts.isTypeReferenceNode(tn)) return null;
  const typeName = tn.typeName.getText(sf);
  const isFc =
    typeName === 'React.FC' ||
    typeName === 'FC' ||
    typeName === 'React.FunctionComponent' ||
    typeName === 'FunctionComponent';
  if (!isFc) return null;
  const args = tn.typeArguments ?? [];
  return args.length >= 1 ? args[0] : null;
}
