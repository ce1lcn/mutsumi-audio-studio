$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  $version = (& node -p "require('./package.json').version").Trim()
  if ($version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Invalid package version: $version"
  }

  # 每个版本输出到独立目录，已存在则拒绝覆盖
  $outputDir = Join-Path $repoRoot "artifacts\mutsumi-audio-studio-$version"
  if (Test-Path -LiteralPath $outputDir) {
    throw "Refusing to overwrite an existing release directory: $outputDir. Bump the package version first."
  }

  & node resources/make-icon.js
  if ($LASTEXITCODE -ne 0) { throw "Icon generation failed with exit code $LASTEXITCODE" }

  & npm run typecheck
  if ($LASTEXITCODE -ne 0) { throw "Typecheck failed with exit code $LASTEXITCODE" }

  # 清掉旧构建产物，避免把过期文件打进安装包
  if (Test-Path -LiteralPath (Join-Path $repoRoot 'out')) { Remove-Item -LiteralPath (Join-Path $repoRoot 'out') -Recurse -Force }
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE" }

  & npm run package -- --win nsis zip "--config.directories.output=$outputDir"
  if ($LASTEXITCODE -ne 0) { throw "Packaging failed with exit code $LASTEXITCODE" }

  & node (Join-Path $PSScriptRoot 'write-release-checksums.cjs') $outputDir
  if ($LASTEXITCODE -ne 0) { throw "Checksum generation failed with exit code $LASTEXITCODE" }
  Write-Host "Release written to $outputDir"
}
finally {
  Pop-Location
}
