// Public library surface (will grow as we implement extraction steps).

export const VERSION = '0.1.0';

export * from './ir/irV1';
export * from './ir/writeIrJson';
export * from './ir/canonicalizeIrModel';
export * from './ir/deterministicJson';
export * from './scan/sourceScanner';
export * from './scan/inventory';

export * from './extract/ts/tsExtractor';
