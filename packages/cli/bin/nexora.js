#!/usr/bin/env node
// The CLI is written in TypeScript using only erasable syntax and runs directly on Node's built-in
// type stripping (Node >= 22.18 / >= 23.6), so it needs no build step before first use.
//
// Node 23.x still labels type stripping experimental and warns on every run. That one warning is
// expected here, so it is filtered out; every other warning is passed through unchanged.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const message = typeof warning === 'string' ? warning : warning?.message;
  if (
    typeof message === 'string' &&
    message.startsWith('Type Stripping is an experimental feature')
  ) {
    return;
  }
  emitWarning(warning, ...rest);
};

// Dynamic import so the filter is installed before the TypeScript entry point is loaded.
await import('../src/main.ts');
