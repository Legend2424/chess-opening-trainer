// Shop → 🎁 Rewards tab: real-world rewards set up by a parent (Pokémon packs,
// screen time...). "Ask a parent" sets the coins aside now; a decline refunds them.

import { useState, type CSSProperties } from 'react'
import type { Profile, Redemption, RewardDef } from '../../types.ts'
import { actions } from '../../store/appStore.ts'
import { canRequestRedemption, redemptionsThisWeek } from '../../store/profileOps.ts'
import { Button, Card, Chip, CoinBadge, ProgressBar, cx, toast } from '../../components/ui/index.ts'
import { celebrate } from '../../fx/celebrate.ts'
import { sfx } from '../../fx/sound.ts'
import { ConfirmModal, opMessage, plural, timeAgo } from './common.tsx'

export interface ShopRewardsProps {
  profile: Profile
  rewards: RewardDef[]
  now: number
}

export function ShopRewards({ profile, rewards, now }: ShopRewardsProps) {
  const [asking, setAsking] = useState<RewardDef | null>(null)
  const enabled = rewards.filter((r) => r.enabled)
  const requests = profile.redemptions.slice(0, 12)

  const ask = (reward: RewardDef) => {
    setAsking(null)
    const r = actions.requestRedemption(reward.id)
    if (!r.ok) {
      toast.error(opMessage(r))
      return
    }
    if (r.duplicate) {
      toast.info('You already asked — a parent will check it soon!', '⏳')
      return
    }
    sfx.purchase()
    void celebrate(profile.equipped.effect, { intensity: 0.5 })
    toast.show({ kind: 'success', emoji: '📨', title: 'Request sent!', message: 'A parent will check it soon. ⏳', sound: false })
  }

  return (
    <div className="shop-rewards">
      <Card className="shop-rewards__intro" padding="sm">
        <span className="shop-rewards__intro-emoji" aria-hidden>
          🎁
        </span>
        <div>
          <h3 className="shop-rewards__intro-title">Real rewards!</h3>
          <p className="shop-rewards__intro-text">
            Save up your coins and ask a parent for a real treat. Your coins are put aside when you ask — and if a parent says
            no, you get them all back.
          </p>
        </div>
      </Card>

      {enabled.length === 0 ? (
        <Card>
          <div className="meta-empty">
            <span className="meta-empty__icon">🙈</span>
            No real rewards are switched on right now. Ask a parent!
          </div>
        </Card>
      ) : (
        <div className="shop-rewards__grid">
          {enabled.map((rw, i) => (
            <RewardCard key={rw.id} reward={rw} profile={profile} now={now} index={i} onAsk={() => setAsking(rw)} />
          ))}
        </div>
      )}

      <Card className="shop-rewards__mine" padding="sm">
        <h3 className="meta-section-title shop-rewards__mine-title">
          📨 My requests
          {requests.length > 0 && <Chip tone="gray">{requests.length}</Chip>}
        </h3>
        {requests.length === 0 ? (
          <div className="meta-empty">You haven't asked for anything yet.</div>
        ) : (
          <ul className="shop-req-list">
            {requests.map((r) => (
              <RequestRow key={r.id} r={r} now={now} />
            ))}
          </ul>
        )}
      </Card>

      <ConfirmModal
        open={!!asking}
        title={asking ? `Ask for ${asking.emoji} ${asking.name}?` : ''}
        confirmLabel="Yes, ask!"
        icon="🙋"
        variant="gold"
        cancelLabel="Not now"
        onCancel={() => setAsking(null)}
        onConfirm={() => asking && ask(asking)}
      >
        {asking && (
          <>
            <div className="shop-rewards__confirm-emoji" aria-hidden>
              {asking.emoji}
            </div>
            <p>
              <b>{asking.cost.toLocaleString()} coins</b> will be put aside now. A parent will say yes or no — if it's a no,
              you get every coin back.
            </p>
            <p>
              You'll have <b>{Math.max(0, profile.coins - asking.cost).toLocaleString()}</b> coins left.
            </p>
          </>
        )}
      </ConfirmModal>
    </div>
  )
}

function RewardCard({ reward, profile, now, index, onAsk }: { reward: RewardDef; profile: Profile; now: number; index: number; onAsk: () => void }) {
  const check = canRequestRedemption(profile, reward, now)
  const used = redemptionsThisWeek(profile, reward.id, now)
  const left = reward.maxPerWeek !== undefined ? Math.max(0, reward.maxPerWeek - used) : null
  const short = Math.max(0, reward.cost - profile.coins)
  const style = { '--i': index } as CSSProperties
  return (
    <article className={cx('reward-card', 'anim-pop anim-delay', check.ok && 'is-ready')} style={style}>
      <div className="reward-card__emoji" aria-hidden>
        {reward.emoji}
      </div>
      <div className="reward-card__body">
        <h3 className="reward-card__name">{reward.name}</h3>
        <div className="reward-card__chips">
          <CoinBadge value={reward.cost} size="sm" animate={false} showDelta={false} />
          {reward.maxPerWeek !== undefined && (
            <Chip tone={left === 0 ? 'gray' : 'blue'} icon="📅">
              {reward.maxPerWeek} per week · {left} left
            </Chip>
          )}
        </div>
        <ProgressBar
          value={Math.min(profile.coins, reward.cost)}
          max={Math.max(1, reward.cost)}
          height={12}
          color="linear-gradient(90deg, #ffd24a 0%, #f59e0b 100%)"
          label={short > 0 ? `${short.toLocaleString()} coins to go!` : 'You have enough coins! 🎉'}
          valueText={`${Math.min(profile.coins, reward.cost).toLocaleString()} / ${reward.cost.toLocaleString()}`}
        />
        <div className="reward-card__foot">
          <Button variant="gold" icon="🙋" onClick={onAsk} disabled={!check.ok} pulse={check.ok}>
            Ask a parent
          </Button>
          {!check.ok && check.error !== 'not-enough-coins' && <span className="reward-card__why">{opMessage({ error: check.error })}</span>}
          {!check.ok && check.error === 'not-enough-coins' && <span className="reward-card__why">Keep practising — you're getting there! 💪</span>}
        </div>
      </div>
    </article>
  )
}

const STATUS: Record<Redemption['status'], { label: string; tone: 'gold' | 'green' | 'gray'; icon: string }> = {
  pending: { label: 'Waiting for a parent', tone: 'gold', icon: '⏳' },
  approved: { label: 'Yes! Approved', tone: 'green', icon: '✅' },
  declined: { label: 'Not this time · coins back', tone: 'gray', icon: '↩️' },
}

function RequestRow({ r, now }: { r: Redemption; now: number }) {
  const s = STATUS[r.status]
  return (
    <li className={cx('shop-req', `shop-req--${r.status}`)}>
      <span className="shop-req__emoji" aria-hidden>
        {r.emoji}
      </span>
      <span className="shop-req__text">
        <span className="shop-req__name">{r.rewardName}</span>
        <span className="shop-req__when">
          {plural(r.cost, 'coin')} · asked {timeAgo(r.requestedAt, now)}
        </span>
      </span>
      <Chip tone={s.tone} icon={s.icon}>
        {s.label}
      </Chip>
    </li>
  )
}
