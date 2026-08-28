// Episode 17, Story 17.1's explicit acceptance criterion: "saved to
// browser storage automatically, debounced rather than on every
// keystroke." A tiny, dependency-free debounce — this codebase has no
// existing utility library to reach for instead.

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, waitMs: number): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Args) => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), waitMs)
  }
}
