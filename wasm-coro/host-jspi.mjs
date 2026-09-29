// wasm-coro v1 reference host on JSPI (node >= 24, chrome >= 137). see SPEC.md
// usage: const coro = wasmCoro(); instantiate with { coro_v1: coro.imports };
//        coro.bind(instance); then call guest code through WebAssembly.promising
// cost: one promise + one microtask per switch, the JSPI floor.
const SUSPENDED = 0, RUNNING = 1, DONE = 2;

export const wasmCoro = () => {
  const coros = new Map();
  let next = 1, current = null, entry = null;
  const trap = msg => { throw new WebAssembly.RuntimeError(`coro_v1: ${msg}`); };

  const imports = {
    create: arg => {
      const h = next++;
      coros.set(h, { arg, state: SUSPENDED, started: false, parent: null, back: null, fail: null, wake: null });
      return h;
    },

    // settles when c suspends (0) or its entry returns (1)
    resume: new WebAssembly.Suspending(h => {
      const c = coros.get(h);
      if (!c || c.state !== SUSPENDED) trap('bad resume');

      c.parent = current;
      current = c;
      c.state = RUNNING;
      return new Promise((resolve, reject) => {
        c.back = resolve;
        c.fail = reject;
        if (c.started) return c.wake();
        c.started = true;
        entry(c.arg).then(() => {
          current = c.parent;
          c.state = DONE;
          c.back(1);
        }, e => {
          current = c.parent;
          c.state = DONE;
          c.fail(e);
        });
      });
    }),

    suspend: new WebAssembly.Suspending(() => {
      const c = current;
      if (!c) trap('suspend outside coroutine');
      current = c.parent;
      c.state = SUSPENDED;
      return new Promise(wake => {
        c.wake = wake;
        c.back(0);
      });
    }),

    destroy: h => {
      const c = coros.get(h);
      if (!c || c.state === RUNNING) trap('bad destroy');
      coros.delete(h); // a parked JSPI stack is freed by gc
    }
  };

  const bind = instance => {
    entry = WebAssembly.promising(instance.exports.__coro_entry);
  };

  return { imports, bind };
};
