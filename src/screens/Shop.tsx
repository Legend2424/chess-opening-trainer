// Screen 5 — Shop (DESIGN.md §6.5)
// Tabs Boards / Pieces / Avatars / Trophies / Effects / Titles / 🎁 Rewards.
// Item cards with live previews, rarity glow, price and Buy / Equip state.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { CatalogItem, EffectId, ItemKind, Profile, Screen } from '../types.ts'
import { useNav } from '../app/nav.tsx'
import { actions, useActiveProfile, useParentSettings } from '../store/appStore.ts'
import { isEquipped, levelOf } from '../store/profileOps.ts'
import { itemsOfKind } from '../store/catalog.ts'
import { LEVELS } from '../store/levels.ts'
import { Button, Chip, CoinBadge, Modal, Tabs, cx, toast, type TabItem } from '../components/ui/index.ts'
import { PIECE_SET_IDS } from '../types.ts'
import { preloadPieceSet } from '../theme/pieces.tsx'
import { celebrate } from '../fx/celebrate.ts'
import { sfx } from '../fx/sound.ts'
import { PlayerTopBar, opMessage, useNow } from './meta/common.tsx'
import { ItemPreview } from './meta/ItemPreview.tsx'
import { ShopRewards } from './meta/ShopRewards.tsx'
import './Shop.css'

type ShopTab = ItemKind | 'rewards'

const TAB_IDS: ShopTab[] = ['board', 'pieces', 'avatar', 'trophy', 'effect', 'title', 'rewards']

const RARITY_LABEL: Record<CatalogItem['rarity'], string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
}

function levelLabel(level: number): string {
  const named = LEVELS[level - 1]
  return named ? `Level ${level} · ${named.name}` : `Level ${level}`
}

type ItemState = 'equipped' | 'owned' | 'shelf' | 'locked' | 'short' | 'buy'

function itemState(profile: Profile, item: CatalogItem, level: number): ItemState {
  if (profile.owned.includes(item.id)) {
    if (item.kind === 'trophy') return 'shelf'
    return isEquipped(profile, item.id) ? 'equipped' : 'owned'
  }
  if (item.minLevel !== undefined && level < item.minLevel) return 'locked'
  if (profile.coins < item.cost) return 'short'
  return 'buy'
}

