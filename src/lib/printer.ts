// PrintNode cloud API — chosen over QZ Tray specifically because QZ Tray
// only works on the same device as the browser (it talks to a local
// WebSocket), whereas PrintNode's REST API lets any device (Mac, iPad,
// etc.) trigger a print on the same registered printer.
import { DRINK_CATEGORIES, PASTRY_FOOD_CATEGORIES, isOrderCharge } from './categories'
import { LOGO_RASTER_BASE64 } from './receiptLogo'
import { fetchPrintStation } from './api'

const PRINTNODE_API_KEY = import.meta.env.VITE_PRINTNODE_API_KEY
const PRINTNODE_URL = 'https://api.printnode.com/printjobs'

// The computers a receipt printer is registered on in PrintNode. Which one
// is active is NOT set here: it's the 'print_station' row in app_settings
// (chosen in Settings → Print Station), read before every print job by
// resolvePrinterId — the single source of truth for all print paths.
export const PRINT_STATIONS = [
  { label: 'MacBook', printerName: 'Dimpz_Cafe_Printer', printerId: 75810640 },
  { label: 'Huawei laptop', printerName: 'xprinter - dimpz cafe', printerId: 75880371 },
]

// Last station read successfully, used only if a fresh read fails (e.g. a
// brief network blip right after a sale) so the receipt still prints to
// the station this device last knew about rather than not at all.
let lastKnownPrinterId: number | null = null

async function resolvePrinterId(): Promise<number> {
  try {
    const station = await fetchPrintStation(AbortSignal.timeout(5000))
    if (station?.printerId) {
      lastKnownPrinterId = station.printerId
      return station.printerId
    }
  } catch {
    // fall through to the last known station
  }
  if (lastKnownPrinterId) return lastKnownPrinterId
  throw new Error('No print station is set — choose one in Settings → Print Station.')
}

// 80mm paper, Font A — the standard 48-character width for this printer class.
const RECEIPT_WIDTH = 48

const ESC = '\x1B'
const GS = '\x1D'
const INIT = `${ESC}@`
const FULL_CUT = `${GS}V\x00`
// Pulses drawer-kick pin 2 (ESC p 0 25 250) — opens a cash drawer wired
// into the printer's RJ11/RJ12 drawer-kick port.
const KICK_DRAWER = `${ESC}p\x00\x19\xFA`

// Dimp'z Cafe logo, printed inline via ESC/POS `GS v 0` (raster bit image —
// see scripts/generate-logo-raster.mjs, rerun it if the logo image changes).
// Customer Copy only — see buildReceiptText.
//
// This replaced an earlier attempt using the legacy `FS q`/`FS p` "NV bit
// image" commands (store once on the printer, print by reference). That
// command is capped at roughly one print line's height — our logo was far
// taller — and the oversized image desynced the printer's parser, garbling
// every byte printed after it in the same job. GS v 0 has no such cap and
// carries the bitmap inline instead of relying on NV storage, so there's no
// separate upload step and no stored state that can go stale or corrupt.
// It's followed by INIT to force the printer back to a known text state
// before the rest of the receipt, in case a clone leaves line-spacing or
// print position altered after a raster image.
const PRINT_LOGO = atob(LOGO_RASTER_BASE64) + INIT

export interface ReceiptAddOn {
  name: string
  price: number
  productId?: string | null
}

export interface ReceiptItem {
  name: string
  qty: number
  price: number
  category?: string
  note?: string
  addOns?: ReceiptAddOn[]
}

// Sum of an item's selected add-ons' prices — add-ons are billable, unlike
// the free-text note, so this rolls into the line's displayed unit price
// wherever a receipt shows one (never on Kitchen/Barista, which show no
// prices at all).
function addOnsCost(item: ReceiptItem): number {
  return (item.addOns || []).reduce((sum, a) => sum + (a.price || 0), 0)
}

// Every copy (and every Kitchen/Barista trigger check) prints from this,
// never order.items directly — order-level charges like the packaging fee
// stay in the order total but never print as a line (see isOrderCharge).
function printableItems(order: ReceiptOrder): ReceiptItem[] {
  return order.items.filter(item => !isOrderCharge(item))
}

