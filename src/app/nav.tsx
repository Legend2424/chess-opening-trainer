import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Screen } from '../types.ts'

interface NavValue {
  screen: Screen
  /** Push a new screen. */
  go: (s: Screen) => void
  /** Replace the current screen (no history entry). */
  replace: (s: Screen) => void
  /** Pop back to the previous screen (falls back to home/profiles). */
  back: () => void
  /** Clear history and show this screen. */
  reset: (s: Screen) => void
}

const NavContext = createContext<NavValue | null>(null)

export function NavProvider({ initial, children }: { initial: Screen; children: ReactNode }) {
  const [stack, setStack] = useState<Screen[]>([initial])

  const go = useCallback((s: Screen) => setStack((st) => [...st, s]), [])
  const replace = useCallback((s: Screen) => setStack((st) => [...st.slice(0, -1), s]), [])
  const reset = useCallback((s: Screen) => setStack([s]), [])
  const back = useCallback(
    () =>
      setStack((st) => {
        if (st.length > 1) return st.slice(0, -1)
        const top = st[0]
        return [top.name === 'profiles' || top.name === 'home' ? top : { name: 'home' }]
      }),
    [],
  )

  const value = useMemo<NavValue>(
    () => ({ screen: stack[stack.length - 1], go, replace, back, reset }),
    [stack, go, replace, back, reset],
  )
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}

export function useNav(): NavValue {
  const v = useContext(NavContext)
  if (!v) throw new Error('useNav must be used inside <NavProvider>')
  return v
}
