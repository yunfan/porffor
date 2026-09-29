# wasm-coro v1 (draft)

A tiny host interface that gives wasm modules stackful coroutines.
The goal is to let `async`/`await`, generators and fibers compiled from C
(or anything else) really suspend on any wasm runtime, with as little
work for the runtime as possible.

The whole interface is 4 imports and 1 export. All values are `i32`.

## Interface

Imports, module name `coro_v1`:

| name      | type          | meaning                                           |
|-----------|---------------|---------------------------------------------------|
| `create`  | `(i32) -> i32`| make a coroutine for `arg`, return a handle (0 = failed) |
| `resume`  | `(i32) -> i32`| run coroutine until it suspends (returns 0) or ends (returns 1) |
| `suspend` | `() -> ()`    | pause the current coroutine, go back to its resumer |
| `destroy` | `(i32) -> ()` | free a coroutine that is not running              |

Export required from the guest:

| name           | type        | meaning                                   |
|----------------|-------------|-------------------------------------------|
| `__coro_entry` | `(i32) -> ()` | body of every coroutine, gets `arg` from `create` |

## Semantics

A coroutine is a separate wasm call stack. It is in one of 3 states:

- **suspended**: just created, or called `suspend`.
- **running**: on the current chain of stacks (it is executing, or it is
  waiting inside a `resume` call it made).
- **done**: `__coro_entry` returned.

1. `create(arg)` makes a new suspended coroutine and returns a non-zero
   handle, unique among live coroutines of this instance. No guest code
   runs. It returns 0 if the host cannot make one (no support, no memory).
2. `resume(h)` makes `h` running and switches to its stack. The first
   resume calls `__coro_entry(arg)`. Later resumes return from the
   `suspend` call that paused it. `resume` returns 0 when `h` calls
   `suspend`, and 1 when `__coro_entry` returns (`h` is now done).
3. `suspend()` makes the current coroutine suspended and returns from the
   `resume` call that last ran it.
4. `destroy(h)` frees `h`. No guest code runs, nothing is unwound. `h` is
   invalid after this.
5. A coroutine belongs to the thread that created it. Only that thread
   may resume or destroy it.
6. Running out of stack inside a coroutine traps, the same as on the
   main stack.

Coroutines are asymmetric: `suspend` always goes back to the resumer. A
coroutine may resume other coroutines (nesting).

The imports may be provided by the host or by another wasm module (an
adapter). Hosts get `__coro_entry` from the guest's exports after
instantiation.

## Cost model

The interface is built so that it costs nothing when unused, and little
when used:

- Normal wasm code is never changed or instrumented. Only code that calls
  these imports pays anything.
- `resume` and `suspend` SHOULD be one stack switch each, with no
  allocation and no access to guest memory.
- `create` and `destroy` SHOULD be cheap. Guests may make one coroutine
  per async call, so hosts SHOULD reuse the stacks of destroyed
  coroutines and commit stack memory lazily.
- Hosts SHOULD allow at least 64 KiB of stack per coroutine and at least
  1024 live coroutines.

## Traps

The host must trap on:

- `resume(h)` when `h` is running, done, or not a live handle.
- `destroy(h)` when `h` is running or not a live handle.
- `suspend()` when no coroutine is running (called from the main stack).
- a trap or exception that leaves `__coro_entry`. It traps the resumer.

The host may trap on:

- `suspend()` when a host function frame sits between the coroutine entry
  and the `suspend` call (guest -> host -> guest -> `suspend`).

## Guest duties

The host only switches the wasm engine stack. Everything in linear memory
belongs to the guest:

- **Data:** pass values through linear memory. `arg` is usually a pointer.
- **Shadow stack:** C compilers keep a stack in linear memory
  (`__stack_pointer`). It is one global shared by all stacks, so the guest
  must give each coroutine its own shadow stack region, set it in
  `__coro_entry`, and save/restore `__stack_pointer` around each `resume`
  and `suspend` call. The region's top must be 16-byte aligned (clang
  assumes it; with 8, `long double` code like `printf("%g")` breaks).
  `coro.h` does this.
- **Exceptions:** a C `longjmp` or wasm exception must not cross a
  coroutine boundary. Catch it inside the coroutine.
- **Fallback:** if `create` returns 0, the guest should use a path that
  does not suspend (for example, run to completion or report an error).

Hosts without support can provide stubs: `create` returns 0 and the other
3 imports trap.

## Host notes (not normative)

Pick the first path that fits the runtime. Costs are per resume+suspend
pair. They are rough estimates, except JSPI, which was measured.

1. **Interpreter with its own frame stack** (any language: C, Rust, Go,
   Java, Python, JS, ...). A coroutine is one more frame stack. `resume`
   pushes it as the current one, `suspend` pops back. No OS or language
   support needed. Cost: about a normal call.
2. **Engine with the stack-switching proposal.** Provide the imports from
   a small adapter module: `create` = `cont.new` on `__coro_entry` (the
   host passes it to the adapter once after instantiation), `resume` =
   `resume` with a handler for one tag, `suspend` = `suspend` on that tag.
   The adapter keeps one continuation per handle in a table. Cost: about
   a normal call.
3. **Engine that runs wasm on the native stack** (JIT, AOT, or a
   recursive interpreter in C/C++/Rust/Zig). One native fiber per
   coroutine (asm switch, `ucontext`, Boost.Context, `corosensei`, ...).
   The engine must also switch its own per-stack state: stack limit,
   trap/signal handler info, backtrace chain. Cost: tens of ns.
4. **Language with no stack control** (Go, JVM, .NET) on top of an engine
   of kind 3. One goroutine / virtual thread per coroutine, with strict
   hand-off: exactly one runs at a time. `destroy` wakes the parked one
   with an internal trap, which runs no guest code. Cost: about 1 µs.
5. **JS host with JSPI** (browsers, Node 24+, no flags). `resume` and
   `suspend` are `WebAssembly.Suspending`, each coroutine is a
   `WebAssembly.promising(__coro_entry)` call, and the guest's main entry
   must also be called through `promising`. See `host-jspi.mjs`
   (about 70 lines). Cost: one promise + one microtask, about 0.3 µs
   measured on Node 24.
6. **None of these.** Provide stubs (`create` returns 0). The guest can
   still use Asyncify or a state-machine transform on its own, with no
   host help, at the cost of bigger and slower code.
