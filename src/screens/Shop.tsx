// Placeholder — replaced in wave 2.
import type { Screen } from '../types.ts'
export default function Shop({ params }: { params: Extract<Screen, { name: 'shop' }> }) {
  return <div className="screen">Shop {params.tab ?? ''} (coming soon)</div>
}
