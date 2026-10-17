import { Suspense, lazy, useEffect } from 'react'
import { NavProvider, useNav } from './app/nav.tsx'
import type { Screen } from './types.ts'
import { useActiveProfile } from './store/appStore.ts'
import { ToastViewport } from './components/ui/index.ts'
import ProfileSelect from './screens/ProfileSelect.tsx'
import Home from './screens/Home.tsx'
import OpeningScreen from './screens/OpeningScreen.tsx'
import Trainer from './screens/Trainer.tsx'
import Shop from './screens/Shop.tsx'
import Trophies from './screens/Trophies.tsx'
import Parent from './screens/Parent.tsx'

// The engine screen pulls in the Stockfish wrapper; keep it out of the first load.
const PlayComputer = lazy(() => import('./screens/PlayComputer.tsx'))

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
      return <Shop params={screen} />
    case 'trophies':
      return <Trophies />
    case 'parent':
      return <Parent />
    case 'play':
      return (
        <Suspense fallback={<div className="screen-loading">Loading…</div>}>
          <PlayComputer key={JSON.stringify(screen)} params={screen} />
        </Suspense>
      )
  }
}

export default function App() {
  const profile = useActiveProfile()
  const initial: Screen = profile ? { name: 'home' } : { name: 'profiles' }
  return (
    <NavProvider initial={initial}>
      <CurrentScreen />
      <ToastViewport />
    </NavProvider>
  )
}
