// builds test.c at -O0 and -O2 with zig cc, runs both on the JSPI host
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { wasmCoro } from './host-jspi.mjs';

const dir = new URL('.', import.meta.url).pathname;
const expect = '1:100 1:101 1:102 1:103 2:2000 2:2010 2:2020 2:2030';

let failed = false;
for (const opt of [ '-O0', '-O2' ]) {
  const out = `/tmp/wasm-coro-test${opt}.wasm`;
  execFileSync('zig', [ 'cc', '-target', 'wasm32-freestanding', opt, '-fno-sanitize=undefined', '-nostdlib',
    '-Wl,--no-entry', '-Wl,--export-memory', `${dir}test.c`, '-o', out ]);

  const got = [];
  const coro = wasmCoro();
  const { instance } = await WebAssembly.instantiate(readFileSync(out), {
    coro_v1: coro.imports,
    env: { print: (a, b) => got.push(`${a}:${b}`) }
  });
  coro.bind(instance);

  const ret = await WebAssembly.promising(instance.exports.run)();
  const ok = ret === 0 && got.join(' ') === expect;
  if (!ok) failed = true;
  console.log(`${opt}: ${ok ? 'pass' : 'FAIL'} (ret ${ret}) ${got.join(' ')}`);

  for (const name of Object.keys(instance.exports).filter(x => x.startsWith('trap_'))) {
    const err = await WebAssembly.promising(instance.exports[name])().then(() => null, e => e);
    const trapped = err instanceof WebAssembly.RuntimeError && err.message.startsWith('coro_v1:');
    if (!trapped) failed = true;
    console.log(`${opt}: ${trapped ? 'pass' : 'FAIL'} ${name} (${err?.message ?? 'no trap'})`);
  }
}

process.exit(failed ? 1 : 0);
