export function formatStorageBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const formatted = new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: unitIndex === 0 ? 0 : value < 10 ? 2 : 1,
  }).format(value)

  return `${formatted} ${units[unitIndex]}`
}

export function getStorageUsagePercentage(totalBytes: number, quotaBytes: number) {
  if (!Number.isFinite(totalBytes) || !Number.isFinite(quotaBytes) || totalBytes <= 0 || quotaBytes <= 0) {
    return 0
  }

  return Math.min(100, Math.round((totalBytes / quotaBytes) * 1000) / 10)
}