export interface ReceiptOrder {
  id?: string
  createdAt?: string
  customerName?: string
  items: ReceiptItem[]
  subtotal: number
  total: number
  paymentMethod?: string
  amountReceived?: number
  change?: number
  orderType?: string
  businessName?: string
  isReprint?: boolean
  isStaffOrder?: boolean
}

// The peso sign (₱, U+20B1) isn't in the code pages most ESC/POS thermal
// printers support and tends to print as garbage/a blank box, so the raw
// receipt uses a plain "P" prefix instead of the ₱ glyph used on-screen.
function formatMoneyForPrint(amount: number): string {
  return `P ${amount.toFixed(2)}`
}

// Free text (business name, customer name, item names, notes) comes from
// user input and can carry curly quotes, em-dashes, accented letters, or
// stray Unicode — none of which are safe to send as raw bytes. The Xprinter
// XP-T80Q's active code page (Page0) is a single-byte table that only
// matches Unicode for the plain ASCII range (0x20-0x7E); any byte above
// that renders under whatever glyph Page0 assigns it, not the Unicode
// character we meant (e.g. an accented "é" turning into a box-drawing
// character or a Greek letter) — that's the "foreign/garbled characters"
// bug. Rather than guessing the right ESC/POS "select code page" command
// for a table we haven't verified, this folds text down to plain ASCII,
// which prints identically under any single-byte code page:
//   - decomposes accented Latin letters and drops the accent (é → e)
//   - maps curly quotes/dashes/ellipsis to their plain ASCII equivalents
//   - replaces the peso sign and anything else left with 'P' / '?'
function sanitizeForPrint(text?: string): string {
  if (!text) return text || ''
  return text
    .replace(/₱/g, 'P')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E]/g, '?')
}

function paymentLabelForPrint(method?: string): string {
  return method === 'card' ? 'Card' : method === 'cash' ? 'Cash' : method === 'gcash' ? 'GCash' : method === 'staff' ? 'Staff' : (method || '—')
}

function orderTypeLabelForPrint(orderType?: string): string | null {
  return orderType === 'dine_in' ? 'Dine In' : orderType === 'take_out' ? 'Take Out' : null
}

// Builds the printed item name: base name, then selected add-ons joined
// with "+", then (optionally) the free-text note in parentheses — e.g.
// "Iced Caramel Macchiato + Extra Shot, Oat Milk (less ice)". Add-ons are
// billable so they print on every copy including Customer; the note is
// internal prep context, so callers on the Customer Copy pass
// includeNote=false to omit just that part.
function itemNameForPrint(item: ReceiptItem, includeNote = true): string {
  const addOnNames = (item.addOns || []).map(a => sanitizeForPrint(a.name)).join(', ')
  const name = sanitizeForPrint(item.name) + (addOnNames ? ` + ${addOnNames}` : '')
  if (!includeNote) return name
  const note = sanitizeForPrint(item.note?.trim())
  return note ? `${name} (${note})` : name
}

// Stamped at the very top of a reprinted slip — with its own timestamp,
// distinct from the order's original date/time further down — so it's
// never mistaken for the original transaction printout.
function reprintBanner(width: number): string {
  return centerLine('*** REPRINT ***', width)
    + centerLine(`Reprinted ${new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}`, width)
}

// Marks a slip as an employee meal/drink rather than a paying customer's
// order — printed instead of/alongside the reprint banner so anyone
// reviewing the paper trail can immediately tell it's excluded from sales.
function staffOrderBanner(width: number): string {
  return centerLine('*** STAFF ORDER ***', width)
}

// Bold + double-height for the lines staff scan for first (customer name,
// order type) on the café-side copies. Double-height only — double-width
// would halve the 48-column line and break centerLine/wrapLine's math.
// Both settings are reset right after the line (after its newline, so the
// whole line prints enlarged) so nothing printed next inherits them.
const EMPHASIS_ON = `${ESC}E\x01${GS}!\x01`
const EMPHASIS_OFF = `${GS}!\x00${ESC}E\x00`
function emphasize(line: string): string {
  return `${EMPHASIS_ON}${line}${EMPHASIS_OFF}`
}

function padLine(left: string, right: string, width = RECEIPT_WIDTH): string {
  const gap = Math.max(1, width - left.length - right.length)
  return `${left}${' '.repeat(gap)}${right}\n`
}

function centerLine(text: string, width = RECEIPT_WIDTH): string {
  const pad = Math.max(0, Math.floor((width - text.length) / 2))
  return `${' '.repeat(pad)}${text}\n`
}

