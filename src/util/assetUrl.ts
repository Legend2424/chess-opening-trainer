/**
 * Resolve a file in /public against Vite's base URL, so it works under a GitHub
 * Pages sub-path. Tolerates a base without a trailing slash
 * (DEPLOY_BASE=/chess-opening-trainer would otherwise give
 * "/chess-opening-trainerengine/…"). Safe under plain node (base "/").
 */
export function assetUrl(path: string): string {
  let base = '/'
  try {
    base = import.meta.env?.BASE_URL ?? '/'
  } catch {
    base = '/'
  }
  if (!base.endsWith('/')) base += '/'
  return base + path.replace(/^\/+/, '')
}
