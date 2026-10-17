import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import { NavProvider, useNav } from './app/nav.tsx'
import { ErrorBoundary } from './app/ErrorBoundary.tsx'
import { setActivityScreen } from './app/activityTracker.ts'
import type { Screen } from './types.ts'
import { useActiveProfile } from './store/appStore.ts'
import { ToastViewport } from './components/ui/index.ts'
import ProfileSelect from './screens/ProfileSelect.tsx'
import Home from './screens/Home.tsx'
import OpeningScreen from './screens/OpeningScreen.tsx'
import Trainer from './screens/Trainer.tsx'

// Screens a kid doesn't need on the first tap load on demand (smaller first
// download). A chunk that fails to load (new deploy, offline) is retried once
// with a page reload (main.tsx) and otherwise caught by the ErrorBoundary.
const PlayComputer = lazy(() => import('./screens/PlayComputer.tsx'))
const Shop = lazy(() => import('./screens/Shop.tsx'))
const Trophies = lazy(() => import('./screens/Trophies.tsx'))
const Parent = lazy(() => import('./screens/Parent.tsx'))

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="screen-loading">Loading…</div>}>{children}</Suspense>
}

// Screen conventions (every screen file default-exports its component):
//  - screens with parameters receive them as `params` (the matching Screen variant);
//  - App keys parameterised screens by their params so a new target remounts cleanly;
//  - navigation goes through useNav() (src/app/nav.tsx).
function CurrentScreen() {
  const { screen, reset } = useNav()
  const profile = useActiveProfile()

  // Every screen except the profile picker and parent zone needs a player.
  const needsProfile = screen.name !== 'profiles' && screen.name !== 'parent'
  useEffect(() => {
    if (needsProfile && !profile) reset({ name: 'profiles' })
  }, [needsProfile, profile, reset])
  // Active-time counting pauses on the profile picker and in the Parent zone.
  useEffect(() => setActivityScreen(screen.name), [screen.name])
  if (needsProfile && !profile) return null

  switch (screen.name) {
    case 'profiles':
      return <ProfileSelect />
    case 'home':
      return <Home />
    case 'opening':
      return <OpeningScreen key={screen.openingId} params={screen} />
    case 'train':
      return <Trainer key={JSON.stringify(screen)} params={screen} />
    case 'shop':
      return (
        <Lazy>
          <Shop params={screen} />
        </Lazy>
      )
    case 'trophies':
      return (
        <Lazy>
          <Trophies />
        </Lazy>
      )
    case 'parent':
      return (
        <Lazy>
          <Parent />
        </Lazy>
      )
    case 'play':
      return (
        <Lazy>
          <PlayComputer key={JSON.stringify(screen)} params={screen} />
        </Lazy>
      )
  }
}

export default function App() {
  const profile = useActiveProfile()
  const initial: Screen = profile ? { name: 'home' } : { name: 'profiles' }
  return (
    <ErrorBoundary>
      <NavProvider initial={initial}>
        <CurrentScreen />
        <ToastViewport />
      </NavProvider>
    </ErrorBoundary>
  )
}
