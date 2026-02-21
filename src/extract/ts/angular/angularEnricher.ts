import ts from 'typescript';
import path from 'node:path';
import type { IrClassifier, IrRelationKind, IrTaggedValue } from '../../../ir/irV1';
import { hashId } from '../../../util/id';
import type { ExtractorContext } from '../context';
import { detectAngularDecorators, applyAngularClassifierDecoration } from './decorators';
import { extractConstructorDiEdges } from './di';
import { extractNgModuleEdges } from './ngModule';
import { extractInputsOutputs } from './inputsOutputs';
import { extractAngularRoutesFromSourceFile } from './routing';
import { getDecorators, sourceRefForNode, toPosixPath } from './util';

export function enrichAngularModel(ctx: ExtractorContext) {
  const { program, projectRoot, scannedRel, model } = ctx;
  const checker = ctx.checker;
  const includeFrameworkEdges = ctx.includeFrameworkEdges;
  const includeDeps = ctx.includeDeps;
  const report = ctx.report;

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

  // Deduplicate edges by (kind, from, to, role)
  const existingKeys = new Set<string>();
  for (const r of model.relations ?? []) {
    const role = (r.taggedValues ?? []).find((tv) => tv.key === 'role')?.value ?? '';
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

        const info = detectAngularDecorators(node, sf);
        if (!(info.isComponent || info.isInjectable || info.isNgModule)) {
          ts.forEachChild(node, visit);
          return;
        }

        applyAngularClassifierDecoration(c, info, { addStereo, setTag });

        if (info.isNgModule) {
          extractNgModuleEdges({
            sf,
            node,
            relPath: rel,
            c,
            classifierByName,
            addRelation,
            report,
          });
        }

        if (info.isComponent) {
          extractInputsOutputs({
            sf,
            node,
            rel,
            projectRoot,
            c,
            checker,
            classifierByName,
            includeDeps,
            addRelation,
            report,
          });
        }

        if (info.isComponent || info.isInjectable) {
          extractConstructorDiEdges({
            sf,
            rel,
            node,
            c,
            checker,
            classifierByName,
            addRelation,
            report,
          });
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sf);

    // Routing extraction (file-level)
    extractAngularRoutesFromSourceFile({
      sf,
      rel,
      projectRoot,
      model,
      checker,
      classifierByName,
      addRelation,
      report,
    });
  }
}
