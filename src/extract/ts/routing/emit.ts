import ts from 'typescript';
import path from 'node:path';
import { hashId } from '../../../util/id';
import type { IrModel, IrRelationKind, IrStereotype, IrTaggedValue, IrSourceRef } from '../../../ir/irV1';

export type SourceRefFn = (sf: ts.SourceFile, node: ts.Node) => IrSourceRef | null | undefined;

export type EmitRoutingRelationArgs = {
  model: IrModel;
  includeEdges: boolean;
  projectRoot: string;

  sf: ts.SourceFile;
  kind: IrRelationKind;
  fromId: string;
  toId: string;
  node: ts.Node;

  /** Tagged values to put on the relation (caller controls ordering). */
  tags: IrTaggedValue[];

  /** Optional stereotypes; pass [] to explicitly include an empty list. */
  stereotypes?: IrStereotype[];

  /** Namespace used for deterministic relation id hashing. */
  idNamespace: string;

  /** Dedupe by a caller-provided key set (preferred for stable semantics). */
  existingKeys?: Set<string>;
  dedupeKey?: string;

  /** If true, also dedupe by computed id (used by older React routing logic). */
  dedupeById?: boolean;

  sourceRefForNode: SourceRefFn;
};

function toPosixPath(p: string): string {
  return p.replaceAll('\\', '/');
}

export function emitRoutingRelation(args: EmitRoutingRelationArgs): void {
  const {
    model,
    includeEdges,
    projectRoot,
    sf,
    kind,
    fromId,
    toId,
    node,
    tags,
    stereotypes,
    idNamespace,
    existingKeys,
    dedupeKey,
    dedupeById,
    sourceRefForNode,
  } = args;

  if (includeEdges === false) return;

  if (existingKeys && dedupeKey) {
    if (existingKeys.has(dedupeKey)) return;
  }

  model.relations = model.relations ?? [];
  const relFile = toPosixPath(path.relative(projectRoot, sf.fileName));
  const role = tags.find((t) => t.key === 'role')?.value ?? '';
  const id = hashId('r:', `${idNamespace}:${relFile}:${fromId}->${toId}:${role}:${node.pos}`);

  if (dedupeById === true) {
    if (model.relations.some((r) => r.id === id)) return;
  }

  model.relations.push({
    id,
    kind,
    sourceId: fromId,
    targetId: toId,
    taggedValues: tags,
    stereotypes,
    source: sourceRefForNode(sf, node) ?? null,
  });

  if (existingKeys && dedupeKey) existingKeys.add(dedupeKey);
}
