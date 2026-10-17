// Module-level stack of open Modals (pure logic: no DOM access at import, so
// it also runs under plain node for tests).
//
// - Only the top-most modal reacts to Escape / Tab (one Escape closes one modal).
// - The body scroll lock is taken by the first modal that opens and released
//   by the last one that closes, restoring the overflow seen before ANY modal
//   opened - whatever order the modals close in.

/** The bit of `document.body` the scroll lock touches. */
export interface ScrollLockTarget {
  style: { overflow: string }
}

const stack: number[] = []
let nextId = 1
let lockTarget: ScrollLockTarget | null = null
let savedOverflow = ''

/** Register an opening modal; returns its id. Locks `target` scrolling if it is the first. */
export function pushModal(target?: ScrollLockTarget | null): number {
  const id = nextId++
  if (stack.length === 0 && target) {
    lockTarget = target
    savedOverflow = target.style.overflow
    target.style.overflow = 'hidden'
  }
  stack.push(id)
  return id
}

/** Unregister a modal (any position in the stack). Unlocks scrolling when none are left. */
export function popModal(id: number): void {
  const i = stack.indexOf(id)
  if (i === -1) return
  stack.splice(i, 1)
  if (stack.length === 0 && lockTarget) {
    lockTarget.style.overflow = savedOverflow
    lockTarget = null
    savedOverflow = ''
  }
}

/** True if `id` is the top-most open modal. */
export function isTopModal(id: number): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id
}

/** Number of open modals. */
export function openModalCount(): number {
  return stack.length
}
