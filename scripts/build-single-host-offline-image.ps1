[CmdletBinding()]
param(
  [string]$OutputPath = "",
  [string]$ContainerRegistry = "docker.1ms.run"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$appImage = "ai-canvas-cloud-single-host:offline"

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $repositoryRoot ".tmp\ai-canvas-cloud-single-host-image.tar"
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)

function Find-DockerExecutable {
  $command = Get-Command docker.exe -ErrorAction SilentlyContinue
  $candidates = @()
  if ($null -ne $command) {
    $candidates += $command.Source
  }
  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $candidates += Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"
  }
  if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
    $candidates += Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"
  }

  foreach ($candidate in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return $candidate
    }
  }
  throw "Docker CLI was not found. Install Docker Desktop first."
}

function Test-DockerEngine([string]$DockerExecutable) {
  & $DockerExecutable info --format "{{.OSType}}/{{.Architecture}}" *> $null
  return $LASTEXITCODE -eq 0
}

function Start-DockerEngine([string]$DockerExecutable) {
  if (Test-DockerEngine $DockerExecutable) {
    return
  }

  $desktopCandidates = @()
  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $desktopCandidates += Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe"
  }
  if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
    $desktopCandidates += Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  }
  $desktopExecutable = $desktopCandidates | Where-Object {
    Test-Path -LiteralPath $_ -PathType Leaf
  } | Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($desktopExecutable)) {
    throw "Docker Desktop is installed but its engine is not running. Start Docker Desktop and retry."
  }

  Write-Host "Starting Docker Desktop ..."
  Start-Process -FilePath $desktopExecutable | Out-Null
  for ($attempt = 1; $attempt -le 60; $attempt += 1) {
    Start-Sleep -Seconds 2
    if (Test-DockerEngine $DockerExecutable) {
      return
    }
  }
  throw "Docker Desktop did not become ready within 120 seconds."
}

function Invoke-Docker([string]$DockerExecutable, [string[]]$Arguments) {
  for ($attempt = 1; $attempt -le 3; $attempt += 1) {
    & $DockerExecutable @Arguments
    if ($LASTEXITCODE -eq 0) {
      return
    }
    if ($attempt -lt 3) {
      Write-Host "Docker command failed. Retrying ($attempt/3) ..."
      Start-Sleep -Seconds 5
    }
  }
  throw "Docker command failed after 3 attempts: docker $($Arguments -join ' ')"
}

function Assert-LinuxAmd64Image([string]$DockerExecutable, [string]$Image) {
  $platform = & $DockerExecutable image inspect $Image --format "{{.Os}}/{{.Architecture}}"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect image: $Image"
  }
  if ($platform.Trim() -ne "linux/amd64") {
    throw "Image $Image is $platform, expected linux/amd64."
  }
}

$dockerExecutable = Find-DockerExecutable
$dockerToolsDirectory = Split-Path -Parent $dockerExecutable
if (($env:PATH -split ";") -notcontains $dockerToolsDirectory) {
  $env:PATH = "$dockerToolsDirectory;$env:PATH"
}
Start-DockerEngine $dockerExecutable

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$temporaryArchive = "$OutputPath.partial"

Push-Location $repositoryRoot
try {
  Write-Host "Building the AI Canvas Cloud application image for linux/amd64 ..."
  Invoke-Docker $dockerExecutable @(
    "build",
    "--platform", "linux/amd64",
    "--build-arg", "CONTAINER_REGISTRY=$ContainerRegistry",
    "--target", "single-host-app",
    "--tag", $appImage,
    "."
  )
  Assert-LinuxAmd64Image $dockerExecutable $appImage

  Write-Host "Running the application image smoke test ..."
  Invoke-Docker $dockerExecutable @(
    "run", "--rm",
    "--platform", "linux/amd64",
    "--entrypoint", "node",
    $appImage,
    "-e", "import('./server/dist/modules/admin/postgresAdminService.js')"
  )

  if (Test-Path -LiteralPath $temporaryArchive) {
    Remove-Item -LiteralPath $temporaryArchive -Force
  }
  Write-Host "Exporting the application image ..."
  Invoke-Docker $dockerExecutable @(
    "save",
    "--output", $temporaryArchive,
    $appImage
  )
  Move-Item -LiteralPath $temporaryArchive -Destination $OutputPath -Force
}
finally {
  Pop-Location
  if (Test-Path -LiteralPath $temporaryArchive) {
    Remove-Item -LiteralPath $temporaryArchive -Force
  }
}

$archive = Get-Item -LiteralPath $OutputPath
$hash = Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256
$sizeMb = [Math]::Round($archive.Length / 1MB, 1)

Write-Host ""
Write-Host "Offline image archive is ready:"
Write-Host "  File: $OutputPath"
Write-Host "  Size: $sizeMb MB"
Write-Host "  SHA256: $($hash.Hash.ToLowerInvariant())"
