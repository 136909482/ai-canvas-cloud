export type DeviceFormFactor = "desktop" | "tablet" | "mobile";

export interface DevicePresentation {
  browser: string;
  os: string;
  title: string;
  userAgent: string | null;
  formFactor: DeviceFormFactor;
}

export function formatAbsoluteTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatRelativeTime(value: string, now = Date.now()) {
  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return "时间未知";
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1_000));

  if (elapsedSeconds < 60) {
    return "刚刚";
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} 分钟前`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours} 小时前`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 30) {
    return `${elapsedDays} 天前`;
  }

  return formatAbsoluteTime(value);
}

export function getDevicePresentation(
  deviceLabel: string | null,
): DevicePresentation {
  const userAgent = deviceLabel?.trim() || null;
  const source = userAgent ?? "";
  const isTablet = /iPad|Tablet/i.test(source);
  const isMobile = !isTablet && /Android|iPhone|Mobile/i.test(source);

  let os = "未知系统";
  if (/Windows NT/i.test(source)) {
    os = "Windows";
  } else if (/Android/i.test(source)) {
    os = "Android";
  } else if (/iPhone|iPad|iPod/i.test(source)) {
    os = "iOS";
  } else if (/Macintosh|Mac OS X/i.test(source)) {
    os = "macOS";
  } else if (/Linux/i.test(source)) {
    os = "Linux";
  }

  let browser = "未知浏览器";
  if (/Electron/i.test(source)) {
    browser = "AI Canvas 客户端";
  } else if (/EdgA?\//i.test(source)) {
    browser = "Edge";
  } else if (/OPR\//i.test(source)) {
    browser = "Opera";
  } else if (/Firefox|FxiOS/i.test(source)) {
    browser = "Firefox";
  } else if (/Chrome|CriOS/i.test(source)) {
    browser = "Chrome";
  } else if (/Safari/i.test(source)) {
    browser = "Safari";
  }

  const hasRecognizedDevice = os !== "未知系统" || browser !== "未知浏览器";

  return {
    browser,
    os,
    title: hasRecognizedDevice
      ? `${browser} on ${os}`
      : userAgent || "未知设备",
    userAgent,
    formFactor: isTablet ? "tablet" : isMobile ? "mobile" : "desktop",
  };
}
