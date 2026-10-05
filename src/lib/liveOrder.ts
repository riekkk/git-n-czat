// Customer Display live order — the register device publishes the order
// being rung up into the single `live_order` row; the display account reads
// it (and nothing else — see the customer_display migration).
//
// Only customer-safe fields ever leave the register: names, quantities,
// prices, add-on names, totals, order type and cash tendered. Never notes,
// customer names, costs, stock, or anything from a staff order (the staff
// cart is a separate cart that is never published).
import { supabase } from './supabase'
import { isOrderCharge } from './categories'

export const LIVE_ORDER_HEARTBEAT_MS = 10_000
// The display clears to idle if it hears nothing for this long.
export const LIVE_ORDER_STALE_AFTER_MS = 30_000
// How long "Thank you!" stays up once the receipt has printed…
export const THANK_YOU_MS = 8_000
// …or, if it failed, how long "Please see the cashier" stays up.
export const RECEIPT_FAILED_MS = 15_000
// Longest the thank-you screen waits on a receipt still printing. Must
// outlast the checkout receipt's PrintNode window + status grace + one poll
// (printer.ts: 60s + 10s + 3s), or a failure would never be shown.
export const THANK_YOU_MAX_MS = 90_000

export type LivePhase = 'idle' | 'ordering' | 'paid'
export type LiveReceipt = 'printing' | 'printed' | 'failed' | null

export interface LiveOrderItem {
  name: string
  qty: number
  unitPrice: number
  lineTotal: number
  addOns: string[]
}

export interface LiveOrderPayload {
  phase: LivePhase
  // New for every order, so the display can never carry anything over from
  // the previous customer.
  orderKey: string
  orderType?: 'dine_in' | 'take_out' | ''
  items: LiveOrderItem[]
  itemsSubtotal: number
  packagingFee: number
  total: number
  paymentMethod?: string
  amountReceived?: number | null
  change?: number | null
  receipt: LiveReceipt
}

export const IDLE_PAYLOAD: LiveOrderPayload = { phase: 'idle', orderKey: 'idle', items: [], itemsSubtotal: 0, packagingFee: 0, total: 0, receipt: null }

export function newOrderKey(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface CartLine {
  name: string
  quantity: number
  price: number
  addOns?: { name: string, price?: number }[]
}

interface CheckoutDetails {
  orderType?: string
  paymentMethod?: string
  amountReceived?: string | number | null
}

// Cart (+ checkout details) → the customer-safe snapshot. Deliberately
// rebuilds every field instead of passing cart objects through, so a new
// cart field (a note, a cost) can never leak to the display by accident.
export function buildLivePayload(cart: CartLine[], details: CheckoutDetails, orderKey: string, phase: LivePhase = 'ordering', receipt: LiveReceipt = null): LiveOrderPayload {
  if (cart.length === 0 && phase !== 'paid') return { ...IDLE_PAYLOAD }
  const lineTotal = (l: CartLine) => (l.price + (l.addOns || []).reduce((s, a) => s + (a.price || 0), 0)) * l.quantity
  const items = cart.filter(l => !isOrderCharge(l)).map(l => ({
    name: l.name,
    qty: l.quantity,
    unitPrice: l.price + (l.addOns || []).reduce((s, a) => s + (a.price || 0), 0),
    lineTotal: lineTotal(l),
    addOns: (l.addOns || []).map(a => a.name),
  }))
  const packagingFee = cart.filter(l => isOrderCharge(l)).reduce((s, l) => s + lineTotal(l), 0)
  const itemsSubtotal = items.reduce((s, i) => s + i.lineTotal, 0)
  const total = itemsSubtotal + packagingFee
  const isCash = details.paymentMethod === 'cash'
  const received = isCash && details.amountReceived !== '' && details.amountReceived != null ? Number(details.amountReceived) : null
  return {
    phase,
    orderKey,
    orderType: details.orderType === 'dine_in' || details.orderType === 'take_out' ? details.orderType : '',
    items,
    itemsSubtotal,
    packagingFee,
    total,
    paymentMethod: details.paymentMethod,
    amountReceived: received != null && !Number.isNaN(received) ? received : null,
    change: received != null && !Number.isNaN(received) && received >= total ? received - total : null,
    receipt,
  }
}

// Register side. Errors are swallowed: the Customer Display must never get
// in the way of ringing up a sale.
export async function publishLiveOrder(payload: LiveOrderPayload): Promise<void> {
  const { error } = await supabase.from('live_order').upsert({ id: 'main', payload })
  if (error) console.warn('Customer Display update failed:', error.message)
}

// Display side: the stored order and its age by the SERVER's clock (so an
// iPad with a wrong clock can't make an old order look fresh).
export async function fetchLiveOrder(): Promise<{ payload: LiveOrderPayload, ageMs: number } | null> {
  const { data, error } = await supabase.from('live_order_status').select('payload, age_seconds').eq('id', 'main').maybeSingle()
  if (error || !data) return null
  return { payload: data.payload as LiveOrderPayload, ageMs: Number(data.age_seconds) * 1000 }
}

// Per-device opt-in: only the register should publish its cart, or a phone
// open on Reports would overwrite the display with an empty cart.
const REGISTER_KEY = 'dimpzcafe-is-register'
export function isRegisterDevice(): boolean {
  try { return localStorage.getItem(REGISTER_KEY) === '1' } catch { return false }
}
export function setRegisterDevice(on: boolean) {
  try { on ? localStorage.setItem(REGISTER_KEY, '1') : localStorage.removeItem(REGISTER_KEY) } catch { /* private mode: stays off */ }
}
