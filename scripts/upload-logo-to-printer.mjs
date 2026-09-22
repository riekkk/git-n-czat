// One-off script: converts src/imports/dc logo.png to a 1-bit monochrome
// raster and stores it in the XP-T80Q's onboard NV memory as image #1
// (ESC/POS `FS q`), so the Customer Copy print path can print it later with
// a 4-byte `FS p` reference instead of resending the bitmap on every job.
//
// Run once (or again if the logo image changes):
//   node scripts/upload-logo-to-printer.mjs
//
// Requires VITE_PRINTNODE_API_KEY in .env or .env.local (same key printer.ts
// uses at runtime) and prints nothing — defining an NV image does not feed
// paper. Follow with a real Customer Copy print to confirm it looks right.

import sharp from 'sharp'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const LOGO_PATH = path.join(ROOT, 'src/imports/dc logo.png')
const LOGO_NV_IMAGE_ID = 1 // must match LOGO_NV_IMAGE_ID in src/lib/printer.ts
const CANVAS_WIDTH_DOTS = 576 // 80mm printable width = 48 chars * 12 dots/char (Font A), 72 bytes/row
const CONTENT_WIDTH_DOTS = 320 // logo art width, centered in the canvas; byte-aligned (40 bytes)
const V_PAD_DOTS = 16 // blank rows above/below the art
const THRESHOLD = 165 // grayscale cutoff below which a pixel becomes a printed (black) dot

const PRINTNODE_PRINTER_ID = 75810640
const PRINTNODE_URL = 'https://api.printnode.com/printjobs'

function loadEnvVar(name) {
  if (process.env[name]) return process.env[name]
  for (const file of ['.env.local', '.env']) {
    const p = path.join(ROOT, file)
    if (!existsSync(p)) continue
    const match = readFileSync(p, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))
    if (match && match[1].trim()) return match[1].trim()
  }
  return undefined
}

// Same convention as printer.ts's toBase64(): each char code 0-255 is one
// raw byte, so plain btoa() carries the binary ESC/POS stream intact.
function toBase64(raw) {
  return Buffer.from(raw, 'binary').toString('base64')
}

async function buildStoreCommand() {
  const { data, info } = await sharp(LOGO_PATH)
    .trim({ threshold: 10 })
    .resize({ width: CONTENT_WIDTH_DOTS })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const contentW = info.width
  const contentH = info.height
  const canvasWBytes = CANVAS_WIDTH_DOTS / 8
  const canvasH = contentH + V_PAD_DOTS * 2
  const xOffsetBytes = (canvasWBytes - contentW / 8) / 2

  if (!Number.isInteger(xOffsetBytes)) {
    throw new Error('CONTENT_WIDTH_DOTS must keep the canvas byte-aligned (both widths a multiple of 8, difference/2 a multiple of 8)')
  }

  const rasterBytes = Buffer.alloc(canvasWBytes * canvasH, 0)
  for (let y = 0; y < contentH; y++) {
    for (let x = 0; x < contentW; x++) {
      const black = data[y * contentW + x] < THRESHOLD
      if (!black) continue
      const py = y + V_PAD_DOTS
      const px = x + xOffsetBytes * 8
      const rowStart = py * canvasWBytes
      const byteIndex = rowStart + Math.floor(px / 8)
      const bit = 0x80 >> (px % 8)
      rasterBytes[byteIndex] |= bit
    }
  }

  console.log(`Logo: content ${contentW}x${contentH} dots, canvas ${CANVAS_WIDTH_DOTS}x${canvasH} dots (${canvasWBytes} bytes/row)`)

  const xL = canvasWBytes & 0xff
  const xH = (canvasWBytes >> 8) & 0xff
  const yL = canvasH & 0xff
  const yH = (canvasH >> 8) & 0xff

  const FS = '\x1C'
  const header = `${FS}q${String.fromCharCode(1)}${String.fromCharCode(xL)}${String.fromCharCode(xH)}${String.fromCharCode(yL)}${String.fromCharCode(yH)}`
  const ESC_INIT = '\x1B@'

  return ESC_INIT + header + rasterBytes.toString('binary')
}

async function main() {
  const apiKey = loadEnvVar('VITE_PRINTNODE_API_KEY')
  if (!apiKey) {
    console.error('Missing VITE_PRINTNODE_API_KEY in .env / .env.local — same key printer.ts needs at runtime.')
    process.exit(1)
  }

  const raw = await buildStoreCommand()

  const response = await fetch(PRINTNODE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
    },
    body: JSON.stringify({
      printerId: PRINTNODE_PRINTER_ID,
      title: `Store Dimp'z Cafe logo to NV image #${LOGO_NV_IMAGE_ID}`,
      contentType: 'raw_base64',
      content: toBase64(raw),
      source: 'POS-logo-upload',
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`PrintNode rejected the upload (HTTP ${response.status}). ${body}`)
  }

  const job = await response.json()
  console.log(`Sent. PrintNode job id: ${job}`)
  console.log('This job stores the image only — it will not feed or print any paper.')
  console.log('Next: run a Customer Copy print and confirm the logo appears at the top.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
