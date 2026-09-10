import qz from 'qz-tray'

// Single source of truth for the printer's address — change here (or via
// the VITE_PRINTER_HOST/VITE_PRINTER_PORT env vars) if it ever changes.
const PRINTER_HOST = import.meta.env.VITE_PRINTER_HOST || '192.168.254.120'
const PRINTER_PORT = Number(import.meta.env.VITE_PRINTER_PORT) || 9100

// 80mm paper, Font A — the standard 48-character width for this printer class.
const RECEIPT_WIDTH = 48

const ESC = '\x1B'
const GS = '\x1D'
const INIT = `${ESC}@`
const FULL_CUT = `${GS}V\x00`

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

let connected = false
let connecting: Promise<void> | null = null

/** Connects to the local QZ Tray WebSocket, once per session. */
export async function connectPrinter(): Promise<void> {
  if (connected || qz.websocket.isActive()) {
    connected = true
    return
  }
  if (connecting) {
    return connecting
  }
  connecting = qz.websocket.connect().then(() => {
    connected = true
  })
  try {
    await connecting
  } finally {
    connecting = null
  }
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

function buildReceiptText(order: ReceiptOrder): string {
  const width = RECEIPT_WIDTH
  const divider = `${'-'.repeat(width)}\n`
  const parts: string[] = [INIT]

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
  parts.push('\n\n\n')
  parts.push(FULL_CUT)

  return parts.join('')
}

/**
 * Prints a receipt to the thermal printer over raw ESC/POS via QZ Tray.
 * Throws a specific, staff-readable error on failure — callers should
 * catch it and show the message (QZ Tray not running vs. printer
 * unreachable are surfaced differently since they need different fixes).
 */
export async function printReceipt(order: ReceiptOrder): Promise<void> {
  try {
    await connectPrinter()
  } catch {
    throw new Error('Could not connect to QZ Tray. Make sure QZ Tray is running on this computer, then try again.')
  }

  try {
    const config = qz.configs.create({
      host: PRINTER_HOST,
      port: { passthrough: PRINTER_PORT },
    })
    const data = [{ type: 'raw', format: 'plain', data: buildReceiptText(order) }]
    await qz.print(config, data)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not print — check that the printer at ${PRINTER_HOST}:${PRINTER_PORT} is powered on and connected to the network. (${detail})`)
  }
}
