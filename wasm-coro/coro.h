// wasm-coro v1 guest header (clang, wasm32). see SPEC.md
// define WCORO_IMPLEMENTATION in exactly one file to get __coro_entry.
#ifndef WASM_CORO_H
#define WASM_CORO_H

#include <stdint.h>

// ---- raw imports ----
#define WCORO_IMPORT(n) __attribute__((import_module("coro_v1"), import_name(#n)))
WCORO_IMPORT(create)  int32_t coro_create(int32_t arg);
WCORO_IMPORT(resume)  int32_t coro_resume(int32_t h);
WCORO_IMPORT(suspend) void coro_suspend(void);
WCORO_IMPORT(destroy) void coro_destroy(int32_t h);

// ---- helper: C coroutines, each with its own shadow stack ----
typedef struct wcoro {
  int32_t h;
  void (*fn)(void*);
  void* arg;
  char* stack_top; // high end of this coroutine's shadow stack
} wcoro;

static inline void* wcoro_get_sp(void) {
  void* sp;
  __asm__ volatile(".globaltype __stack_pointer, i32\nglobal.get __stack_pointer\nlocal.set %0" : "=r"(sp));
  return sp;
}

static inline void wcoro_set_sp(void* sp) {
  __asm__ volatile(".globaltype __stack_pointer, i32\nlocal.get %0\nglobal.set __stack_pointer" :: "r"(sp));
}

// returns 0 if the host has no coroutine support
static inline int wcoro_init(wcoro* c, void (*fn)(void*), void* arg, void* stack, uint32_t size) {
  c->fn = fn;
  c->arg = arg;
  c->stack_top = (char*)(((uintptr_t)stack + size) & ~(uintptr_t)15);
  c->h = coro_create((int32_t)(uintptr_t)c);
  return c->h != 0;
}

// run c until it suspends (returns 0) or finishes (returns 1)
static inline int wcoro_resume(wcoro* c) {
  void* sp = wcoro_get_sp();
  const int32_t done = coro_resume(c->h);
  wcoro_set_sp(sp);
  return done;
}

static inline void wcoro_suspend(void) {
  void* sp = wcoro_get_sp();
  coro_suspend();
  wcoro_set_sp(sp);
}

static inline void wcoro_free(wcoro* c) {
  coro_destroy(c->h);
  c->h = 0;
}

#ifdef WCORO_IMPLEMENTATION
static void __attribute__((noinline)) wcoro_run(wcoro* c) {
  c->fn(c->arg);
}

__attribute__((export_name("__coro_entry")))
void __coro_entry(int32_t arg) {
  wcoro* c = (wcoro*)(uintptr_t)arg;
  wcoro_set_sp(c->stack_top);
  wcoro_run(c);
}
#endif

#endif
