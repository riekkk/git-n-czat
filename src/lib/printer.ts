// PrintNode cloud API — chosen over QZ Tray specifically because QZ Tray
// only works on the same device as the browser (it talks to a local
// WebSocket), whereas PrintNode's REST API lets any device (Mac, iPad,
// etc.) trigger a print on the same registered printer.
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
}

export interface ReceiptOrder {
  id?: string
  createdAt?: string
  customerName?: string
  items: ReceiptItem[]
  subtotal: number
  total: number
  paymentMethod?: string
  businessName?: string
}

// The peso sign (₱, U+20B1) isn't in the code pages most ESC/POS thermal
// printers support and tends to print as garbage/a blank box, so the raw
// receipt uses a plain "P" prefix instead of the ₱ glyph used on-screen.
function formatMoneyForPrint(amount: number): string {
  return `P ${amount.toFixed(2)}`
}

function paymentLabelForPrint(method?: string): string {
  return method === 'card' ? 'Card' : method === 'cash' ? 'Cash' : method === 'gcash' ? 'GCash' : (method || '—')
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
  parts.push(divider)
  parts.push(wrapLine(`Customer: ${order.customerName || 'Walk-in'}`, width))
  parts.push(divider)

  order.items.forEach(item => {
    parts.push(wrapLine(item.name, width))
    parts.push(padLine(`${item.qty} x ${formatMoneyForPrint(item.price)}`, formatMoneyForPrint(item.price * item.qty), width))
  })

  parts.push(divider)
  parts.push(padLine('Subtotal', formatMoneyForPrint(order.subtotal), width))
  parts.push(padLine('TOTAL', formatMoneyForPrint(order.total), width))
  if (order.paymentMethod) {
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

/**
 * Prints a receipt via the PrintNode cloud API. Throws a specific,
 * staff-readable error on failure — callers should catch it and show the
 * message (missing API key vs. a failed API call are surfaced differently
 * since they need different fixes).
 */
export async function printReceipt(order: ReceiptOrder): Promise<void> {
  if (!PRINTNODE_API_KEY) {
    throw new Error('Printing is not configured — missing VITE_PRINTNODE_API_KEY.')
  }

  // One customer copy, one for the café's own records, plus the drawer
  // kick — sent as a single raw byte stream/print job rather than three
  // separate API calls, since the printer processes them sequentially
  // either way (kick drawer, print + cut, print + cut).
  const raw = KICK_DRAWER + buildReceiptText(order, 'CUSTOMER COPY') + buildReceiptText(order, 'CAFE COPY')

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
        title: `Receipt${order.id ? ` #${order.id.slice(0, 8).toUpperCase()}` : ''}`,
        contentType: 'raw_base64',
        content: toBase64(raw),
        source: order.businessName || 'POS',
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
