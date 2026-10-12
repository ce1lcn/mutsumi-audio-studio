const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

async function sha256(file) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function main() {
  if (!process.argv[2]) throw new Error('Release directory is required')
  const directory = path.resolve(process.argv[2])
  const names = fs.readdirSync(directory).filter((name) => /\.(exe|zip)$/i.test(name)).sort()
  if (!names.some((name) => /\.exe$/i.test(name)) || !names.some((name) => /\.zip$/i.test(name))) {
    throw new Error('Release must contain both an installer and a ZIP')
  }
  const lines = []
  for (const name of names) lines.push(`${await sha256(path.join(directory, name))}  ${name}`)
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(`Wrote ${lines.length} release checksums`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
