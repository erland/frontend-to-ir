import ts from 'typescript';
import path from 'node:path';
import type { IrClassifier, IrRelationKind, IrTaggedValue } from '../../../ir/irV1';
import type { ExtractorContext } from '../context';
import { detectAngularDecorators, applyAngularClassifierDecoration } from './decorators';
import { getDecorators, sourceRefForNode, toPosixPath } from './util';
import { emitRoutingRelation } from '../routing';
import { enrichAngularNgModule, enrichAngularComponentModuleEdges } from './enrich/modules';
import { enrichAngularDi, postProcessAngularInterceptors } from './enrich/di';
import { enrichAngularHttp } from './enrich/http';
import { createNgRxIndex, enrichAngularState } from './enrich/state';
import { createTemplateIndex, enrichAngularTemplates } from './enrich/templates';
import { enrichAngularRoutingFile } from './enrich/routing';

export function enrichAngularModel(ctx: ExtractorContext) {
  const { program, projectRoot, scannedRel, model } = ctx;
  const checker = ctx.checker;
  const includeFrameworkEdges = ctx.includeFrameworkEdges;
  const includeDeps = ctx.includeDeps;
  const report = ctx.report;

  const classifierByName = new Map<string, IrClassifier>();
  for (const c of model.classifiers) classifierByName.set(c.name, c);
  // Stage indices used by later steps
  const ngrxIndex = createNgRxIndex({ program, projectRoot, scannedRel, model, report });
  const templateIndex = createTemplateIndex({ program, projectRoot, scannedRel, model });

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

  // Deduplicate edges. For DI edges, include extra tag discriminators so provider objects don't collapse into class providers.
  const edgeKey = (kind: IrRelationKind, fromId: string, toId: string, tags: IrTaggedValue[] = []) => {
    const get = (k: string) => tags.find((t) => t.key === k)?.value ?? '';
    const role = get('role');
    if (kind === 'DI') {
      // Allow multiple DI edges between the same nodes if they represent different DI semantics.
      const origin = get('origin');
      const token = get('token');
      const provide = get('provide');
      const useClass = get('useClass');
      const providerKind = get('providerKind');
      const scope = get('scope');
      return `${kind}:${fromId}:${toId}:${role}:${origin}:${scope}:${token}:${provide}:${useClass}:${providerKind}`;
    }
    return `${kind}:${fromId}:${toId}:${role}`;
  };

  // Deduplicate edges
  const existingKeys = new Set<string>();
  for (const r of model.relations ?? []) {
    existingKeys.add(edgeKey(r.kind, r.sourceId, r.targetId, r.taggedValues ?? []));
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
    const key = edgeKey(kind, fromId, toId, tags);
    emitRoutingRelation({
      model,
      includeEdges: true,
      projectRoot,
      sf,
      kind,
      fromId,
      toId,
      node,
      tags,
      stereotypes: [],
      idNamespace: kind,
      existingKeys,
      dedupeKey: key,
      sourceRefForNode: (sff, nn) => sourceRefForNode(sff, nn, projectRoot),
    });
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
          enrichAngularNgModule({
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
          enrichAngularComponentModuleEdges({
            sf,
            node,
            relPath: rel,
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
          enrichAngularDi({
            sf,
            relPath: rel,
            node,
            c,
            checker,
            classifierByName,
            addRelation,
            report,
          });

          enrichAngularHttp({
            sf,
            relPath: rel,
            projectRoot,
            node,
            c,
            checker,
            model,
            addRelation,
            report,
          });

          enrichAngularState({
            sf,
            relPath: rel,
            projectRoot,
            node,
            c,
            addRelation,
            ngrx: ngrxIndex,
            report,
          });

          // Template coupling (pipes/directives/components usage)
          if (info.isComponent) {
            enrichAngularTemplates({
              sf,
              relPath: rel,
              projectRoot,
              node,
              c,
              program,
              model,
              addRelation,
              index: templateIndex,
              report,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sf);

    enrichAngularRoutingFile({
      sf,
      relPath: rel,
      projectRoot,
      model,
      checker,
      classifierByName,
      addRelation,
      report,
      addStereo,
      setTag,
    });
  }
  postProcessAngularInterceptors({ model, addStereo, setTag });
}
