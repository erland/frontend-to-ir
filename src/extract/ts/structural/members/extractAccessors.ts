import ts from 'typescript';
import type { IrClassifier } from '../../../../ir/irV1';

/**
 * Accessor extraction is intentionally a no-op for now to preserve existing behavior.
 * Prior to the refactor, get/set accessors were not extracted into the IR.
 */
export function extractAccessorMember(_ctx: {
  sf: ts.SourceFile;
  member: ts.GetAccessorDeclaration | ts.SetAccessorDeclaration;
  cls: IrClassifier;
}): void {
  // no-op (behavior-preserving)
}