function wrapLine(text: string, width = RECEIPT_WIDTH): string {
  return text.length <= width ? `${text}\n` : `${text.slice(0, width)}\n${text.slice(width)}\n`
}

function buildReceiptText(order: ReceiptOrder, copyLabel?: string): string {
  const width = RECEIPT_WIDTH
  const divider = `${'-'.repeat(width)}\n`
  const parts: string[] = [INIT]

  if (order.isReprint) {
    parts.push(reprintBanner(width))
  }
  if (order.isStaffOrder) {
    parts.push(staffOrderBanner(width))
  }
  if (copyLabel === 'CUSTOMER COPY') {
    parts.push(PRINT_LOGO)
  }
  if (copyLabel) {
    parts.push(centerLine(copyLabel, width))
  }
  parts.push(centerLine(sanitizeForPrint(order.businessName || 'Receipt').toUpperCase(), width))
  parts.push(centerLine(
    new Date(order.createdAt || Date.now()).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }),
    width
  ))
  if (order.id) {
    parts.push(centerLine(`Order #${order.id.slice(0, 8).toUpperCase()}`, width))
  }
  // Customer Copy stays plain; every other copy from here (Cafe) gets the
  // bold/tall name + order type — see emphasize.
  const emphasis = copyLabel === 'CUSTOMER COPY' ? (line: string) => line : emphasize
  const orderTypeLabel = orderTypeLabelForPrint(order.orderType)
  if (orderTypeLabel) {
    parts.push(emphasis(centerLine(`Order Type: ${orderTypeLabel}`, width)))
  }
  parts.push(divider)
  parts.push(emphasis(wrapLine(`Customer: ${sanitizeForPrint(order.customerName) || 'Walk-in'}`, width)))
  parts.push(divider)

  // Per-item notes are café-facing prep context, not something a customer
  // needs to see on their own copy, so they're gated to the Cafe Copy —
  // add-ons print on both since they're billable and change the line price.
  const showItemNotes = copyLabel === 'CAFE COPY'
  printableItems(order).forEach(item => {
    const unitPrice = item.price + addOnsCost(item)
    parts.push(wrapLine(itemNameForPrint(item, showItemNotes), width))
    parts.push(padLine(`${item.qty} x ${formatMoneyForPrint(unitPrice)}`, formatMoneyForPrint(unitPrice * item.qty), width))
  })

  parts.push(divider)
  parts.push(padLine('Subtotal', formatMoneyForPrint(order.subtotal), width))
  if (order.paymentMethod === 'cash' && order.amountReceived != null) {
    parts.push(padLine('Cash Received', formatMoneyForPrint(order.amountReceived), width))
    parts.push(padLine('Change', formatMoneyForPrint(order.change ?? 0), width))
  }
  parts.push(padLine('TOTAL', formatMoneyForPrint(order.total), width))
  if (order.paymentMethod && !order.isStaffOrder) {
    parts.push(wrapLine(`Payment: ${paymentLabelForPrint(order.paymentMethod)}`, width))
  }
  parts.push('\n')
  parts.push(centerLine('Thank you for your purchase!', width))
  parts.push(centerLine('Please come again', width))
  // Extra clearance so the cutter doesn't slice through the last text line.
  parts.push('\n\n\n\n\n')
  parts.push(FULL_CUT)

  return parts.join('')
}

// Kitchen prep slip — food items only (no prices, kitchen staff don't need
// them), tagged with the order number/timestamp so it can be matched back
// to the customer's order. Skipped entirely for drinks-only orders.
function buildKitchenReceiptText(order: ReceiptOrder): string {
  const width = RECEIPT_WIDTH
  const divider = `${'-'.repeat(width)}\n`
  const foodItems = printableItems(order).filter(item => item.category && PASTRY_FOOD_CATEGORIES.has(item.category))
  const parts: string[] = [INIT]

  if (order.isReprint) {
    parts.push(reprintBanner(width))
  }
  if (order.isStaffOrder) {
    parts.push(staffOrderBanner(width))
  }
  parts.push(centerLine('KITCHEN COPY', width))
  parts.push(centerLine(
    new Date(order.createdAt || Date.now()).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }),
    width
  ))
  if (order.id) {
    parts.push(centerLine(`Order #${order.id.slice(0, 8).toUpperCase()}`, width))
  }
  const kitchenOrderTypeLabel = orderTypeLabelForPrint(order.orderType)
  if (kitchenOrderTypeLabel) {
    parts.push(emphasize(centerLine(`Order Type: ${kitchenOrderTypeLabel}`, width)))
  }
  parts.push(emphasize(wrapLine(`Customer: ${sanitizeForPrint(order.customerName) || 'Walk-in'}`, width)))
  parts.push(divider)

  foodItems.forEach(item => {
    parts.push(wrapLine(`${item.qty} x ${itemNameForPrint(item)}`, width))
  })

  parts.push(divider)
  parts.push('\n\n\n\n\n')
  parts.push(FULL_CUT)

  return parts.join('')
}

