import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import { basename, join } from 'path'
import type { CatalogFile, RvcCatalog, RvcEngine } from '../../shared/contracts'

async function listByExtension(directory: string, extension: string): Promise<CatalogFile[]> {
  if (!directory || !existsSync(directory)) return []
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension))
      .map((entry) => ({ name: entry.name.slice(0, -extension.length), path: join(directory, entry.name) }))
  } catch {
    return []
  }
}

async function collect(directories: string[], extension: string): Promise<CatalogFile[]> {
  const batches = await Promise.all([...new Set(directories)].map((directory) => listByExtension(directory, extension)))
  const byPath = new Map<string, CatalogFile>()
  for (const file of batches.flat()) if (!byPath.has(file.path.toLowerCase())) byPath.set(file.path.toLowerCase(), file)
  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

/** RVC 工程常见的 UVR 权重目录（新旧两种布局） */
export function uvrDirectories(rootPath: string): string[] {
  return rootPath ? [join(rootPath, 'weights', 'uvr5'), join(rootPath, 'assets', 'uvr5_weights')] : []
}

export async function scanRvcCatalog(engine: RvcEngine): Promise<RvcCatalog> {
  const root = engine.rootPath
  const problems: string[] = []
  if (!root || !existsSync(root)) problems.push(root ? `RVC 根目录不存在：${root}` : '尚未设置 RVC 根目录')
  if (!engine.pythonPath || !existsSync(engine.pythonPath)) problems.push(engine.pythonPath ? `RVC Python 解释器不存在：${engine.pythonPath}` : '尚未设置 RVC Python 解释器')

  const modelDirs = root ? [join(root, 'weights'), join(root, 'assets', 'weights'), ...engine.modelDirs] : engine.modelDirs
  const indexDirs = root ? [join(root, 'indices'), join(root, 'logs'), ...engine.indexDirs] : engine.indexDirs
  const [models, indices, uvrFiles] = await Promise.all([
    collect(modelDirs, '.pth'),
    collect(indexDirs, '.index'),
    collect(uvrDirectories(root), '.pth'),
  ])
  // 新旧两种目录可能有同名 UVR 权重，按名称去重（与 worker 查找顺序一致）
  const uvrModels = uvrFiles.filter((item, index) => uvrFiles.findIndex((other) => other.name === item.name) === index)
  // UVR 目录中的权重不是声音模型
  const uvrPaths = new Set(uvrFiles.map((item) => item.path.toLowerCase()))
  const voiceModels = models.filter((item) => !uvrPaths.has(item.path.toLowerCase()))

  if (root && existsSync(root)) {
    if (!voiceModels.length) problems.push('没有找到 RVC 声音模型（.pth）；可在设置中添加模型目录')
    if (!uvrModels.length) problems.push('没有找到 UVR 分离模型（weights/uvr5 或 assets/uvr5_weights）')
    const hubert = [join(root, 'assets', 'hubert', 'hubert_base.pt'), join(root, 'hubert_base.pt')]
    if (!hubert.some(existsSync)) problems.push('缺少 hubert_base.pt')
    const rmvpe = [join(root, 'assets', 'rmvpe', 'rmvpe.pt'), join(root, 'assets', 'rmvpe.pt'), join(root, 'rmvpe.pt')]
    if (!rmvpe.some(existsSync)) problems.push('缺少 rmvpe.pt')
  }
  uvrModels.sort((a, b) => (a.name === 'HP5_only_main_vocal' ? -1 : b.name === 'HP5_only_main_vocal' ? 1 : a.name.localeCompare(b.name)))
  return { models: voiceModels, indices, uvrModels, problems }
}

/** 根据模型文件名猜测匹配的索引 */
export function matchIndex(modelPath: string, indices: CatalogFile[]): string {
  const stem = basename(modelPath).replace(/\.pth$/i, '').toLowerCase().replace(/[-_](local|cloud|v\d+)$/i, '')
  if (!stem) return ''
  return indices.find((item) => item.name.toLowerCase().includes(stem))?.path || ''
}
