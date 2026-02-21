/**
 * IR v1 data model.
 *
 * This is the *stable* JSON schema that downstream tooling (e.g. java-to-xmi)
 * will consume. We keep it intentionally conservative and backward compatible.
 */

export type IrSchemaVersion = 1;

export type IrVisibility = 'public' | 'protected' | 'private' | 'package' | 'unknown';

export type IrClassifierKind =
  | 'CLASS'
  | 'INTERFACE'
  | 'ENUM'
  | 'TYPE_ALIAS'
  | 'COMPONENT'
  | 'SERVICE'
  | 'MODULE'
  | 'FUNCTION'
  | 'UNKNOWN';

export type IrRelationKind =
  | 'GENERALIZATION'
  | 'REALIZATION'
  | 'ASSOCIATION'
  | 'DEPENDENCY'
  | 'RENDER'
  | 'DI'
  | 'TEMPLATE_USES'
  | 'ROUTE_TO'
  | 'UNKNOWN';

export type IrTaggedValue = {
  key: string;
  value: string;
};

export type IrSourceRef = {
  /** Path relative to --source/project root (never absolute). */
  file?: string;
  /** 1-based line number (optional). */
  line?: number;
  /** 1-based column number (optional). */
  col?: number;
};

export type IrTypeRef =
  | { kind: 'PRIMITIVE'; name: string }
  | { kind: 'NAMED'; name: string; qualifiedName?: string }
  | { kind: 'GENERIC'; base: IrTypeRef; args: IrTypeRef[] }
  | { kind: 'ARRAY'; elementType: IrTypeRef }
  | { kind: 'UNION'; types: IrTypeRef[] }
  | { kind: 'INTERSECTION'; types: IrTypeRef[] }
  | { kind: 'UNKNOWN' };

export type IrParameter = {
  name: string;
  type: IrTypeRef;
  optional?: boolean;
};

export type IrAttribute = {
  id: string;
  name: string;
  visibility?: IrVisibility;
  type: IrTypeRef;
  stereotypes?: string[];
  taggedValues?: IrTaggedValue[];
  source?: IrSourceRef;
};

export type IrOperation = {
  id: string;
  name: string;
  visibility?: IrVisibility;
  parameters?: IrParameter[];
  returnType?: IrTypeRef;
  stereotypes?: string[];
  taggedValues?: IrTaggedValue[];
  source?: IrSourceRef;
};

export type IrPackage = {
  id: string;
  name: string;
  qualifiedName?: string;
  parentId?: string;
  stereotypes?: string[];
  taggedValues?: IrTaggedValue[];
  source?: IrSourceRef;
};

export type IrClassifier = {
  id: string;
  name: string;
  qualifiedName: string;
  packageId?: string;
  kind: IrClassifierKind;
  visibility?: IrVisibility;
  attributes?: IrAttribute[];
  operations?: IrOperation[];
  stereotypes?: string[];
  taggedValues?: IrTaggedValue[];
  source?: IrSourceRef;
};

export type IrRelation = {
  id: string;
  kind: IrRelationKind;
  sourceId: string;
  targetId: string;
  name?: string;
  stereotypes?: string[];
  taggedValues?: IrTaggedValue[];
  source?: IrSourceRef;
};

export type IrModel = {
  schemaVersion: IrSchemaVersion;
  packages?: IrPackage[];
  classifiers: IrClassifier[];
  relations?: IrRelation[];
  /** Optional: model-level tagged values. */
  taggedValues?: IrTaggedValue[];
};

export function createEmptyIrModel(): IrModel {
  return {
    schemaVersion: 1,
    classifiers: [],
    packages: [],
    relations: [],
    taggedValues: [],
  };
}
