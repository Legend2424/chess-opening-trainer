// Small device checks shared by the Parent zone (no React).

/** iPhone / iPad (iPadOS reports itself as a Mac with touch). */
export const IS_IOS: boolean = (() => {
  try {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  } catch {
    return false
  }
})()

/** Running as the Home Screen app (not in a Safari tab). */
export function isStandalone(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

/** A new recovery code: 8 easy-to-read characters, shown as "ABCD-EFGH". */
export function newRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(8)
  try {
    crypto.getRandomValues(bytes)
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
  return `${chars.slice(0, 4)}-${chars.slice(4)}`
}

/** "Fri 17 Oct, 15:30" */
export function whenText(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return new Date(at).toString()
  }
}
