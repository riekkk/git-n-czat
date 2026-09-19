// PrintNode cloud API — chosen over QZ Tray specifically because QZ Tray
// only works on the same device as the browser (it talks to a local
// WebSocket), whereas PrintNode's REST API lets any device (Mac, iPad,
// etc.) trigger a print on the same registered printer.
import { DRINK_CATEGORIES, PASTRY_FOOD_CATEGORIES } from './categories'

const PRINTNODE_API_KEY = import.meta.env.VITE_PRINTNODE_API_KEY
const PRINTNODE_PRINTER_ID = 75810640
const PRINTNODE_URL = 'https://api.printnode.com/printjobs'

// 80mm paper, Font A — the standard 48-character width for this printer class.
const RECEIPT_WIDTH = 48

const ESC = '\x1B'
const GS = '\x1D'
const INIT = `${ESC}@`
const FULL_CUT = `${GS}V\x00`
// Pulses drawer-kick pin 2 (ESC p 0 25 250) — opens a cash drawer wired
// into the printer's RJ11/RJ12 drawer-kick port.
const KICK_DRAWER = `${ESC}p\x00\x19\xFA`

export interface ReceiptItem {
  name: string
  qty: number
  price: number
  category?: string
  note?: string
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

function paymentLabelForPrint(method?: string): string {
  return method === 'card' ? 'Card' : method === 'cash' ? 'Cash' : method === 'gcash' ? 'GCash' : method === 'staff' ? 'Staff' : (method || '—')
}

function orderTypeLabelForPrint(orderType?: string): string | null {
  return orderType === 'dine_in' ? 'Dine In' : orderType === 'take_out' ? 'Take Out' : null
}

// Appends a per-item special-instruction note in parentheses right after
// the item name (e.g. "Iced Caramel Macchiato (less ice, no whip)") — used
// on Cafe/Kitchen/Barista copies only, never the Customer Copy.
function itemNameForPrint(item: ReceiptItem): string {
  return item.note && item.note.trim() ? `${item.name} (${item.note.trim()})` : item.name
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
  if (copyLabel) {
    parts.push(centerLine(copyLabel, width))
  }
  parts.push(centerLine((order.businessName || 'Receipt').toUpperCase(), width))
  parts.push(centerLine(
    new Date(order.createdAt || Date.now()).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }),
    width
  ))
  if (order.id) {
    parts.push(centerLine(`Order #${order.id.slice(0, 8).toUpperCase()}`, width))
  }
  const orderTypeLabel = orderTypeLabelForPrint(order.orderType)
  if (orderTypeLabel) {
    parts.push(centerLine(`Order Type: ${orderTypeLabel}`, width))
  }
  parts.push(divider)
  parts.push(wrapLine(`Customer: ${order.customerName || 'Walk-in'}`, width))
  parts.push(divider)

  // Per-item notes are café-facing prep context, not something a customer
  // needs to see on their own copy, so they're gated to the Cafe Copy.
  const showItemNotes = copyLabel === 'CAFE COPY'
  order.items.forEach(item => {
    parts.push(wrapLine(showItemNotes ? itemNameForPrint(item) : item.name, width))
    parts.push(padLine(`${item.qty} x ${formatMoneyForPrint(item.price)}`, formatMoneyForPrint(item.price * item.qty), width))
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
  const foodItems = order.items.filter(item => item.category && PASTRY_FOOD_CATEGORIES.has(item.category))
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
    parts.push(centerLine(`Order Type: ${kitchenOrderTypeLabel}`, width))
  }
  parts.push(wrapLine(`Customer: ${order.customerName || 'Walk-in'}`, width))
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
  const drinkItems = order.items.filter(item => item.category && DRINK_CATEGORIES.has(item.category))
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
    parts.push(centerLine(`Order Type: ${baristaOrderTypeLabel}`, width))
  }
  parts.push(wrapLine(`Customer: ${order.customerName || 'Walk-in'}`, width))
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