// Barista slip — drink items only (no prices, same shape as the Kitchen
// Copy), tagged with the order number/timestamp so it can be matched back
// to the customer's order. Skipped entirely for food-only orders. No
// modifiers (size, "Iced", "Extra shot", etc.) are included since the
// product/cart data model doesn't carry per-item modifiers today.
function buildBaristaReceiptText(order: ReceiptOrder): string {
  const width = RECEIPT_WIDTH
  const divider = `${'-'.repeat(width)}\n`
  const drinkItems = printableItems(order).filter(item => item.category && DRINK_CATEGORIES.has(item.category))
  const parts: string[] = [INIT]

  if (order.isReprint) {
    parts.push(reprintBanner(width))
  }
  if (order.isStaffOrder) {
    parts.push(staffOrderBanner(width))
  }
  parts.push(centerLine('BARISTA COPY', width))
  parts.push(centerLine(
    new Date(order.createdAt || Date.now()).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }),
    width
  ))
  if (order.id) {
    parts.push(centerLine(`Order #${order.id.slice(0, 8).toUpperCase()}`, width))
  }
  const baristaOrderTypeLabel = orderTypeLabelForPrint(order.orderType)
  if (baristaOrderTypeLabel) {
    parts.push(emphasize(centerLine(`Order Type: ${baristaOrderTypeLabel}`, width)))
  }
  parts.push(emphasize(wrapLine(`Customer: ${sanitizeForPrint(order.customerName) || 'Walk-in'}`, width)))
  parts.push(divider)

  drinkItems.forEach(item => {
    parts.push(wrapLine(`${item.qty} x ${itemNameForPrint(item)}`, width))
  })

  parts.push(divider)
  parts.push('\n\n\n\n\n')
  parts.push(FULL_CUT)

  return parts.join('')
}

// btoa treats a string as raw bytes (each char code 0-255 -> one output
// byte), which is exactly what our ESC/POS control codes need — unlike
// UTF-8 encoding, which would re-encode any byte above 0x7F (e.g. the 0xFA
// in the drawer-kick command) into a multi-byte sequence and corrupt it.
// Free-text input (customer/item names) could contain a stray character
// outside that range, so those get swapped for '?' first rather than
// throwing and failing the whole print job.
function toBase64(raw: string): string {
  const safe = raw.replace(/[^\x00-\xFF]/g, '?')
  return btoa(safe)
}

// ─── Print job lifetime ────────────────────────────────────────────────────
// How long PrintNode may hold a job it couldn't deliver before discarding it
// (its `expireAfter` option, in seconds). PrintNode's default is 14 days —
// which is why, after a station went offline, every receipt it missed
// printed in one burst when it came back. A receipt that can't print within
// its window is dropped instead, and the cashier is told to use Reprint.
export const PRINT_EXPIRY_SECONDS = {
  checkoutReceipt: 60,
  staffOrder: 60,
  // Strictest: a cash drawer must never pop open minutes after the sale.
  drawerKick: 15,
  // A person is standing at the printer waiting for a reprint.
  reprint: 300,
} as const

// After a job's expiry window, how much longer to wait for PrintNode to
// report its final state before calling it failed.
const STATUS_GRACE_SECONDS = 10
const STATUS_POLL_MS = 3000

export const RECEIPT_DID_NOT_PRINT = 'Receipt did not print. Use Reprint in Reports.'

