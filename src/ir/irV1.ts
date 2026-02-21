/**
 * IR v1 data model — MUST match java-to-xmi IR schema.
 *
 * Source of truth: src/ir/schema/ir-schema-v1.json
 */

export type IrSchemaVersion = string;

export type IrTaggedValue = {
  key: string;
  value: string;
};

export type IrStereotype = {
  name: string;
  qualifiedName?: string | null;
};

export type IrSourceRef = {
  /** Path relative to --source/project root (never absolute). */
  file: string;
  /** 1-based line number (nullable). */
  line?: number | null;
  /** 1-based column number (nullable). */
  col?: number | null;
};

export type IrTypeRefKind =
  | 'NAMED'
  | 'PRIMITIVE'
  | 'GENERIC'
  | 'ARRAY'
  | 'UNION'
  | 'INTERSECTION'
  | 'UNKNOWN';

/**
 * The IR schema keeps TypeRef intentionally uniform for cross-language representation.
 */
export type IrTypeRef = {
  kind: IrTypeRefKind;
  name?: string | null;
  typeArgs?: IrTypeRef[];
  elementType?: IrTypeRef | null;
  taggedValues?: IrTaggedValue[];
};

export type IrVisibility = 'PUBLIC' | 'PROTECTED' | 'PACKAGE' | 'PRIVATE';

export type IrClassifierKind =
  | 'CLASS'
  | 'INTERFACE'
  | 'ENUM'
  | 'RECORD'
  | 'TYPE_ALIAS'
  | 'FUNCTION'
  | 'COMPONENT'
  | 'SERVICE'
  | 'MODULE';

export type IrAttribute = {
  id?: string | null;
  name: string;
  visibility?: IrVisibility;
  isStatic?: boolean;
  isFinal?: boolean;
  type: IrTypeRef;
  stereotypes?: IrStereotype[];
  taggedValues?: IrTaggedValue[];
  source?: IrSourceRef | null;
};

export type IrParameter = {
  name: string;
  type: IrTypeRef;
  taggedValues?: IrTaggedValue[];
};

export type IrOperation = {
  id?: string | null;
  name: string;
  visibility?: IrVisibility;
  isStatic?: boolean;
  isAbstract?: boolean;
  isConstructor?: boolean;
  returnType: IrTypeRef;
  parameters?: IrParameter[];
  stereotypes?: IrStereotype[];
  taggedValues?: IrTaggedValue[];
  source?: IrSourceRef | null;
};

export type IrClassifier = {
  id: string;
  name: string;
  qualifiedName?: string | null;
  packageId?: string | null;
  kind: IrClassifierKind;
  visibility?: IrVisibility;
  attributes?: IrAttribute[];
  operations?: IrOperation[];
  stereotypes?: IrStereotype[];
  taggedValues?: IrTaggedValue[];
  source?: IrSourceRef | null;
};

export type IrPackage = {
  id: string;
  name: string;
  qualifiedName?: string | null;
  parentId?: string | null;
  taggedValues?: IrTaggedValue[];
};

export type IrRelationKind =
  | 'GENERALIZATION'
  | 'REALIZATION'
  | 'ASSOCIATION'
  | 'DEPENDENCY'
  | 'COMPOSITION'
  | 'AGGREGATION'
  | 'RENDER'
  | 'DI'
  | 'TEMPLATE_USES'
  | 'ROUTE_TO';

export type IrRelation = {
  id: string;
  kind: IrRelationKind;
  sourceId: string;
  targetId: string;
  name?: string | null;
  stereotypes?: IrStereotype[];
  taggedValues?: IrTaggedValue[];
  source?: IrSourceRef | null;
};

export type IrModel = {
  schemaVersion: IrSchemaVersion;
  packages?: IrPackage[];
  classifiers: IrClassifier[];
  relations?: IrRelation[];
  taggedValues?: IrTaggedValue[];
};

export function createEmptyIrModel(): IrModel {
  return {
    schemaVersion: '1.0',
    classifiers: [],
    packages: [],
    relations: [],
    taggedValues: [],
  };
}
