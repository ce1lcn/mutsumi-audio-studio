// 应用图标生成：只使用一张主图 app-icon-v3-source.png。
//  1. 旋转摆正（双眼水平）并以脸为中心裁切，叠加圆角描边，得到 1024px 母版 icon.png；
//  2. 所有 ICO 尺寸层都由母版直接缩小得到（不单独绘制小图标）。
// 用法：node resources/make-icon.js
const fs = require('node:fs/promises')
const path = require('node:path')
const sharp = require('sharp')

const root = path.resolve(__dirname, '..')
const SOURCE = path.join(__dirname, 'app-icon-v3-source.png')
const PNG_OUT = path.join(__dirname, 'icon.png')
const ICO_OUT = path.join(__dirname, 'icon.ico')
const TITLEBAR_OUT = path.join(root, 'src', 'assets', 'app-icon.png')

const MASTER = 1024
// 构图：原图中头部顺时针倾斜约 20°，以 (592, 468) 为脸部中心、边长 610 裁切
const COMPOSITION = { angle: 20, centerX: 592, centerY: 468, size: 610 }
// 框体：四周留 3% 安全边距，圆角 23%，渐变描边 6%
const FRAME = { inset: 0.03, radius: 0.23, ring: 0.06 }
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

async function composeArtwork(edge) {
  const { width, height } = await sharp(SOURCE).metadata()
  const rad = (COMPOSITION.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const rotatedWidth = Math.round(width * Math.abs(cos) + height * Math.abs(sin))
  const rotatedHeight = Math.round(width * Math.abs(sin) + height * Math.abs(cos))
  const dx = COMPOSITION.centerX - width / 2
  const dy = COMPOSITION.centerY - height / 2
  const cx = dx * cos - dy * sin + rotatedWidth / 2
  const cy = dx * sin + dy * cos + rotatedHeight / 2
  const rotated = await sharp(SOURCE).rotate(COMPOSITION.angle, { background: '#000000' }).toBuffer()
  return sharp(rotated)
    .extract({ left: Math.round(cx - COMPOSITION.size / 2), top: Math.round(cy - COMPOSITION.size / 2), width: COMPOSITION.size, height: COMPOSITION.size })
    .resize(edge, edge, { kernel: 'lanczos3' })
    .modulate({ saturation: 1.28, brightness: 1.0 })
    .linear(1.06, -6)
    .png()
    .toBuffer()
}

async function makeMaster() {
  const inset = Math.round(MASTER * FRAME.inset)
  const box = MASTER - inset * 2
  const radius = Math.round(box * FRAME.radius)
  const ring = Math.round(box * FRAME.ring)
  const innerBox = box - ring * 2
  const innerRadius = Math.max(0, radius - ring)

  const art = await composeArtwork(innerBox)
  const innerMask = Buffer.from(`<svg width="${innerBox}" height="${innerBox}"><rect width="${innerBox}" height="${innerBox}" rx="${innerRadius}" fill="#fff"/></svg>`)
  const innerArt = await sharp(art).composite([{ input: innerMask, blend: 'dest-in' }]).png().toBuffer()

  // 渐变描边（深薄荷 → 制服藏青 → 领结淡紫）+ 深色外轮廓，保证在浅色/深色任务栏上都有清晰边界
  const frame = Buffer.from(`
    <svg width="${MASTER}" height="${MASTER}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#4f9f7a"/>
          <stop offset="0.5" stop-color="#2c3a68"/>
          <stop offset="1" stop-color="#8a73cf"/>
        </linearGradient>
        <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/>
          <stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${radius}" fill="url(#ring)"/>
      <rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${radius}" fill="url(#gloss)"/>
      <rect x="${inset + 3}" y="${inset + 3}" width="${box - 6}" height="${box - 6}" rx="${radius - 3}" fill="none" stroke="#141a2c" stroke-opacity="0.7" stroke-width="10"/>
    </svg>`)
  const innerEdge = Buffer.from(`
    <svg width="${MASTER}" height="${MASTER}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${inset + ring}" y="${inset + ring}" width="${innerBox}" height="${innerBox}" rx="${innerRadius}" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="7"/>
    </svg>`)

  return sharp({ create: { width: MASTER, height: MASTER, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: frame },
      { input: innerArt, left: inset + ring, top: inset + ring },
      { input: innerEdge },
    ])
    .png()
    .toBuffer()
}

/** 32 位 BMP（DIB）图层：小尺寸使用经典格式，兼容托盘与旧版外壳 */
async function dibEntry(master, edge) {
  const { data } = await sharp(master).resize(edge, edge, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(edge, 4)
  header.writeInt32LE(edge * 2, 8) // 高度包含 AND 掩码
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16)
  const pixels = Buffer.alloc(edge * edge * 4)
  for (let y = 0; y < edge; y++) {
    for (let x = 0; x < edge; x++) {
      const from = (y * edge + x) * 4
      const to = ((edge - 1 - y) * edge + x) * 4 // 自下而上
      pixels[to] = data[from + 2]
      pixels[to + 1] = data[from + 1]
      pixels[to + 2] = data[from]
      pixels[to + 3] = data[from + 3]
    }
  }
  const maskStride = Math.ceil(edge / 32) * 4
  const mask = Buffer.alloc(maskStride * edge) // 全 0：透明度由 alpha 通道决定
  header.writeUInt32LE(pixels.length + mask.length, 20)
  return Buffer.concat([header, pixels, mask])
}

async function pngEntry(master, edge) {
  return sharp(master).resize(edge, edge, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer()
}

async function writeIco(master) {
  const images = await Promise.all(ICO_SIZES.map((edge) => (edge >= 256 ? pngEntry(master, edge) : dibEntry(master, edge))))
  const directory = Buffer.alloc(6 + ICO_SIZES.length * 16)
  directory.writeUInt16LE(0, 0)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(ICO_SIZES.length, 4)
  let offset = directory.length
  images.forEach((image, index) => {
    const entry = 6 + index * 16
    const edge = ICO_SIZES[index]
    directory[entry] = edge >= 256 ? 0 : edge
    directory[entry + 1] = edge >= 256 ? 0 : edge
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(image.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += image.length
  })
  await fs.writeFile(ICO_OUT, Buffer.concat([directory, ...images]))
}

async function main() {
  const master = await makeMaster()
  await fs.writeFile(PNG_OUT, master)
  await writeIco(master)
  await sharp(master).resize(96, 96, { kernel: 'lanczos3' }).png().toFile(TITLEBAR_OUT)
  console.log(`已生成 ${path.relative(root, PNG_OUT)}（${MASTER}px 母版）、${path.relative(root, ICO_OUT)}（${ICO_SIZES.join('/')}px）与标题栏图标`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
