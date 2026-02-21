export type CliArgs = {
  source?: string;
  out?: string;
  verbose: boolean;
};

/**
 * Minimal, testable CLI arg parsing. This stays intentionally small in Step 1.
 * Commander handles the full UX; tests use this to validate basic behavior.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const out: CliArgs = { verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source' || a === '-s' || a === '--project' || a === '-p') out.source = argv[++i];
    else if (a === '--out' || a === '-o') out.out = argv[++i];
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  return out;
}
