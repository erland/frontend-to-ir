import ts from 'typescript';

/**
 * TypeScript's printer used by Node#getText() can recurse deeply on large generic types
 * and overflow the JS stack on real-world codebases.
 *
 * This helper keeps extraction resilient by returning a conservative fallback
 * when TS printing blows up.
 */
export function safeNodeText(node: ts.Node | undefined, sf?: ts.SourceFile): string {
  if (!node) return '';
  try {
    return sf ? node.getText(sf) : node.getText();
  } catch (e: any) {
    if (e && (e.name === 'RangeError' || String(e).includes('Maximum call stack'))) {
      // Avoid invoking the TS printer again.
      if ((node as any).text && typeof (node as any).text === 'string') return (node as any).text;
      return '[unprintable]';
    }
    throw e;
  }
}
