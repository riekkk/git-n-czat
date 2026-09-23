// Converts src/imports/dc logo.png into a sequence of ESC/POS `GS v 0`
// raster-image commands and writes them as a base64 constant to
// src/lib/receiptLogo.ts.
//
// Rerun this whenever the logo image changes:
//   node scripts/generate-logo-raster.mjs
//
// History: an earlier version sent the logo as ONE tall GS v 0 command on a
// full-width (576-dot) canvas with the art padded/centered inside it. That
// printed nothing on the XP-T80Q, with the rest of the receipt printing
// clean — meaning the printer correctly parsed and skipped the command
// (unlike the FS q/FS p attempt before that, which desynced the parser and
// garbled everything downstream) but declined to render it. Two likely
// causes, both addressed here:
//  1. The 576-dot declared width may exceed this printer's actual print-head
//     dot capacity (clones commonly ship 512-dot 80mm heads, not 576) — an
//     out-of-range image can get silently dropped rather than clipped.
//     Fixed by making the image exactly as wide as the visible art (320
//     dots / 40 bytes) — comfortably inside any real 80mm head — and using
//     ESC/POS's native `ESC a 1` center-justify command instead of baking
//     blank padding into the bitmap to fake centering.
//  2. Many clone firmwares only reliably render a single GS v 0 command up
//     to roughly 255 dots tall; taller single images are a known source of
//     silent no-ops. Fixed by splitting the image into horizontal bands no
//     taller than MAX_CHUNK_HEIGHT_DOTS and emitting one GS v 0 per band,
//     back to back with no gap — they print as one continuous image.

import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const LOGO_PATH = path.join(ROOT, 'src/imports/dc logo.png')
const OUT_PATH = path.join(ROOT, 'src/lib/receiptLogo.ts')
const CONTENT_WIDTH_DOTS = 208 // byte-aligned (26 bytes); ~65% of the original 320-dot size, which printed too large
const V_PAD_DOTS = 16 // blank rows above/below the art
const THRESHOLD = 165 // grayscale cutoff below which a pixel becomes a printed (black) dot
const MAX_CHUNK_HEIGHT_DOTS = 200 // conservative margin under the ~255-dot ceiling several clone firmwares impose per GS v 0 call

function gsv0(widthBytes, heightDots, rows) {
  const xL = widthBytes & 0xff
  const xH = (widthBytes >> 8) & 0xff
  const yL = heightDots & 0xff
  const yH = (heightDots >> 8) & 0xff
  const header = Buffer.from([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH])
  return Buffer.concat([header, rows])
}

async function main() {
  const { data, info } = await sharp(LOGO_PATH)
    .trim({ threshold: 10 })
    .resize({ width: CONTENT_WIDTH_DOTS })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const contentW = info.width
  const contentH = info.height
  const widthBytes = contentW / 8
  const totalH = contentH + V_PAD_DOTS * 2

  if (!Number.isInteger(widthBytes)) {
    throw new Error('CONTENT_WIDTH_DOTS must be a multiple of 8')
  }

  const rasterBytes = Buffer.alloc(widthBytes * totalH, 0)
  for (let y = 0; y < contentH; y++) {
    for (let x = 0; x < contentW; x++) {
      const black = data[y * contentW + x] < THRESHOLD
      if (!black) continue
      const py = y + V_PAD_DOTS
      const byteIndex = py * widthBytes + Math.floor(x / 8)
      const bit = 0x80 >> (x % 8)
      rasterBytes[byteIndex] |= bit
    }
  }

  console.log(`Logo: ${contentW}x${totalH} dots (${widthBytes} bytes/row), content ${contentH} dots tall + ${V_PAD_DOTS}px pad`)

  const chunks = []
  for (let y = 0; y < totalH; y += MAX_CHUNK_HEIGHT_DOTS) {
    const chunkH = Math.min(MAX_CHUNK_HEIGHT_DOTS, totalH - y)
    const rows = rasterBytes.subarray(y * widthBytes, (y + chunkH) * widthBytes)
    chunks.push(gsv0(widthBytes, chunkH, rows))
  }
  console.log(`Split into ${chunks.length} GS v 0 band(s) of <= ${MAX_CHUNK_HEIGHT_DOTS} dots each`)

  const CENTER_JUSTIFY = Buffer.from([0x1b, 0x61, 0x01]) // ESC a 1
  const command = Buffer.concat([CENTER_JUSTIFY, ...chunks])

  const banner = '// GENERATED FILE — do not edit by hand.\n// Regenerate with: node scripts/generate-logo-raster.mjs\n'
  const contents = `${banner}\n// ESC/POS commands printing the Dimp'z Cafe logo (${contentW}x${totalH} dots):\n// ESC a 1 (center-justify) followed by ${chunks.length} \`GS v 0\` raster band(s),\n// each <= ${MAX_CHUNK_HEIGHT_DOTS} dots tall. Concatenated inline into the Customer\n// Copy's byte stream — see PRINT_LOGO in printer.ts, which appends INIT\n// after this to reset justification and print state.\nexport const LOGO_RASTER_BASE64 = '${command.toString('base64')}'\n`

  writeFileSync(OUT_PATH, contents)
  console.log(`Wrote ${OUT_PATH} (${command.length} bytes raw, ${Math.ceil(command.length / 750)}KB base64)`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
