// Parent zone sections: reward requests, rewards editor, coins, training
// settings and players. Every change goes through `actions.*` (which also
// extends the parent's sliding PIN session).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Profile, RewardDef } from '../../types.ts'
import { actions, useAppData } from '../../store/appStore.ts'
import { levelOf, pendingRedemptions } from '../../store/profileOps.ts'
import { itemsOfKind } from '../../store/catalog.ts'
import { levelForXp } from '../../store/levels.ts'
import { DEFAULT_MAX_PLY, OPENINGS } from '../../data/openings.ts'
import { previewRepertoire, useRepertoires } from '../../chess/useRepertoires.ts'
import { Avatar, Button, Card, Chip, CoinBadge, Modal, Toggle, cx, toast } from '../../components/ui/index.ts'
import { ConfirmModal, plural, timeAgo, useNow } from './common.tsx'

// ---------------------------------------------------------------------------
// Small form helpers
// ---------------------------------------------------------------------------

/**
 * Labelled form field. Wraps a single input in a <label>; pass `group` when the
 * content is several buttons (a <label> would forward taps on its text to the
 * first button).
 */
export function Field({
  label,
  hint,
  children,
  className,
  group,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
  group?: boolean
}) {
  const inner = (
    <>
      <span className="pz-field__label">{label}</span>
      {children}
      {hint != null && <span className="pz-field__hint">{hint}</span>}
    </>
  )
  return group ? (
    <div className={cx('pz-field', className)} role="group">
      {inner}
    </div>
  ) : (
    <label className={cx('pz-field', className)}>{inner}</label>
  )
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ value: T; label: ReactNode }>
  value: T | null
  onChange: (v: T) => void
  ariaLabel?: string
}) {
  return (
    <div className="pz-seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className="pz-seg__btn"
          aria-pressed={o.value === value}
          onClick={() => {
            if (o.value !== value) onChange(o.value)
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function toInt(s: string): number {
  const n = Number(String(s).trim())
  return Number.isFinite(n) ? Math.floor(n) : NaN
}

function SectionHead({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="pz-section-head">
      <h2 className="meta-section-title">
        <span aria-hidden>{icon}</span> {title}
      </h2>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

type PendingEntry = ReturnType<typeof pendingRedemptions>[number]

/** How long an answered request stays in place (buttons gone) before it leaves the list. */
const SETTLED_MS = 1600
/** An approved request stays a little longer, with an "Undo" button. */
const SETTLED_APPROVED_MS = 5000
/** Approve/Decline taps are ignored this long after any answer (double-tap guard). */
const TAP_GUARD_MS = 700

export function RequestsSection() {
  const data = useAppData()
  const now = useNow()
  const pending = pendingRedemptions(data)
  const [declining, setDeclining] = useState<PendingEntry | null>(null)
  // Requests answered a moment ago stay where they were for SETTLED_MS, so the
  // next request never slides under a finger that is still tapping.
  const [settled, setSettled] = useState<Array<{ entry: PendingEntry; approved: boolean }>>([])
  const guardUntil = useRef(0)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  const byId = useMemo(() => new Map(data.profiles.map((p) => [p.id, p])), [data.profiles])

  const rows: Array<{ entry: PendingEntry; settled?: boolean; approved?: boolean }> = [
    ...pending.map((entry) => ({ entry })),
    ...settled
      .filter((s) => !pending.some((p) => p.redemption.id === s.entry.redemption.id))
      .map((s) => ({ entry: s.entry, settled: true, approved: s.approved })),
  ].sort((a, b) => a.entry.redemption.requestedAt - b.entry.redemption.requestedAt)

  const recent = data.profiles
    .flatMap((p) => p.redemptions.filter((r) => r.status !== 'pending').map((r) => ({ p, r })))
    .sort((a, b) => (b.r.resolvedAt ?? b.r.requestedAt) - (a.r.resolvedAt ?? a.r.requestedAt))
    .slice(0, 8)

  const resolve = (entry: PendingEntry, approve: boolean) => {
    const { profileId, profileName: name, redemption } = entry
    guardUntil.current = Date.now() + TAP_GUARD_MS
    const r = actions.resolveRedemption(profileId, redemption.id, approve)
    if (!r.ok) {
      toast.error(r.message ?? 'That request was already answered.')
      return
    }
    setSettled((s) => [...s, { entry, approved: approve }])
    timers.current.push(
      window.setTimeout(
        () => setSettled((s) => s.filter((x) => x.entry.redemption.id !== redemption.id)),
        approve ? SETTLED_APPROVED_MS : SETTLED_MS,
      ),
    )
    if (approve) toast.success(`Approved! Time to give ${name} the ${redemption.rewardName}.`, '✅')
    else toast.info(`Declined — ${name}'s coins went back.`, '↩️')
  }
  /** True when a tap lands too soon after the previous answer (likely a double tap). */
  const guarded = () => Date.now() < guardUntil.current

  /** "Undo" a moment after approving: the request waits again. */
  const undoApprove = (entry: PendingEntry) => {
    const r = actions.unresolveRedemption(entry.profileId, entry.redemption.id)
    setSettled((s) => s.filter((x) => x.entry.redemption.id !== entry.redemption.id))
    if (r.ok) toast.info(`Undone — ${entry.profileName}'s request is waiting again.`, '↩️')
    else toast.error(r.message ?? 'Too late to undo that one.')
  }

  return (
    <div className="pz-stack">
      <Card padding="sm" className="pz-card">
        <SectionHead icon="📬" title="Waiting for you">
          <Chip tone={pending.length ? 'gold' : 'gray'}>{pending.length}</Chip>
        </SectionHead>
        {rows.length === 0 ? (
          <div className="meta-empty">
            <span className="meta-empty__icon">👍</span>
            No requests waiting. Coins are set aside when a kid asks, and refunded if you decline.
          </div>
        ) : (
          <ul className="pz-list">
            {rows.map(({ entry, settled: done, approved }) => {
              const { profileId, profileName, redemption: r } = entry
              const p = byId.get(profileId)
              return (
                <li key={r.id} className={cx('pz-req', done && 'is-settled', done && (approved ? 'is-approved' : 'is-declined'))}>
                  {p && <Avatar emoji={p.avatar} color={p.color} size="md" />}
                  <div className="pz-req__text">
                    <span className="pz-req__title">
                      <b>{profileName}</b> asked for {r.emoji} {r.rewardName}
                    </span>
                    <span className="pz-req__meta">
                      {plural(r.cost, 'coin')} {done && !approved ? 'refunded' : 'set aside'} · {timeAgo(r.requestedAt, now)}
                    </span>
                  </div>
                  {done ? (
                    <span className="pz-req__done" role="status">
                      {approved ? '✅ Approved' : '↩️ Declined'}
                      {approved && (
                        <Button size="sm" variant="secondary" className="pz-req__undo" onClick={() => undoApprove(entry)}>
                          Undo
                        </Button>
                      )}
                    </span>
                  ) : (
                    <div className="pz-req__actions">
                      <Button variant="success" icon="✅" onClick={() => !guarded() && resolve(entry, true)}>
                        Approve
                      </Button>
                      <Button variant="secondary" icon="↩️" onClick={() => !guarded() && setDeclining(entry)}>
                        Decline
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {recent.length > 0 && (
        <Card padding="sm" className="pz-card">
          <SectionHead icon="🗂️" title="Recently answered" />
          <ul className="pz-list pz-list--compact">
            {recent.map(({ p, r }) => (
              <li key={r.id} className="pz-hist">
                <span aria-hidden>{r.status === 'approved' ? '✅' : '↩️'}</span>
                <span className="pz-hist__text">
                  <b>{p.name}</b> · {r.emoji} {r.rewardName} · {plural(r.cost, 'coin')}
                </span>
                <span className="pz-hist__when">
                  {r.status === 'approved' ? 'approved' : 'declined'} {timeAgo(r.resolvedAt ?? r.requestedAt, now)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmModal
        open={!!declining}
        title="Decline this request?"
        confirmLabel="Decline"
        variant="danger"
        onCancel={() => setDeclining(null)}
        onConfirm={() => {
          if (declining) resolve(declining, false)
          setDeclining(null)
        }}
      >
        {declining && (
          <p>
            {declining.profileName} asked for <b>{declining.redemption.rewardName}</b>. The{' '}
            <b>{plural(declining.redemption.cost, 'coin')}</b> go straight back to {declining.profileName}.
          </p>
        )}
      </ConfirmModal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rewards editor
// ---------------------------------------------------------------------------

interface RewardDraft {
  emoji: string
  name: string
  cost: string
  max: string
}

function draftOf(r: RewardDef): RewardDraft {
  return { emoji: r.emoji, name: r.name, cost: String(r.cost), max: r.maxPerWeek === undefined ? '' : String(r.maxPerWeek) }
}

/** Validate a draft; returns an error message or the cleaned values. */
function checkDraft(d: RewardDraft): { error: string } | { name: string; emoji: string; cost: number; maxPerWeek: number | undefined } {
  const name = d.name.replace(/\s+/g, ' ').trim()
  if (!name) return { error: 'Give the reward a name.' }
  const cost = toInt(d.cost)
  if (!(cost >= 1 && cost <= 1_000_000)) return { error: 'Cost must be a whole number of coins (1 or more).' }
  let maxPerWeek: number | undefined
  if (d.max.trim() !== '') {
    const m = toInt(d.max)
    if (!(m >= 1 && m <= 100)) return { error: 'Max per week must be 1–100 (or empty for no limit).' }
    maxPerWeek = m
  }
  return { name, emoji: d.emoji.trim() || '🎁', cost, maxPerWeek }
}

const QUICK_EMOJI = ['🎴', '📺', '🎮', '🍦', '🎬', '🍕', '🧸', '🎨', '📚', '🛝']

export function RewardsSection() {
  const data = useAppData()
  const [removing, setRemoving] = useState<RewardDef | null>(null)
  return (
    <div className="pz-stack">
      <Card padding="sm" className="pz-card">
        <SectionHead icon="🎁" title="Real rewards" />
        <p className="pz-help">
          Kids spend coins on these in the Shop's 🎁 Rewards tab. Coins are set aside when they ask and refunded if you decline. The
          weekly limit counts requests per child over the last 7 days.
        </p>
        <div className="pz-rewards">
          {data.parent.rewards.map((r) => (
            <RewardEditor key={r.id} reward={r} onRemove={() => setRemoving(r)} />
          ))}
        </div>
      </Card>
      <AddReward />
      <ConfirmModal
        open={!!removing}
        title="Remove this reward?"
        confirmLabel="Remove"
        variant="danger"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) {
            const r = actions.removeReward(removing.id)
            if (r.ok) toast.success(`${removing.name} removed.`, '🗑️')
            else toast.error(r.message ?? 'Could not remove it.')
          }
          setRemoving(null)
        }}
      >
        {removing && (
          <p>
            <b>
              {removing.emoji} {removing.name}
            </b>{' '}
            will disappear from the shop. Requests already waiting can still be approved or declined.
          </p>
        )}
      </ConfirmModal>
    </div>
  )
}

function sameDraft(a: RewardDraft, b: RewardDraft): boolean {
  return a.emoji === b.emoji && a.name === b.name && a.cost === b.cost && a.max === b.max
}

function RewardEditor({ reward, onRemove }: { reward: RewardDef; onRemove: () => void }) {
  const base = draftOf(reward)
  const [draft, setDraft] = useState<RewardDraft>(base)
  // Follow the saved values only when they really change (a save here, a
  // backup import…). Flipping "Shown in the shop" creates a new reward object
  // with the same fields and must not throw away an edit in progress.
  const [savedBase, setSavedBase] = useState<RewardDraft>(base)
  if (!sameDraft(savedBase, base)) {
    setSavedBase(base)
    setDraft(base)
  }
  const dirty = !sameDraft(draft, base)
  const set = (k: keyof RewardDraft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }))

  const save = () => {
    const c = checkDraft(draft)
    if ('error' in c) {
      toast.error(c.error)
      return
    }
    const r = actions.setReward({ id: reward.id, enabled: reward.enabled, ...c })
    if (r.ok) toast.success(`${c.name} saved.`, '💾')
    else toast.error(r.message ?? 'Could not save that.')
  }

  return (
    <div className={cx('pz-reward', !reward.enabled && 'is-off')}>
      <div className="pz-reward__row">
        <Field label="Emoji" className="pz-field--emoji">
          <input className="pz-input pz-input--emoji" value={draft.emoji} onChange={set('emoji')} maxLength={8} aria-label="Reward emoji" />
        </Field>
        <Field label="Name" className="pz-field--grow">
          <input className="pz-input" value={draft.name} onChange={set('name')} maxLength={40} />
        </Field>
        <Field label="Cost (coins)" className="pz-field--num">
          <input className="pz-input" value={draft.cost} onChange={set('cost')} inputMode="numeric" />
        </Field>
        <Field label="Max / week" className="pz-field--num" hint="empty = no limit">
          <input className="pz-input" value={draft.max} onChange={set('max')} inputMode="numeric" placeholder="∞" />
        </Field>
      </div>
      <div className="pz-reward__row pz-reward__row--actions">
        <Toggle
          checked={reward.enabled}
          onChange={(on) => {
            // Saves only the switch: unsaved edits above stay in the fields.
            const r = actions.setReward({ ...reward, enabled: on })
            if (!r.ok) toast.error(r.message ?? 'Could not change that.')
          }}
          label={reward.enabled ? 'Shown in the shop' : 'Hidden from the shop'}
          onIcon="✓"
        />
        <span className="spacer" />
        {reward.id !== 'pokemon-pack' && (
          <Button variant="ghost" size="sm" icon="🗑️" onClick={onRemove} className="pz-btn-quiet">
            Remove
          </Button>
        )}
        <Button size="sm" variant="primary" icon="💾" disabled={!dirty} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  )
}

function AddReward() {
  const empty: RewardDraft = { emoji: '📺', name: '', cost: '300', max: '' }
  const [draft, setDraft] = useState<RewardDraft>(empty)
  const set = (k: keyof RewardDraft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }))
  const add = () => {
    const c = checkDraft(draft)
    if ('error' in c) {
      toast.error(c.error)
      return
    }
    const r = actions.addReward({ ...c, enabled: true })
    if (r.ok) {
      toast.success(`${c.emoji} ${c.name} added to the shop!`)
      setDraft(empty)
    } else toast.error(r.message ?? 'Could not add that reward.')
  }
  return (
    <Card padding="sm" className="pz-card">
      <SectionHead icon="➕" title="Add a reward" />
      <p className="pz-help">For example “30 min screen time”, “Ice cream trip” or “Pick the movie”.</p>
      <div className="pz-emoji-picks" role="group" aria-label="Pick an emoji">
        {QUICK_EMOJI.map((e) => (
          <button key={e} type="button" className="pz-emoji-pick" aria-pressed={draft.emoji === e} onClick={() => setDraft((d) => ({ ...d, emoji: e }))}>
            {e}
          </button>
        ))}
      </div>
      <div className="pz-reward__row">
        <Field label="Emoji" className="pz-field--emoji">
          <input className="pz-input pz-input--emoji" value={draft.emoji} onChange={set('emoji')} maxLength={8} aria-label="New reward emoji" />
        </Field>
        <Field label="Name" className="pz-field--grow">
          <input className="pz-input" value={draft.name} onChange={set('name')} maxLength={40} placeholder="30 min screen time" />
        </Field>
        <Field label="Cost (coins)" className="pz-field--num">
          <input className="pz-input" value={draft.cost} onChange={set('cost')} inputMode="numeric" />
        </Field>
        <Field label="Max / week" className="pz-field--num" hint="empty = no limit">
          <input className="pz-input" value={draft.max} onChange={set('max')} inputMode="numeric" placeholder="∞" />
        </Field>
      </div>
      <div className="pz-reward__row pz-reward__row--actions">
        <span className="spacer" />
        <Button variant="gold" icon="➕" onClick={add} disabled={!draft.name.trim()}>
          Add reward
        </Button>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Coins
// ---------------------------------------------------------------------------

export function CoinsSection() {
  const data = useAppData()
  return (
    <div className="pz-stack">
      <p className="pz-help pz-help--on-bg">
        Gifts count toward the kid's level (like earned coins). Removing coins never goes below zero and doesn't lower the level. Tap
        “Undo” on the message right after a gift or removal to take it back.
      </p>
      <div className="pz-grid-2">
        {data.profiles.map((p) => (
          <CoinsCard key={p.id} profile={p} />
        ))}
      </div>
    </div>
  )
}

/** Gifts this big ask first: they raise the level for good. */
const BIG_GIFT = 1000

function CoinsCard({ profile }: { profile: Profile }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [confirmGift, setConfirmGift] = useState(false)
  const n = toInt(amount)
  const valid = n >= 1 && n <= 100_000

  const levelNow = levelOf(profile)
  const levelAfter = levelForXp(profile.xp + (valid ? n : 0))

  const apply = (sign: 1 | -1, confirmed = false) => {
    if (!valid) {
      toast.error('Type how many coins (1 – 100,000).')
      return
    }
    // Big gifts, and any gift that would raise the level, ask first.
    if (sign > 0 && (n >= BIG_GIFT || levelAfter.level > levelNow.level) && !confirmed) {
      setConfirmGift(true)
      return
    }
    // The store never goes below zero: say what was really taken.
    const taken = Math.min(n, profile.coins)
    const r = actions.adjustCoins(profile.id, sign * n, note)
    if (!r.ok) {
      toast.error(r.message ?? 'That did not work.')
      return
    }
    const id = profile.id
    const who = profile.name
    if (sign > 0) {
      toast.show({
        kind: 'coin',
        title: `+${n.toLocaleString()} coins for ${who}`,
        message: note.trim() || 'Gift from a parent',
        emoji: '🎁',
        duration: 6000,
        action: {
          label: 'Undo',
          onClick: () => {
            const u = actions.undoGift(id, n)
            if (u.ok) toast.info(`Gift undone — ${who}'s coins and level are back.`, '↩️')
            else toast.error(u.message ?? 'Could not undo that.')
          },
        },
      })
    } else {
      toast.show({
        kind: 'info',
        emoji: '➖',
        message: `Removed ${plural(taken, 'coin')} from ${who}.`,
        duration: 6000,
        action:
          taken > 0
            ? {
                label: 'Undo',
                onClick: () => {
                  // Giving back removed coins doesn't count toward the level.
                  const u = actions.adjustCoins(id, taken, 'Removal undone', false)
                  if (u.ok) toast.info(`${plural(taken, 'coin')} back for ${who}.`, '↩️')
                  else toast.error(u.message ?? 'Could not undo that.')
                },
              }
            : undefined,
      })
    }
    setAmount('')
    setNote('')
  }

  return (
    <Card padding="sm" className="pz-card pz-coins">
      <div className="pz-who">
        <Avatar emoji={profile.avatar} color={profile.color} size="md" />
        <span className="pz-who__name">{profile.name}</span>
        <CoinBadge value={profile.coins} />
      </div>
      <div className="pz-quick" role="group" aria-label="Quick amounts">
        {[10, 50, 100, 500].map((q) => (
          <button key={q} type="button" className="pz-quick__btn" aria-pressed={n === q} onClick={() => setAmount(String(q))}>
            {q}
          </button>
        ))}
      </div>
      <div className="pz-reward__row">
        <Field label="Coins" className="pz-field--num">
          <input className="pz-input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="100" />
        </Field>
        <Field label="Note (optional)" className="pz-field--grow">
          <input className="pz-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder="Great tournament! 🏆" />
        </Field>
      </div>
      <div className="pz-row-btns">
        <Button variant="success" icon="🎁" onClick={() => apply(1)} disabled={!valid}>
          Gift
        </Button>
        <Button variant="danger" icon="➖" onClick={() => apply(-1)} disabled={!valid || profile.coins === 0}>
          Remove
        </Button>
      </div>
      <ConfirmModal
        open={confirmGift}
        title={`Gift ${plural(valid ? n : 0, 'coin')}?`}
        confirmLabel="Yes, gift them"
        icon="🎁"
        variant="success"
        onCancel={() => setConfirmGift(false)}
        onConfirm={() => {
          setConfirmGift(false)
          apply(1, true)
        }}
      >
        <p>
          {valid && n >= BIG_GIFT ? <>That's a big gift for <b>{profile.name}</b>. </> : null}Gifts count toward the level, and removing
          coins later does <b>not</b> lower it (only “Undo” right after the gift does).
        </p>
        {levelAfter.level > levelNow.level ? (
          <p>
            ⚠️ {profile.name} would jump from {levelNow.emoji} <b>{levelNow.name}</b> to {levelAfter.emoji} <b>{levelAfter.name}</b>, which also
            unlocks level-locked shop items.
          </p>
        ) : (
          <p>{profile.name} stays at {levelNow.emoji} <b>{levelNow.name}</b>.</p>
        )}
      </ConfirmModal>
      <RecentCoins profile={profile} />
    </Card>
  )
}

/** The last 10 coin changes (earned, spent, gifts, removals), newest first. */
function RecentCoins({ profile }: { profile: Profile }) {
  const now = useNow()
  const rows = profile.history.slice(0, 10)
  return (
    <div className="pz-coin-hist">
      <span className="pz-field__label">Recent coins</span>
      {rows.length === 0 ? (
        <p className="pz-help">Nothing yet.</p>
      ) : (
        <ul className="pz-list pz-list--compact">
          {rows.map((h, i) => (
            <li key={`${h.at}-${i}`} className="pz-hist">
              <span className={cx('pz-hist__delta', h.delta > 0 ? 'is-plus' : 'is-minus')}>
                {h.delta > 0 ? '+' : ''}
                {h.delta.toLocaleString()}
              </span>
              <span className="pz-hist__text">{h.reason}</span>
              <span className="pz-hist__when">{timeAgo(h.at, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

const LENGTHS: Array<{ value: number; label: string }> = [
  { value: 20, label: '10 moves' },
  { value: 30, label: '15' },
  { value: 40, label: '20' },
  { value: 50, label: '25' },
  { value: 0, label: 'Full' },
]

type PendingChange =
  | { kind: 'ply'; openingId: string; openingName: string; ply: number }
  | { kind: 'extra'; chapterId: string; title: string; on: boolean }

export function TrainingSection() {
  const data = useAppData()
  const reps = useRepertoires()
  const [pending, setPending] = useState<PendingChange | null>(null)
  const goal = data.parent.dailyGoalLines

  const setGoal = (n: number) => {
    const v = Math.max(3, Math.min(10, n))
    if (v === goal) return
    const r = actions.setDailyGoal(v)
    if (!r.ok) toast.error(r.message ?? 'Could not change the goal.')
  }

  const apply = () => {
    if (!pending) return
    const r = pending.kind === 'ply' ? actions.setMaxPly(pending.openingId, pending.ply) : actions.toggleExtra(pending.chapterId, pending.on)
    if (r.ok) toast.success('Training settings updated.', '📚')
    else toast.error(r.message ?? 'Could not change that.')
    setPending(null)
  }

  // What the pending change would really do (built with the new setting, nothing applied).
  const impact = useMemo(() => {
    if (!pending || !reps.text) return null
    const openingId = pending.kind === 'ply' ? pending.openingId : OPENINGS.find((o) => o.extraChapters.some((c) => c.id === pending.chapterId))?.id
    const def = OPENINGS.find((o) => o.id === openingId)
    const cur = openingId ? reps.byId[openingId] : undefined
    if (!def || !cur) return null
    try {
      const ply = pending.kind === 'ply' ? pending.ply : (data.parent.maxPly[def.id] ?? DEFAULT_MAX_PLY)
      const extras =
        pending.kind === 'extra'
          ? pending.on
            ? [...data.parent.enabledExtras, pending.chapterId]
            : data.parent.enabledExtras.filter((c) => c !== pending.chapterId)
          : data.parent.enabledExtras
      const next = previewRepertoire(reps.text, def, ply, extras)
      const nextIds = new Set(next.lines.map((l) => l.id))
      const curIds = new Set(cur.lines.map((l) => l.id))
      const changed = cur.lines.filter((l) => !nextIds.has(l.id))
      const added = next.lines.filter((l) => !curIds.has(l.id)).length
      const practisedBy = data.profiles.filter((p) => changed.some((l) => p.lineStats[l.id]))
      const practised = changed.filter((l) => data.profiles.some((p) => p.lineStats[l.id])).length
      return { total: cur.lines.length, changed: changed.length, added, practised, who: practisedBy.map((p) => p.name).join(' and ') }
    } catch {
      return null
    }
  }, [pending, reps, data.parent, data.profiles])

  return (
    <div className="pz-stack">
      <Card padding="sm" className="pz-card">
        <SectionHead icon="🎯" title="Daily goal" />
        <div className="pz-goal">
          <Button variant="secondary" size="lg" onClick={() => setGoal(goal - 1)} disabled={goal <= 3} aria-label="Fewer lines">
            −
          </Button>
          <span className="pz-goal__value">
            <span className="num">{goal}</span>
            <small>lines a day</small>
          </span>
          <Button variant="secondary" size="lg" onClick={() => setGoal(goal + 1)} disabled={goal >= 10} aria-label="More lines">
            +
          </Button>
          <p className="pz-help pz-goal__help">Distinct lines per day. Reaching it pays a bonus and keeps the 🔥 streak going.</p>
        </div>
      </Card>

      {OPENINGS.map((o) => {
        const ply = data.parent.maxPly[o.id] ?? DEFAULT_MAX_PLY
        const known = LENGTHS.some((l) => l.value === ply)
        const rep = reps.byId[o.id]
        return (
          <Card key={o.id} padding="sm" className="pz-card pz-opening" style={{ borderTop: `6px solid ${o.accent}` }}>
            <div className="pz-opening__head">
              <span className="pz-opening__emoji" style={{ background: o.accent }} aria-hidden>
                {o.emoji}
              </span>
              <div className="pz-opening__title">
                <h3>{o.name}</h3>
                <span className="pz-help">{rep ? `${plural(rep.lines.length, 'line')} right now` : reps.status === 'loading' ? 'Loading lines…' : ''}</span>
              </div>
            </div>
            <Field group label="Line length" hint={known ? undefined : `Currently ${ply} half-moves`}>
              <Segmented
                ariaLabel={`Line length for ${o.name}`}
                options={LENGTHS}
                value={known ? ply : null}
                onChange={(v) => setPending({ kind: 'ply', openingId: o.id, openingName: o.name, ply: v })}
              />
            </Field>
            {o.extraChapters.length > 0 && (
              <div className="pz-extras">
                <span className="pz-field__label">Extra chapters</span>
                {o.extraChapters.map((c) => {
                  const on = data.parent.enabledExtras.includes(c.id)
                  const count = rep ? rep.lines.filter((l) => l.chapterId === c.id).length : 0
                  return (
                    <Toggle
                      key={c.id}
                      checked={on}
                      onChange={(v) => setPending({ kind: 'extra', chapterId: c.id, title: c.title, on: v })}
                      label={c.title}
                      description={on && rep ? plural(count, 'line') : 'Off'}
                      onIcon="✓"
                    />
                  )
                })}
              </div>
            )}
          </Card>
        )
      })}

      <ConfirmModal
        open={!!pending}
        title="Change the training lines?"
        confirmLabel="Yes, change it"
        variant="primary"
        icon={pending?.kind === 'extra' ? '✓' : undefined}
        onCancel={() => setPending(null)}
        onConfirm={apply}
      >
        {pending && (
          <>
            <p>
              {pending.kind === 'ply' ? (
                <>
                  Set <b>{pending.openingName}</b> lines to{' '}
                  <b>{pending.ply === 0 ? 'full length' : `${pending.ply / 2} moves`}</b>.
                </>
              ) : (
                <>
                  Turn <b>{pending.title}</b> {pending.on ? 'on' : 'off'}.
                </>
              )}
            </p>
            {pending.kind === 'extra' ? (
              <p>
                {pending.on ? (
                  <>Adds {impact ? plural(impact.added, 'line') : 'its lines'}; nothing is lost.</>
                ) : (
                  <>
                    Hides {impact ? plural(impact.changed, 'line') : 'its lines'}. Their progress is kept and comes back if you turn it on
                    again.
                  </>
                )}
              </p>
            ) : impact ? (
              <p>
                {impact.changed === 0 && impact.added === 0 ? (
                  'No line changes.'
                ) : (
                  <>
                    ⚠️ <b>
                      {impact.changed} of {impact.total} lines change
                    </b>
                    {impact.practised > 0 ? ` (${impact.practised} already practised by ${impact.who})` : ''} and {plural(impact.added, 'line')}{' '}
                    {impact.added === 1 ? 'is' : 'are'} new. A changed line counts as a new line: its progress starts over. Going back to the
                    old length brings the old progress back. Coins, items and trophies are kept.
                  </>
                )}
              </p>
            ) : (
              <p>
                ⚠️ Lines that change count as new lines, so the kids' progress on <b>those lines starts over</b>. Coins, items and
                trophies are kept.
              </p>
            )}
          </>
        )}
      </ConfirmModal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export function PlayersSection() {
  const data = useAppData()
  return (
    <div className="pz-grid-2">
      {data.profiles.map((p) => (
        <PlayerCard key={p.id} profile={p} />
      ))}
    </div>
  )
}

function PlayerCard({ profile }: { profile: Profile }) {
  const [name, setName] = useState(profile.name)
  const [picking, setPicking] = useState(false)
  const [reset, setReset] = useState<0 | 1 | 2>(0)
  useEffect(() => setName(profile.name), [profile.name])
  const level = levelOf(profile)
  const avatars = itemsOfKind('avatar').filter((it) => profile.owned.includes(it.id))
  const dirty = name.trim() !== profile.name && name.trim().length > 0

  const rename = () => {
    const r = actions.renameProfile(profile.id, name)
    if (r.ok) toast.success(`Renamed to ${name.trim()}.`, '✏️')
    else toast.error(r.message ?? 'Names need 1–20 letters.')
  }
  const waiting = profile.redemptions.filter((r) => r.status === 'pending')
  const waitingCoins = waiting.reduce((s, r) => s + r.cost, 0)

  return (
    <Card padding="sm" className="pz-card pz-player">
      <div className="pz-player__top">
        <Avatar emoji={profile.avatar} color={profile.color} size="lg" onClick={() => setPicking(true)} label={`Change ${profile.name}'s avatar`} badge="✏️" />
        <div className="pz-player__info">
          <span className="pz-who__name">{profile.name}</span>
          <span className="pz-help">
            {level.emoji} {level.name} · {plural(profile.coins, 'coin')} · {plural(profile.totals.lines, 'line')} done
          </span>
        </div>
      </div>
      <div className="pz-reward__row">
        <Field label="Name" className="pz-field--grow">
          <input className="pz-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
        </Field>
        <Button size="sm" variant="primary" icon="💾" disabled={!dirty} onClick={rename} className="pz-align-end">
          Save
        </Button>
      </div>
      <div className="pz-row-btns">
        <Button variant="secondary" size="sm" icon="🙂" onClick={() => setPicking(true)}>
          Change avatar
        </Button>
        <Button variant="danger" size="sm" icon="♻️" onClick={() => setReset(1)}>
          Reset progress
        </Button>
      </div>

      <Modal open={picking} onClose={() => setPicking(false)} title={`${profile.name}'s avatar`} size="sm">
        <p className="pz-help">Only avatars {profile.name} owns. More can be bought in the shop.</p>
        <div className="pz-avatar-grid">
          {avatars.map((it) => (
            <button
              key={it.id}
              type="button"
              className="pz-avatar-pick"
              aria-pressed={profile.avatar === it.refId}
              aria-label={it.name}
              onClick={() => {
                const r = actions.setAvatar(profile.id, it.refId)
                if (r.ok) setPicking(false)
                else toast.error(r.message ?? 'Could not change the avatar.')
              }}
            >
              <Avatar emoji={it.refId} color={profile.color} size="md" />
            </button>
          ))}
        </div>
      </Modal>

      <ConfirmModal
        open={reset === 1}
        title={`Reset ${profile.name}'s progress?`}
        confirmLabel="Continue"
        variant="danger"
        onCancel={() => setReset(0)}
        onConfirm={() => setReset(2)}
      >
        <p>
          This wipes <b>all</b> of {profile.name}'s coins, items, trophies, achievements, streak and line progress. The name and
          colour stay.
        </p>
        {waiting.length > 0 && (
          <p>
            ⚠️ <b>
              {plural(waiting.length, 'waiting request')} ({plural(waitingCoins, 'coin')})
            </b>{' '}
            will be cancelled too.
          </p>
        )}
        <p>Tip: export a backup first (💾 Data tab).</p>
      </ConfirmModal>
      <ConfirmModal
        open={reset === 2}
        title="Are you really sure?"
        confirmLabel={`Yes, reset ${profile.name}`}
        variant="danger"
        icon="♻️"
        onCancel={() => setReset(0)}
        onConfirm={() => {
          const r = actions.resetProfile(profile.id)
          setReset(0)
          if (r.ok) toast.info(`${profile.name} starts fresh.`, '♻️')
          else toast.error(r.message ?? 'Could not reset.')
        }}
      >
        <p>This can't be undone (unless you have a backup).</p>
      </ConfirmModal>
    </Card>
  )
}
