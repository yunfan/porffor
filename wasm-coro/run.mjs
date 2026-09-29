#!/usr/bin/env node
// runs a wasm32-wasip1 command module with wasm-coro v1 support (on JSPI)
// usage: node run.mjs file.wasm [args...]
import { readFileSync } from 'node:fs';
import { wasmCoro } from './host-jspi.mjs';

export const runWasm = async (bytes, args = [], name = 'main.wasm') => {
  // node warns that wasi is experimental on every run, which would mix into program output
  const emitWarning = process.emitWarning;
  process.emitWarning = (msg, ...rest) => String(msg).includes('WASI') ? undefined : emitWarning.call(process, msg, ...rest);
  try {
    return await run(bytes, args, name);
  } finally {
    process.emitWarning = emitWarning;
  }
};

const run = async (bytes, args, name) => {
  const { WASI } = await import('node:wasi');
  const wasi = new WASI({
    version: 'preview1',
    args: [ name, ...args ],
    env: process.env,
    preopens: { '/': '/', '.': process.cwd() },
    returnOnExit: true
  });

  // node's wasi functions are v8 fast api calls, which must not run on a jspi
  // side stack. a plain js wrapper makes v8 hop back to the central stack
  const wasiImports = {};
  for (const [ mod, fns ] of Object.entries(wasi.getImportObject())) {
    wasiImports[mod] = {};
    for (const [ name, fn ] of Object.entries(fns)) wasiImports[mod][name] = (...args) => fn(...args);
  }

  const coro = wasmCoro();
  const { instance } = await WebAssembly.instantiate(bytes, {
    ...wasiImports,
    coro_v1: coro.imports
  });
  if (instance.exports.__coro_entry) coro.bind(instance);

  // _start may suspend (await), so it must run through promising. node's wasi
  // only runs _start synchronously, so hand it a wrapper and wait for the real run
  const start = WebAssembly.promising(instance.exports._start);
  let running;
  wasi.start({ exports: { ...instance.exports, _start: () => { running = start(); } } });

  try {
    await running;
    return 0;
  } catch (e) {
    // proc_exit throws node's kExitCode symbol and stores the code under it
    if (typeof e === 'symbol' && typeof wasi[e] === 'number') return wasi[e];
    throw e;
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const [ file, ...args ] = process.argv.slice(2);
  if (!file) {
    console.error('usage: run.mjs file.wasm [args...]');
    process.exit(1);
  }
  process.exitCode = await runWasm(readFileSync(file), args, file);
}
