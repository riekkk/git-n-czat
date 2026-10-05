import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchLiveOrder, LIVE_ORDER_STALE_AFTER_MS, THANK_YOU_MS, RECEIPT_FAILED_MS, THANK_YOU_MAX_MS } from '@/lib/liveOrder'

// ─── Customer Display ───────────────────────────────────────────────────────
// The only screen the customer_display account ever renders (see App). It
// shows the order the register is ringing up, read-only, and is built to
// never show a stale order:
//   - Nothing is shown until the current order has been (re)read from the
//     server — on first load, every realtime (re)subscribe, coming back
//     online, and waking from sleep. Until then it shows the idle screen.
//   - Every register write (order change or 10s heartbeat) counts as "heard
//     from"; after LIVE_ORDER_STALE_AFTER_MS of silence it clears to idle.
//   - A dropped realtime channel, going offline, or the tab hiding clears it
//     to idle immediately.
//   - "Thank you!" shows for THANK_YOU_MS once the receipt prints, or
//     RECEIPT_FAILED_MS with "Please see the cashier" if it failed; while
//     it's still printing, for at most THANK_YOU_MAX_MS.

function peso(amount) {
  const value = Number(amount) || 0
  return `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function CustomerDisplay({ logo }) {
  const [order, setOrder] = useState(null) // the payload on screen; null = idle
  const [, setTick] = useState(0)
  const lastHeardAt = useRef(0)
  const lastEventAt = useRef(0)
  // When the current orderKey was first seen paid, and when its receipt
  // stopped printing — drives the thank-you timer.
  const paidTiming = useRef({ key: null, paidAt: 0, settledAt: 0 })
  const listRef = useRef(null)

  const show = (payload, heardAt) => {
    lastHeardAt.current = heardAt
    if (!payload || payload.phase === 'idle') { setOrder(null); return }
    if (payload.phase === 'paid') {
      const t = paidTiming.current
      if (t.key !== payload.orderKey) paidTiming.current = { key: payload.orderKey, paidAt: heardAt, settledAt: payload.receipt === 'printing' ? 0 : heardAt }
      else if (payload.receipt !== 'printing' && !t.settledAt) t.settledAt = heardAt
    }
    setOrder(payload)
  }

  useEffect(() => {
    let cancelled = false
    let syncSeq = 0
    const resync = async () => {
      const seq = ++syncSeq
      const startedAt = Date.now()
      setOrder(null) // idle until we know what's current
      const res = await fetchLiveOrder()
      if (cancelled || seq !== syncSeq) return
      if (lastEventAt.current > startedAt) return // a live update already arrived and is newer
      if (res && res.ageMs <= LIVE_ORDER_STALE_AFTER_MS) show(res.payload, Date.now() - res.ageMs)
      else { lastHeardAt.current = 0; setOrder(null) }
    }
    const goIdle = () => { lastHeardAt.current = 0; setOrder(null) }

    const channel = supabase
      .channel('customer-display')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_order' }, change => {
        if (!change.new?.payload) return
        lastEventAt.current = Date.now()
        show(change.new.payload, Date.now())
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') resync()
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') goIdle()
      })

    const onVisible = () => (document.visibilityState === 'visible' ? resync() : goIdle())
    const onOnline = () => resync()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', goIdle)
    window.addEventListener('pageshow', resync)
    document.addEventListener('visibilitychange', onVisible)

    const interval = setInterval(() => {
      if (Date.now() - lastHeardAt.current > LIVE_ORDER_STALE_AFTER_MS) setOrder(null)
      setTick(n => n + 1)
    }, 1000)

    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', goIdle)
      window.removeEventListener('pageshow', resync)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [])

  // Keep the newest items in view on long orders (nothing is scrollable by touch).
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [order])

  // Thank-you screen expiry.
  let visible = order
  if (order?.phase === 'paid') {
    const t = paidTiming.current
    const now = Date.now()
    const expired = t.settledAt
      ? now - t.settledAt > (order.receipt === 'failed' ? RECEIPT_FAILED_MS : THANK_YOU_MS)
      : now - t.paidAt > THANK_YOU_MAX_MS
    if (expired) visible = null
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#fff9ea] text-[#2c2416] select-none">
      {!visible ? <IdleScreen logo={logo} />
        : visible.phase === 'paid' ? <ThankYouScreen order={visible} logo={logo} />
        : <OrderScreen order={visible} listRef={listRef} />}
      <HiddenSignOut logo={logo} />
    </div>
  )
}

function IdleScreen({ logo }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-8 pointer-events-none">
      <img src={logo} alt="Dimp'z Cafe" className="w-40 h-40 md:w-56 md:h-56 object-contain mb-8" />
      <h1 style={{ fontFamily: 'var(--font-serif)' }} className="text-5xl md:text-6xl font-semibold">Welcome to Dimp'z Cafe</h1>
      <p className="text-xl md:text-2xl text-[#a8977e] mt-4">Your order will appear here</p>
    </div>
  )
}

function OrderScreen({ order, listRef }) {
  const orderTypeLabel = order.orderType === 'dine_in' ? 'Dine In' : order.orderType === 'take_out' ? 'Take Out' : null
  const showCash = order.paymentMethod === 'cash' && order.amountReceived != null
  return (
    <div className="h-full flex flex-col landscape:flex-row pointer-events-none">
      {/* Items */}
      <div className="flex-1 min-h-0 flex flex-col p-6 md:p-10">
        <div className="flex items-center justify-between gap-4 mb-6">
          <h1 style={{ fontFamily: 'var(--font-serif)' }} className="text-4xl md:text-5xl font-semibold">Your Order</h1>
          {orderTypeLabel && <span className="text-xl md:text-2xl font-semibold px-5 py-2 rounded-full bg-[#2c2416] text-[#ddcca6]">{orderTypeLabel}</span>}
        </div>
        <div ref={listRef} className="flex-1 min-h-0 overflow-hidden space-y-4">
          {order.items.map((item, i) => (
            <div key={i} className="flex items-start justify-between gap-6 border-b border-[#f0e8d8] pb-4">
              <div className="min-w-0">
                <p className="text-2xl md:text-3xl font-medium leading-snug">
                  <span className="text-[#a8977e] mr-3">{item.qty}×</span>{item.name}
                </p>
                {item.addOns.length > 0 && <p className="text-lg md:text-xl text-[#7a6a50] mt-1">+ {item.addOns.join(', ')}</p>}
                {item.qty > 1 && <p className="text-base md:text-lg text-[#a8977e] mt-1">{peso(item.unitPrice)} each</p>}
              </div>
              <p className="text-2xl md:text-3xl font-semibold shrink-0">{peso(item.lineTotal)}</p>
            </div>
          ))}
        </div>
      </div>
      {/* Totals */}
      <div className="landscape:w-[38%] bg-white border-t landscape:border-t-0 landscape:border-l border-[#f0e8d8] p-6 md:p-10 flex flex-col justify-center gap-4">
        <Row label="Subtotal" value={peso(order.itemsSubtotal)} />
        {order.packagingFee > 0 && <Row label="Packaging fee" value={peso(order.packagingFee)} />}
        <div className="border-t border-[#e8ddc8] pt-5 mt-1">
          <p className="text-xl md:text-2xl text-[#a8977e] font-medium uppercase tracking-wider">Total</p>
          <p style={{ fontFamily: 'var(--font-serif)' }} className="text-6xl md:text-7xl font-bold mt-1">{peso(order.total)}</p>
        </div>
        {showCash && (
          <div className="mt-2 space-y-3">
            <Row label="Cash received" value={peso(order.amountReceived)} />
            {order.change != null && <Row label="Change" value={peso(order.change)} strong />}
          </div>
        )}
      </div>
    </div>
  )
}

function ThankYouScreen({ order, logo }) {
  const isCash = order.paymentMethod === 'cash'
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-8 pointer-events-none">
      <img src={logo} alt="" className="w-28 h-28 md:w-36 md:h-36 object-contain mb-6" />
      <h1 style={{ fontFamily: 'var(--font-serif)' }} className="text-6xl md:text-7xl font-bold">Thank you!</h1>
      <p className="text-2xl md:text-3xl text-[#7a6a50] mt-5">Total paid: <span className="font-semibold text-[#2c2416]">{peso(order.total)}</span></p>
      {isCash && order.change != null && order.change > 0 && (
        <p className="text-2xl md:text-3xl text-[#7a6a50] mt-2">Change: <span className="font-semibold text-[#2c2416]">{peso(order.change)}</span></p>
      )}
      {order.receipt === 'printing' && <p className="text-xl md:text-2xl text-[#a8977e] mt-8">Preparing your receipt…</p>}
      {order.receipt === 'failed' && <p className="text-xl md:text-2xl font-medium text-[#b85c42] mt-8">Please see the cashier</p>}
    </div>
  )
}

function Row({ label, value, strong }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xl md:text-2xl text-[#7a6a50]">{label}</span>
      <span className={`text-2xl md:text-3xl ${strong ? 'font-bold' : 'font-medium'}`}>{value}</span>
    </div>
  )
}

// The display has no controls. Staff can sign the iPad out by pressing and
// holding the small corner logo for 3 seconds (then confirming) — not
// something a customer would trigger by accident, and it can't change the
// order either way.
function HiddenSignOut({ logo }) {
  const timer = useRef(null)
  const start = () => {
    timer.current = setTimeout(() => {
      if (window.confirm('Sign this Customer Display out?')) supabase.auth.signOut()
    }, 3000)
  }
  const cancel = () => clearTimeout(timer.current)
  return (
    <img
      src={logo}
      alt=""
      draggable={false}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onContextMenu={e => e.preventDefault()}
      className="fixed bottom-3 right-3 w-8 h-8 object-contain opacity-30"
    />
  )
}