// ─── Print problem notices ─────────────────────────────────────────────────
// Checkout and staff-order printing finish in the background (the sale is
// already saved), often after the cashier has moved on to the next order,
// so their failures are announced app-wide rather than on the checkout
// screen. App renders these as dismissible notices.
export interface PrintProblem { id: string, message: string }
const problemListeners = new Set<(problem: PrintProblem) => void>()
export function onPrintProblem(listener: (problem: PrintProblem) => void): () => void {
  problemListeners.add(listener)
  return () => { problemListeners.delete(listener) }
}
function reportPrintProblem(message: string) {
  const problem = { id: `${Date.now()}-${Math.random()}`, message }
  problemListeners.forEach(listener => listener(problem))
}

function orderLabel(order: ReceiptOrder): string {
  return order.id ? `Order #${order.id.slice(0, 8).toUpperCase()}` : 'this order'
}

function newRequestId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function authHeader() {
  return { Authorization: `Basic ${btoa(`${PRINTNODE_API_KEY}:`)}` }
}

interface PrintJobRequest {
  raw: string
  title: string
  source?: string
  expireAfter: number
  // Sent as PrintNode's X-Idempotency-Key: the same key within 24h is
  // rejected (HTTP 409) instead of printing again.
  idempotencyKey: string
}

