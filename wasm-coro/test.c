// wasm-coro v1 test guest. build + run: node wasm-coro/test.mjs
#define WCORO_IMPLEMENTATION
#include "coro.h"

__attribute__((import_module("env"), import_name("print"))) void print(int32_t a, int32_t b);

static char stack_a[16384], stack_b[16384];
static wcoro a, b;
static int32_t out;

// uses shadow stack memory (address-taken array) across suspends
static void counter(void* arg) {
  volatile int32_t buf[64];
  const int32_t base = (int32_t)(uintptr_t)arg;
  for (int32_t i = 0; i < 64; i++) buf[i] = base + i;
  for (int32_t i = 0; i < 4; i++) {
    out = buf[i];
    wcoro_suspend();
  }
}

// nested: resumes b from inside a
static void outer(void* arg) {
  (void)arg;
  while (!wcoro_resume(&b)) {
    volatile int32_t x[8] = { out * 10 };
    out = x[0];
    wcoro_suspend();
  }
}

__attribute__((export_name("run")))
int32_t run(void) {
  // 1: plain generator
  if (!wcoro_init(&a, counter, (void*)100, stack_a, sizeof(stack_a))) return -1;
  while (!wcoro_resume(&a)) print(1, out);
  wcoro_free(&a);

  // 2: nested coroutines
  wcoro_init(&a, outer, 0, stack_a, sizeof(stack_a));
  wcoro_init(&b, counter, (void*)200, stack_b, sizeof(stack_b));
  while (!wcoro_resume(&a)) print(2, out);
  wcoro_free(&a);
  wcoro_free(&b);
  return 0;
}

// ---- each of these must trap ----
static void empty(void* arg) { (void)arg; }
static void resume_self(void* arg) { (void)arg; wcoro_resume(&a); }

__attribute__((export_name("trap_suspend_on_main")))
void trap_suspend_on_main(void) { coro_suspend(); }

__attribute__((export_name("trap_resume_done")))
void trap_resume_done(void) {
  wcoro_init(&a, empty, 0, stack_a, sizeof(stack_a));
  wcoro_resume(&a);
  wcoro_resume(&a);
}

__attribute__((export_name("trap_resume_running")))
void trap_resume_running(void) {
  wcoro_init(&a, resume_self, 0, stack_a, sizeof(stack_a));
  wcoro_resume(&a);
}

__attribute__((export_name("trap_destroy_bad")))
void trap_destroy_bad(void) { coro_destroy(12345); }
