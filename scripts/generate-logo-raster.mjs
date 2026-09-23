// Converts src/imports/dc logo.png into an ESC/POS `GS v 0` raster-image
// command and writes it as a base64 constant to src/lib/receiptLogo.ts.
//
// Rerun this whenever the logo image changes:
//   node scripts/generate-logo-raster.mjs
//
// GS v 0 (1D 76 30) prints an inline raster bit image with no NV-memory
// step and no line-height cap, unlike the legacy FS q/FS p "NV bit image"
// command this replaced — that one only supports images roughly one print
// line tall, and silently corrupted the printer's parser state for
// everything printed after it once our logo exceeded that.

import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const LOGO_PATH = path.join(ROOT, 'src/imports/dc logo.png')
const OUT_PATH = path.join(ROOT, 'src/lib/receiptLogo.ts')
const CANVAS_WIDTH_DOTS = 576 // 80mm printable width = 48 chars * 12 dots/char (Font A), 72 bytes/row
const CONTENT_WIDTH_DOTS = 320 // logo art width, centered in the canvas; byte-aligned (40 bytes)
const V_PAD_DOTS = 16 // blank rows above/below the art
const THRESHOLD = 165 // grayscale cutoff below which a pixel becomes a printed (black) dot

async function main() {
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
    throw new Error('CONTENT_WIDTH_DOTS must keep the canvas byte-aligned')
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

  // GS v 0: 1D 76 30 m xL xH yL yH d0...dk
  // m=0 (normal size), xL/xH = width in BYTES, yL/yH = height in DOTS.
  const xL = canvasWBytes & 0xff
  const xH = (canvasWBytes >> 8) & 0xff
  const yL = canvasH & 0xff
  const yH = (canvasH >> 8) & 0xff

  const header = Buffer.from([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH])
  const command = Buffer.concat([header, rasterBytes])

  const banner = '// GENERATED FILE — do not edit by hand.\n// Regenerate with: node scripts/generate-logo-raster.mjs\n'
  const contents = `${banner}\n// ESC/POS \`GS v 0\` raster-image command (1D 76 30) printing the Dimp'z Cafe\n// logo at ${CANVAS_WIDTH_DOTS}x${canvasH} dots. Concatenated inline into the Customer\n// Copy's byte stream — see PRINT_LOGO in printer.ts.\nexport const LOGO_RASTER_BASE64 = '${command.toString('base64')}'\n`

  writeFileSync(OUT_PATH, contents)
  console.log(`Wrote ${OUT_PATH} (${command.length} bytes raw, ${Math.ceil(command.length / 750)}KB base64)`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