// The single send path for every print job (receipts, reprints, staff-order
// slips, drawer kicks). Returns PrintNode's job id. Throws a staff-readable
// error if the job couldn't be submitted. Never retries — a retried job is
// exactly how an old receipt comes back later.
async function sendToPrinter({ raw, title, source, expireAfter, idempotencyKey }: PrintJobRequest): Promise<number> {
  if (!PRINTNODE_API_KEY) {
    throw new Error('Printing is not configured — missing VITE_PRINTNODE_API_KEY.')
  }

  const printerId = await resolvePrinterId()

  let response: Response
  try {
    response = await fetch(PRINTNODE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(),
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        printerId,
        title,
        contentType: 'raw_base64',
        content: toBase64(raw),
        source: source || 'POS',
        expireAfter,
      }),
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach PrintNode — check your internet connection. (${detail})`)
  }

  if (response.status === 409) {
    throw new Error('This was already sent to the printer. For another copy, use Reprint in Reports.')
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`PrintNode could not print (HTTP ${response.status}) — check the printer is online in PrintNode.${body ? ` Details: ${body}` : ''}`)
  }
  return Number(await response.json())
}

const FINAL_OK = new Set(['done'])
const FINAL_FAILED = new Set(['error', 'expired', 'deleted'])

// Polls PrintNode until every job reaches a final state, or the expiry
// window (+ grace) passes. Resolves true only if every job reached `done`
// (handed to the station's print queue). On timeout, asks PrintNode to
// cancel whatever is left so it can't print late.
async function waitForJobs(jobIds: number[], expireAfter: number): Promise<boolean> {
  if (jobIds.length === 0) return true
  const deadline = Date.now() + (expireAfter + STATUS_GRACE_SECONDS) * 1000
  const pending = new Set(jobIds)
  let failed = false
  while (pending.size > 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, STATUS_POLL_MS))
    try {
      const res = await fetch(`${PRINTNODE_URL}/${[...pending].join(',')}`, { headers: authHeader() })
      if (!res.ok) continue
      const jobs: { id: number, state: string }[] = await res.json()
      for (const job of jobs) {
        if (FINAL_OK.has(job.state)) pending.delete(job.id)
        else if (FINAL_FAILED.has(job.state)) { pending.delete(job.id); failed = true }
      }
    } catch {
      // network blip while polling — keep waiting until the deadline
    }
  }
  if (pending.size > 0) {
    fetch(`${PRINTNODE_URL}/${[...pending].join(',')}`, { method: 'DELETE', headers: authHeader() }).catch(() => {})
    return false
  }
  return !failed
}

// One job per receipt copy, each with its own idempotency key, so a copy
// can never be printed twice by a retry or double-click.
interface CopyJob { key: string, raw: string, title: string }

async function sendCopies(copies: CopyJob[], expireAfter: number, source?: string): Promise<number[]> {
  const jobIds: number[] = []
  let firstError: unknown = null
  for (const copy of copies) {
    try {
      jobIds.push(await sendToPrinter({ raw: copy.raw, title: copy.title, source, expireAfter, idempotencyKey: copy.key }))
    } catch (err) {
      firstError = firstError || err
    }
  }
  if (firstError) {
    // Whatever did go out is still watched, so its outcome isn't lost.
    if (jobIds.length) waitForJobs(jobIds, expireAfter).then(ok => { if (!ok) reportPrintProblem(RECEIPT_DID_NOT_PRINT) })
    throw firstError
  }
  return jobIds
}

function receiptCopies(order: ReceiptOrder, keyPrefix: string, withCustomerCopy: boolean): CopyJob[] {
  const label = orderLabel(order)
  const hasFoodItems = printableItems(order).some(item => item.category && PASTRY_FOOD_CATEGORIES.has(item.category))
  const hasDrinkItems = printableItems(order).some(item => item.category && DRINK_CATEGORIES.has(item.category))
  return [
    ...(withCustomerCopy ? [{ key: `${keyPrefix}:customer`, raw: buildReceiptText(order, 'CUSTOMER COPY'), title: `${label} (customer)` }] : []),
    { key: `${keyPrefix}:cafe`, raw: buildReceiptText(order, 'CAFE COPY'), title: `${label} (cafe)` },
    ...(hasFoodItems ? [{ key: `${keyPrefix}:kitchen`, raw: buildKitchenReceiptText(order), title: `${label} (kitchen)` }] : []),
    ...(hasDrinkItems ? [{ key: `${keyPrefix}:barista`, raw: buildBaristaReceiptText(order), title: `${label} (barista)` }] : []),
  ]
}

/**
 * Checkout printing: drawer kick, then Customer + Cafe copies and — when the
 * order has those items — Kitchen and Barista slips. Resolves once the jobs
 * are submitted (throws if submission fails, so Checkout can say so); the
 * sale is already saved by then. Whether they actually printed is checked in
 * the background and reported via onPrintProblem. The returned promise
 * (`printed`) resolves true/false once that's known.
 */
export async function printReceipt(order: ReceiptOrder): Promise<{ printed: Promise<boolean> }> {
  const keyPrefix = order.id || newRequestId()

  // The drawer kick is its own job so it can carry the strictest expiry.
  // An order with nothing printable (only the packaging fee) prints no paper
  // at all — it still kicks the drawer, since money still changed hands.
  let drawerJob: number | null = null
  let drawerError: unknown = null
  try {
    drawerJob = await sendToPrinter({ raw: INIT + KICK_DRAWER, title: `${orderLabel(order)} (drawer)`, source: order.businessName, expireAfter: PRINT_EXPIRY_SECONDS.drawerKick, idempotencyKey: `${keyPrefix}:drawer` })
  } catch (err) {
    drawerError = err
  }
  if (drawerJob !== null) {
    waitForJobs([drawerJob], PRINT_EXPIRY_SECONDS.drawerKick).then(ok => {
      if (!ok) reportPrintProblem(`Cash drawer didn't open for ${orderLabel(order)}. Use the Open Cash Drawer button.`)
    })
  }

  const copies = printableItems(order).length === 0 ? [] : receiptCopies(order, keyPrefix, true)
  const jobIds = await sendCopies(copies, PRINT_EXPIRY_SECONDS.checkoutReceipt, order.businessName)
  if (drawerError && copies.length === 0) throw drawerError

  const printed = waitForJobs(jobIds, PRINT_EXPIRY_SECONDS.checkoutReceipt).then(ok => {
    if (!ok) reportPrintProblem(`${RECEIPT_DID_NOT_PRINT} (${orderLabel(order)})`)
    return ok
  })
  return { printed }
}

/**
 * Pulses the drawer-kick line directly — no receipt, no order, nothing
 * printed. Used for the standalone "Open Cash Drawer" button so staff can
 * pop the drawer for change/shift counts without running a transaction.
 * Waits for the result (the person is standing at the drawer) and throws
 * if it didn't open within the drawer-kick window.
 */
export async function openCashDrawer(): Promise<void> {
  const jobId = await sendToPrinter({ raw: INIT + KICK_DRAWER, title: 'Open Cash Drawer', expireAfter: PRINT_EXPIRY_SECONDS.drawerKick, idempotencyKey: `drawer:${newRequestId()}` })
  if (!(await waitForJobs([jobId], PRINT_EXPIRY_SECONDS.drawerKick))) {
    throw new Error("The cash drawer didn't open — check the Print Station is connected (header), then try again.")
  }
}

