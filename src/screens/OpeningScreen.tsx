// Placeholder — replaced in wave 2.
import type { Screen } from '../types.ts'
export default function OpeningScreen({ params }: { params: Extract<Screen, { name: 'opening' }> }) {
  return <div className="screen">Opening {params.openingId} (coming soon)</div>
}
