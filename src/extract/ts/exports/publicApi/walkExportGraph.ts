import ts from 'typescript';
import path from 'node:path';

import type { IrClassifier, IrModel } from '../../../../ir/irV1';
import type { IrPackageInfo } from '../../context';
import { ensureApiExportClassifier, ensurePkgIdForRel, hasExportModifier } from './shared';

export function walkPublicApiExportGraph(args: {
  program: ts.Program;
  projectRoot: string;
  scannedRel: string[];
  model: IrModel;
  pkgByDir: Map<string, IrPackageInfo>;
}): { exportByFileAndName: Map<string, IrClassifier> } {
  const { program, projectRoot, scannedRel, model, pkgByDir } = args;

  const exportByFileAndName = new Map<string, IrClassifier>();

  // 1) Collect exports
  for (const relFile of scannedRel) {
    const abs = path.resolve(projectRoot, relFile);
    const sf = program.getSourceFile(abs);
    if (!sf || sf.isDeclarationFile) continue;

    const pkgId = ensurePkgIdForRel(relFile, pkgByDir);

    const addExport = (name: string, node: ts.Node) => {
      const exp = ensureApiExportClassifier({ model, projectRoot, relFile, exportName: name, node, sf, pkgId });
      exportByFileAndName.set(`${relFile}::${name}`, exp);
    };

    const visit = (n: ts.Node) => {
      // export class/func/interface/type/enum/const
      if (
        (ts.isClassDeclaration(n) ||
          ts.isFunctionDeclaration(n) ||
          ts.isInterfaceDeclaration(n) ||
          ts.isTypeAliasDeclaration(n) ||
          ts.isEnumDeclaration(n)) &&
        hasExportModifier(n)
      ) {
        const nm = n.name ? n.name.text : null;
        if (nm) addExport(nm, n);
      }
      if (ts.isVariableStatement(n) && hasExportModifier(n)) {
        for (const d of n.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) addExport(d.name.text, d);
        }
      }
      // export { a as b } from './x'
      if (ts.isExportDeclaration(n) && n.exportClause && ts.isNamedExports(n.exportClause)) {
        for (const el of n.exportClause.elements) {
          const name = el.name && ts.isIdentifier(el.name) ? el.name.text : null;
          if (name) addExport(name, el);
        }
      }
      // export * from './x' : not enumerable without checker; skip (consumers will resolve imports anyway)
      // export default ... : create as "default"
      if (ts.isExportAssignment(n)) {
        addExport('default', n);
      }

      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  return { exportByFileAndName };
}
