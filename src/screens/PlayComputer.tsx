// Placeholder — replaced in wave 2.
import type { Screen } from '../types.ts'
export default function PlayComputer({ params }: { params: Extract<Screen, { name: 'play' }> }) {
  return <div className="screen">Play {params.openingId ?? ''} (coming soon)</div>
}
