const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// 打包后写入 EXE 图标与版本信息。
// 版本信息里的 FileDescription 决定任务栏固定项、任务管理器中显示的名称（未写入时显示为 “Electron”）。
module.exports = async function applyWindowsResources(context) {
  if (context.electronPlatformName !== 'win32') return

  const editor = path.join(path.dirname(require.resolve('electron-winstaller/package.json')), 'vendor', 'rcedit.exe')
  const appInfo = context.packager.appInfo
  const executable = path.join(context.appOutDir, `${appInfo.productFilename}.exe`)
  const stagedExecutable = path.join(context.appOutDir, 'icon-edit-stage.exe')
  const icon = path.join(__dirname, '..', 'resources', 'icon.ico')
  for (const file of [editor, executable, icon]) {
    if (!fs.existsSync(file)) throw new Error(`Required icon packaging file is missing: ${file}`)
  }

  const version = appInfo.version
  const args = [
    stagedExecutable,
    '--set-icon', icon,
    '--set-file-version', version,
    '--set-product-version', version,
    '--set-version-string', 'FileDescription', appInfo.productName,
    '--set-version-string', 'ProductName', appInfo.productName,
    '--set-version-string', 'CompanyName', appInfo.companyName || 'CZY',
    '--set-version-string', 'LegalCopyright', appInfo.copyright || '',
    '--set-version-string', 'InternalName', appInfo.productFilename,
    '--set-version-string', 'OriginalFilename', `${appInfo.productFilename}.exe`,
  ]

  // rcedit 在本机无法打开非 ASCII 文件名的 EXE：先改 ASCII 名副本，再复制回去（在生成 NSIS/ZIP 之前）
  fs.copyFileSync(executable, stagedExecutable)
  try {
    const result = spawnSync(editor, args, { windowsHide: true, encoding: 'utf8' })
    if (result.error || result.status !== 0) {
      throw new Error(`Could not update executable resources: ${result.error?.message || result.stderr || result.stdout}`)
    }
    fs.copyFileSync(stagedExecutable, executable)
  } finally {
    fs.rmSync(stagedExecutable, { force: true })
  }
  console.log(`Applied icon and version info (${appInfo.productName} ${version}) to ${path.basename(executable)}`)
}
