// Counts ACTIVE time only (pure; runs under plain node).
//
// Every tap / move / key press credits the time since the previous one, but at
// most `capMs` for that gap: quick play counts in full, while an app left open
// on the table adds at most one cap's worth before the next touch. Time is only
// counted between start() and stop() (the tracker stops the clock when the page
// is hidden, on the profile picker and in the Parent zone).

export class ActivityClock {
  /** Time of the last counted activity (or of start()); null = stopped. */
  private lastAt: number | null = null
  private pendingMs = 0

  get running(): boolean {
    return this.lastAt !== null
  }

  /** Begin a counting session. The first tap then credits the time since now (capped). */
  start(now: number): void {
    if (this.lastAt === null) this.lastAt = now
  }

  /** A tap / move / key press. */
  tap(now: number, capMs: number): void {
    if (this.lastAt === null) {
      this.lastAt = now
      return
    }
    this.pendingMs += gapCredit(this.lastAt, now, capMs)
    this.lastAt = now
  }

  /** End the session: the time since the last activity counts (capped), then nothing more. */
  stop(now: number, capMs: number): void {
    if (this.lastAt === null) return
    this.pendingMs += gapCredit(this.lastAt, now, capMs)
    this.lastAt = null
  }

  /** Counted time not yet saved; resets it to 0. */
  take(): number {
    const ms = this.pendingMs
    this.pendingMs = 0
    return ms
  }

  peek(): number {
    return this.pendingMs
  }
}

/** One gap's credit: the real time, but never negative (clock moved back) and never above the cap. */
export function gapCredit(from: number, to: number, capMs: number): number {
  const gap = to - from
  if (!Number.isFinite(gap) || gap <= 0) return 0
  return Math.min(gap, Math.max(0, capMs))
}