// Shared by printReceipt and openCashDrawer — sends a raw ESC/POS byte
// stream to the registered printer via PrintNode. Throws a specific,
// staff-readable error on failure (missing API key vs. a failed API call
// are surfaced differently since they need different fixes).
async function sendToPrinter(raw: string, title: string, source?: string): Promise<void> {
  if (!PRINTNODE_API_KEY) {
    throw new Error('Printing is not configured — missing VITE_PRINTNODE_API_KEY.')
  }

  let response: Response
  try {
    response = await fetch(PRINTNODE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${PRINTNODE_API_KEY}:`)}`,
      },
      body: JSON.stringify({
        printerId: PRINTNODE_PRINTER_ID,
        title,
        contentType: 'raw_base64',
        content: toBase64(raw),
        source: source || 'POS',
      }),
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not reach PrintNode — check your internet connection. (${detail})`)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`PrintNode could not print (HTTP ${response.status}) — check the printer is online in PrintNode.${body ? ` Details: ${body}` : ''}`)
  }
}

/**
 * Prints a receipt via the PrintNode cloud API — see sendToPrinter for the
 * error contract.
 */
export async function printReceipt(order: ReceiptOrder): Promise<void> {
  // One customer copy, one for the café's own records, and — only when the
  // order has the relevant item type — a kitchen prep slip and/or a barista
  // slip. All sent as a single raw byte stream/print job rather than
  // separate API calls, since the printer processes them sequentially
  // either way (kick drawer, print + cut, print + cut, [print + cut], [print
  // + cut]).
  const hasFoodItems = order.items.some(item => item.category && PASTRY_FOOD_CATEGORIES.has(item.category))
  const hasDrinkItems = order.items.some(item => item.category && DRINK_CATEGORIES.has(item.category))
  const raw = KICK_DRAWER
    + buildReceiptText(order, 'CUSTOMER COPY')
    + buildReceiptText(order, 'CAFE COPY')
    + (hasFoodItems ? buildKitchenReceiptText(order) : '')
    + (hasDrinkItems ? buildBaristaReceiptText(order) : '')

  await sendToPrinter(raw, `Receipt${order.id ? ` #${order.id.slice(0, 8).toUpperCase()}` : ''}`, order.businessName)
}

/**
 * Pulses the drawer-kick line directly — no receipt, no order, nothing
 * printed. Used for the standalone "Open Cash Drawer" button so staff can
 * pop the drawer for change/shift counts without running a transaction.
 */
export async function openCashDrawer(): Promise<void> {
  await sendToPrinter(INIT + KICK_DRAWER, 'Open Cash Drawer')
}

/**
 * Prints a receipt for a staff order (employee meal/drink) — Cafe Copy
 * always (accountability record), plus Kitchen/Barista when relevant, same
 * as a regular order. No Customer Copy (there's no paying customer) and no
 * drawer kick (no cash changes hands). Every copy is stamped "STAFF ORDER".
 */
export async function printStaffOrderReceipt(order: ReceiptOrder): Promise<void> {
  const staffOrder: ReceiptOrder = { ...order, isStaffOrder: true }
  const hasFoodItems = order.items.some(item => item.category && PASTRY_FOOD_CATEGORIES.has(item.category))
  const hasDrinkItems = order.items.some(item => item.category && DRINK_CATEGORIES.has(item.category))
  const raw = buildReceiptText(staffOrder, 'CAFE COPY')
    + (hasFoodItems ? buildKitchenReceiptText(staffOrder) : '')
    + (hasDrinkItems ? buildBaristaReceiptText(staffOrder) : '')

  await sendToPrinter(raw, `Staff Order${order.id ? ` #${order.id.slice(0, 8).toUpperCase()}` : ''}`, order.businessName)
}

export type ReprintCopyType = 'customer' | 'cafe' | 'kitchen' | 'barista'

/**
 * Reprints a single copy of a past order from its stored transaction data.
 * No drawer kick (that's tied to completing the original sale, not a
 * reprint), no new transaction, no inventory effect — purely a print
 * action. The slip is stamped with a reprint banner (see reprintBanner)
 * so it's never mistaken for the original.
 */
export async function reprintReceipt(order: ReceiptOrder, copyType: ReprintCopyType): Promise<void> {
  const reprintOrder: ReceiptOrder = { ...order, isReprint: true }
  // isStaffOrder passes through from the caller (order.isStaffOrder) so a
  // reprinted staff-order slip still shows the STAFF ORDER banner.
  const raw = copyType === 'customer' ? buildReceiptText(reprintOrder, 'CUSTOMER COPY')
    : copyType === 'cafe' ? buildReceiptText(reprintOrder, 'CAFE COPY')
    : copyType === 'kitchen' ? buildKitchenReceiptText(reprintOrder)
    : buildBaristaReceiptText(reprintOrder)

  await sendToPrinter(
    raw,
    `Reprint${order.id ? ` #${order.id.slice(0, 8).toUpperCase()}` : ''} (${copyType})`,
    order.businessName
  )
}
