import ts from 'typescript';
import path from 'node:path';
import type { IrClassifier, IrRelationKind, IrTaggedValue } from '../../../ir/irV1';
import type { ExtractorContext } from '../context';
import { detectAngularDecorators, applyAngularClassifierDecoration } from './decorators';
import { extractConstructorDiEdges, extractInjectFunctionEdges, extractProviderRegistrationEdges } from './di';
import { extractAngularHttpEdges } from './http';
import { buildNgRxIndex, extractAngularStateEdges, addNgRxEffectOfTypeEdges } from './stateNgRx';
import { buildAngularTemplateIndex, extractAngularTemplateEdges } from './templates';
import { extractNgModuleEdges } from './ngModule';
import { extractStandaloneComponentEdges } from './modules';
import { extractInputsOutputs } from './inputsOutputs';
import { extractAngularRoutesFromSourceFile } from './routing';
import { getDecorators, sourceRefForNode, toPosixPath } from './util';
import { emitRoutingRelation } from '../routing';

export function enrichAngularModel(ctx: ExtractorContext) {
  const { program, projectRoot, scannedRel, model } = ctx;
  const checker = ctx.checker;
  const includeFrameworkEdges = ctx.includeFrameworkEdges;
  const includeDeps = ctx.includeDeps;
  const report = ctx.report;

  const classifierByName = new Map<string, IrClassifier>();
  for (const c of model.classifiers) classifierByName.set(c.name, c);

  // State graph (NgRx) index (best-effort)
  const ngrxIndex = buildNgRxIndex({ program, projectRoot, scannedRel, model });
  // Global NgRx effect -> action edges (ofType)
  addNgRxEffectOfTypeEdges({ program, projectRoot, scannedRel, model, ngrx: ngrxIndex, report });

  // Template coupling index (pipes/directives/components)
  const templateIndex = buildAngularTemplateIndex({ program, projectRoot, scannedRel, model });

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
          extractNgModuleEdges({
            sf,
            node,
            relPath: rel,
            c,
            classifierByName,
            addRelation,
            report,
          });

          extractProviderRegistrationEdges({
            sf,
            rel,
            node,
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


          extractProviderRegistrationEdges({
            sf,
            rel,
            node,
            c,
            classifierByName,
            addRelation,
            report,
          });

          extractStandaloneComponentEdges({
            sf,
            node,
            relPath: rel,
            c,
            classifierByName,
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

          extractInjectFunctionEdges({
            sf,
            rel,
            node,
            c,
            classifierByName,
            addRelation,
            report,
          });

          // HTTP call graph (HttpClient)
          extractAngularHttpEdges({
            sf,
            rel,
            projectRoot,
            node,
            c,
            checker,
            model,
            addRelation,
            report,
          });

          // State graph (NgRx)
          extractAngularStateEdges({
            sf,
            rel,
            projectRoot,
            node,
            c,
            addRelation,
            ngrx: ngrxIndex,
            report,
          });

          // Template coupling (pipes/directives/components usage)
          if (info.isComponent) {
            extractAngularTemplateEdges({
              sf,
              rel,
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
      markTarget: (target, stereo, tags) => {
        addStereo(target, stereo);
        if (tags) {
          for (const [k, v] of Object.entries(tags)) setTag(target, `angular.${k}`, v);
        }
      },
    });
  }


  // Post-pass: mark HTTP interceptors based on DI provider registrations.
  for (const r of model.relations ?? []) {
    if (r.kind !== 'DI') continue;
    const tv = (k: string) => (r.taggedValues ?? []).find((t) => t.key === k)?.value;
    const provide = tv('provide') ?? tv('token') ?? '';
    if (provide !== 'HTTP_INTERCEPTORS') continue;
    const target = model.classifiers.find((c) => c.id === r.targetId);
    if (!target) continue;
    addStereo(target, 'AngularInterceptor');
    setTag(target, 'angular.interceptor', 'true');
  }
}