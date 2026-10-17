// Placeholder — replaced in wave 2.
import type { Screen } from '../types.ts'
export default function Trainer({ params }: { params: Extract<Screen, { name: 'train' }> }) {
  return <div className="screen">Trainer {params.openingId} (coming soon)</div>
}