export default function Shop({ params }: { params: Extract<Screen, { name: 'shop' }> }) {
  const profile = useActiveProfile()
  const parent = useParentSettings()
  const nav = useNav()
  const now = useNow()
  const [tab, setTab] = useState<ShopTab>(() => (params.tab && TAB_IDS.includes(params.tab) ? params.tab : 'board'))
  const [buying, setBuying] = useState<{ item: CatalogItem; phase: 'confirm' | 'done' } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Every tab starts at its top (the scroll area is shared by all tabs).
  const changeTab = (t: ShopTab) => {
    setTab(t)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  useEffect(() => {
    if (tab === 'pieces') for (const id of PIECE_SET_IDS) preloadPieceSet(id)
  }, [tab])

  const items = useMemo(() => (tab === 'rewards' ? [] : itemsOfKind(tab)), [tab])

  if (!profile) return null
  const level = levelOf(profile).level
  const pendingCount = profile.redemptions.filter((r) => r.status === 'pending').length

  const tabs: TabItem<ShopTab>[] = [
    { id: 'board', label: 'Boards', icon: '🎨' },
    { id: 'pieces', label: 'Pieces', icon: '♞' },
    { id: 'avatar', label: 'Avatars', icon: '🦊' },
    { id: 'trophy', label: 'Trophies', icon: '🏆' },
    { id: 'effect', label: 'Effects', icon: '🎉' },
    { id: 'title', label: 'Titles', icon: '🏷️' },
    { id: 'rewards', label: 'Rewards', icon: '🎁', badge: pendingCount || undefined },
  ]

  const equip = (item: CatalogItem) => {
    const r = actions.equipItem(item.id)
    if (!r.ok) {
      toast.error(opMessage(r))
      return false
    }
    toast.show({ kind: 'success', emoji: item.emoji, message: equipMessage(item) })
    return true
  }

  const confirmBuy = (item: CatalogItem) => {
    const r = actions.buyItem(item.id)
    if (!r.ok) {
      toast.error(opMessage(r))
      setBuying(null)
      return
    }
    sfx.purchase()
    void celebrate(profile.equipped.effect, { intensity: 0.7 })
    toast.show({ kind: 'success', emoji: item.emoji, title: `${item.name} is yours!`, message: 'Spent wisely! 🛍️', sound: false })
    for (const a of r.newAchievements) toast.achievement(`${a.name} unlocked!`, `${a.description} +${a.coins} coins`, a.emoji)
    if (r.levelUp) {
      sfx.levelUp()
      toast.show({ kind: 'achievement', emoji: r.levelUp.to.emoji, title: 'Level up!', message: `You're now a ${r.levelUp.to.name}!`, sound: false })
    }
    setBuying({ item, phase: 'done' })
  }

  return (
    <div className="screen game-ui meta-screen shop">
      <PlayerTopBar profile={profile} onBack={() => nav.back()} center="🛒 Shop" />
      <div className="shop__tabs">
        <Tabs<ShopTab> tabs={tabs} value={tab} onChange={changeTab} ariaLabel="Shop sections" />
      </div>
      <div className="meta-scroll" ref={scrollRef}>
        <div className="meta-page shop__page">
          {tab === 'rewards' ? (
            <ShopRewards profile={profile} rewards={parent.rewards} now={now} />
          ) : (
            <div className="shop__grid" key={tab}>
              {items.map((item, i) => (
                <ShopItemCard
                  key={item.id}
                  item={item}
                  profile={profile}
                  index={i}
                  state={itemState(profile, item, level)}
                  onBuy={() => setBuying({ item, phase: 'confirm' })}
                  onEquip={() => equip(item)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {buying && (
        <BuyModal
          item={buying.item}
          phase={buying.phase}
          profile={profile}
          onCancel={() => setBuying(null)}
          onConfirm={() => confirmBuy(buying.item)}
          onEquip={() => {
            if (equip(buying.item)) setBuying(null)
          }}
          onShelf={() => {
            setBuying(null)
            // Remember this tab so "back" from the shelf lands where the kid was.
            nav.replace({ name: 'shop', tab })
            nav.go({ name: 'trophies' })
          }}
        />
      )}
    </div>
  )
}

function equipMessage(item: CatalogItem): string {
  switch (item.kind) {
    case 'board':
      return `Your board is now ${item.name}!`
    case 'pieces':
      return `Your army is now ${item.name}!`
    case 'avatar':
      return `Looking good, ${item.name}!`
    case 'effect':
      return `${item.name} will play when you finish a line!`
    case 'title':
      return `You are now "${item.name}"!`
    default:
      return `${item.name} equipped!`
  }
}

// ---------------------------------------------------------------------------

interface ShopItemCardProps {
  item: CatalogItem
  profile: Profile
  index: number
  state: ItemState
  onBuy: () => void
  onEquip: () => void
}

function ShopItemCard({ item, profile, index, state, onBuy, onEquip }: ShopItemCardProps) {
  const short = Math.max(0, item.cost - profile.coins)
  const style = { '--i': Math.min(index, 12) } as CSSProperties
  return (
    <article
      className={cx(
        'shop-item',
        `shop-item--${item.rarity}`,
        'anim-pop anim-delay',
        state === 'equipped' && 'is-equipped',
        (state === 'owned' || state === 'shelf') && 'is-owned',
        state === 'locked' && 'is-locked',
      )}
      style={style}
    >
      <div className="shop-item__preview">
        <ItemPreview item={item} profile={profile} />
        {item.kind === 'effect' && (
          <button
            type="button"
            className="shop-item__try"
            onPointerDown={() => sfx.click()}
            onClick={() => void celebrate(item.refId as EffectId, { intensity: 0.8, force: true })}
            aria-label={`Try ${item.name}`}
          >
            ▶ Try
          </button>
        )}
        {state === 'locked' && (
          <span className="shop-item__lock" aria-hidden>
            🔒
          </span>
        )}
      </div>
      <div className="shop-item__info">
        {item.rarity !== 'common' && <span className="shop-item__rarity">{RARITY_LABEL[item.rarity]}</span>}
        <h3 className="shop-item__name">{item.name}</h3>
        <p className="shop-item__desc">{item.description}</p>
      </div>
      <div className="shop-item__foot">
        {state === 'equipped' || state === 'shelf' ? null : state === 'owned' ? (
          <Chip tone="green" icon="✓">
            Yours
          </Chip>
        ) : item.cost === 0 ? (
          <Chip tone="green">Free</Chip>
        ) : (
          <CoinBadge value={item.cost} size="sm" animate={false} showDelta={false} />
        )}
        <ItemAction item={item} state={state} short={short} onBuy={onBuy} onEquip={onEquip} />
      </div>
      {state === 'short' && <div className="shop-item__need">Need {short.toLocaleString()} more coins</div>}
    </article>
  )
}

function ItemAction({ item, state, short, onBuy, onEquip }: { item: CatalogItem; state: ItemState; short: number; onBuy: () => void; onEquip: () => void }) {
  switch (state) {
    case 'equipped':
      return <span className="shop-item__state shop-item__state--on">✓ Equipped</span>
    case 'shelf':
      return <span className="shop-item__state shop-item__state--on">🏆 On your shelf</span>
    case 'owned':
      return (
        <Button size="sm" variant="primary" onClick={onEquip}>
          Equip
        </Button>
      )
    case 'locked':
      return <span className="shop-item__state shop-item__state--lock">🔒 {levelLabel(item.minLevel ?? 1)}</span>
    case 'short':
      return (
        <Button size="sm" variant="gold" disabled aria-label={`Buy — you need ${short} more coins`}>
          Buy
        </Button>
      )
    default:
      return (
        <Button size="sm" variant="gold" icon="🛒" onClick={onBuy}>
          Buy
        </Button>
      )
  }
}

// ---------------------------------------------------------------------------

interface BuyModalProps {
  item: CatalogItem
  phase: 'confirm' | 'done'
  profile: Profile
  onCancel: () => void
  onConfirm: () => void
  onEquip: () => void
  onShelf: () => void
}

function BuyModal({ item, phase, profile, onCancel, onConfirm, onEquip, onShelf }: BuyModalProps) {
  const done = phase === 'done'
  const left = profile.coins - item.cost
  const equipped = isEquipped(profile, item.id)
  return (
    <Modal
      open
      onClose={onCancel}
      title={done ? '🎉 It’s yours!' : `Buy ${item.name}?`}
      size="sm"
      footerCenter
      footer={
        done ? (
          item.kind === 'trophy' ? (
            <>
              <Button variant="secondary" onClick={onCancel}>
                Keep shopping
              </Button>
              <Button variant="gold" icon="🏆" onClick={onShelf} data-autofocus>
                See my shelf
              </Button>
            </>
          ) : equipped ? (
            <Button variant="primary" onClick={onCancel} data-autofocus>
              Yay!
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onCancel}>
                Keep shopping
              </Button>
              <Button variant="primary" icon="✨" onClick={onEquip} data-autofocus>
                Use it now
              </Button>
            </>
          )
        ) : (
          <>
            <Button variant="secondary" onClick={onCancel}>
              Not now
            </Button>
            <Button variant="gold" icon="🛒" onClick={onConfirm} data-autofocus>
              Buy it!
            </Button>
          </>
        )
      }
    >
      <div className={cx('shop-buy', done && 'shop-buy--done')}>
        <div className={cx('shop-buy__preview', `shop-item--${item.rarity}`, done && 'anim-bounce')}>
          <ItemPreview item={item} profile={profile} size="lg" />
        </div>
        <p className="shop-buy__desc">{item.description}</p>
        {done ? (
          <p className="shop-buy__line">
            <b>{item.name}</b> is now in your collection!
          </p>
        ) : (
          <div className="shop-buy__price">
            <span>Price</span>
            <CoinBadge value={item.cost} size="lg" animate={false} showDelta={false} />
            <span className="shop-buy__left">You'll have {left.toLocaleString()} left</span>
          </div>
        )}
      </div>
    </Modal>
  )
}