/**
 * Prints a receipt for a staff order (employee meal/drink) — Cafe Copy
 * always (accountability record), plus Kitchen/Barista when relevant, same
 * as a regular order. No Customer Copy (there's no paying customer) and no
 * drawer kick (no cash changes hands). Every copy is stamped "STAFF ORDER".
 * Same submit-then-check-in-background contract as printReceipt.
 */
export async function printStaffOrderReceipt(order: ReceiptOrder): Promise<{ printed: Promise<boolean> }> {
  // Nothing printable (only the packaging fee) — no paper, no drawer kick.
  if (printableItems(order).length === 0) return { printed: Promise.resolve(true) }
  const staffOrder: ReceiptOrder = { ...order, isStaffOrder: true }
  const jobIds = await sendCopies(receiptCopies(staffOrder, `${order.id || newRequestId()}:staff`, false), PRINT_EXPIRY_SECONDS.staffOrder, order.businessName)
  const printed = waitForJobs(jobIds, PRINT_EXPIRY_SECONDS.staffOrder).then(ok => {
    if (!ok) reportPrintProblem(`Staff order slip did not print (${orderLabel(order)}). Use Reprint in Staff Orders Log.`)
    return ok
  })
  return { printed }
}

export type ReprintCopyType = 'customer' | 'cafe' | 'kitchen' | 'barista'

/**
 * Reprints a single copy of a past order from its stored transaction data.
 * No drawer kick (that's tied to completing the original sale, not a
 * reprint), no new transaction, no inventory effect — purely a print
 * action. The slip is stamped with a reprint banner (see reprintBanner)
 * so it's never mistaken for the original.
 *
 * `requestId` identifies this one button press (the caller disables the
 * button while it's in flight), so a double-submit can't print twice but a
 * deliberate later reprint still can. Waits for the outcome and throws if
 * it didn't print within the reprint window.
 */
export async function reprintReceipt(order: ReceiptOrder, copyType: ReprintCopyType, requestId: string = newRequestId()): Promise<void> {
  // ReprintButtons hides every option for these, but guard here too so a
  // fee-only order can never feed paper.
  if (printableItems(order).length === 0) {
    throw new Error('Nothing to print — this order only has the packaging fee.')
  }
  const reprintOrder: ReceiptOrder = { ...order, isReprint: true }
  // isStaffOrder passes through from the caller (order.isStaffOrder) so a
  // reprinted staff-order slip still shows the STAFF ORDER banner.
  const raw = copyType === 'customer' ? buildReceiptText(reprintOrder, 'CUSTOMER COPY')
    : copyType === 'cafe' ? buildReceiptText(reprintOrder, 'CAFE COPY')
    : copyType === 'kitchen' ? buildKitchenReceiptText(reprintOrder)
    : buildBaristaReceiptText(reprintOrder)

  const jobId = await sendToPrinter({
    raw,
    title: `Reprint ${orderLabel(order)} (${copyType})`,
    source: order.businessName,
    expireAfter: PRINT_EXPIRY_SECONDS.reprint,
    idempotencyKey: `${order.id || 'order'}:${copyType}:reprint:${requestId}`,
  })
  if (!(await waitForJobs([jobId], PRINT_EXPIRY_SECONDS.reprint))) {
    throw new Error("The reprint didn't print — check the Print Station is connected (header), then try Reprint again.")
  }
}

// ─── Print Station status (header indicator) ───────────────────────────────
export interface PrintStationStatus {
  label: string
  printerId: number
  connected: boolean
  computerName?: string
}

// Whether the active station's computer is Connected in PrintNode — the
// only state in which a job can reach the printer right away.
export async function getPrintStationStatus(): Promise<PrintStationStatus> {
  const station = await fetchPrintStation(AbortSignal.timeout(5000))
  if (!station?.printerId) throw new Error('No print station is set')
  const option = PRINT_STATIONS.find(o => o.printerId === station.printerId)
  const label = station.label || option?.label || `Printer ${station.printerId}`
  if (!PRINTNODE_API_KEY) return { label, printerId: station.printerId, connected: false }
  const res = await fetch(`https://api.printnode.com/printers/${station.printerId}`, { headers: authHeader(), signal: AbortSignal.timeout(8000) })
  if (!res.ok) return { label, printerId: station.printerId, connected: false }
  const [printer] = await res.json()
  return { label, printerId: station.printerId, connected: printer?.computer?.state === 'connected', computerName: printer?.computer?.name }
}
