import { useCallback, useEffect, useMemo, useState } from "react";
import type { DeviceSummary } from "@ai-canvas-cloud/contracts";
import {
  Laptop,
  Loader2,
  RefreshCw,
  Smartphone,
  Tablet,
  Trash2,
} from "lucide-react";
import { fetchAuthDevices, removeAuthDevice } from "./api";
import {
  formatAbsoluteTime,
  formatRelativeTime,
  getDevicePresentation,
} from "./devicePresentation";
import { useAuthStore } from "./useAuthStore";
import { themeClasses } from "@/styles/themeClasses";

export function DeviceSettingsPanel() {
  const session = useAuthStore((state) => state.session);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null);

  const currentDeviceRecord = useMemo(
    () => devices.find((item) => item.current) ?? null,
    [devices],
  );
  const currentDevice = useMemo(
    () =>
      currentDeviceRecord
        ? getDevicePresentation(currentDeviceRecord.deviceLabel)
        : null,
    [currentDeviceRecord],
  );

  const loadDevices = useCallback(async () => {
    setIsLoadingDevices(true);
    setDevicesError(null);

    try {
      const response = await fetchAuthDevices();
      setDevices(response.devices);
    } catch (error) {
      setDevicesError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingDevices(false);
    }
  }, []);

  useEffect(() => {
    if (session) {
      void loadDevices();
    }
  }, [loadDevices, session]);

  if (!session) {
    return null;
  }

  const handleRemoveDevice = async (deviceId: string) => {
    setRemovingDeviceId(deviceId);
    setDevicesError(null);

    try {
      await removeAuthDevice(deviceId);
      setDevices((current) => current.filter((item) => item.id !== deviceId));
    } catch (error) {
      setDevicesError(error instanceof Error ? error.message : String(error));
    } finally {
      setRemovingDeviceId(null);
    }
  };

  return (
    <section className="mx-auto w-full max-w-4xl">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={`text-xs leading-5 ${themeClasses.textMuted}`}>
            查看当前设备和曾经登录过的设备。移除只会删除历史记录，不会让该设备永久失去登录资格。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadDevices()}
          disabled={isLoadingDevices}
          aria-label="刷新设备列表"
          title="刷新设备列表"
          className={`${themeClasses.iconButton} h-8 w-8 shrink-0 rounded-[8px] disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isLoadingDevices ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      <div className="mb-4 flex min-h-10 flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)] px-3 py-2">
        <span className={`text-xs font-medium ${themeClasses.textSecondary}`}>
          已记录设备{" "}
          <strong className={`ml-1 font-semibold ${themeClasses.textPrimary}`}>
            {devices.length}
          </strong>
        </span>
        <span
          className={`max-w-full truncate text-[11px] ${themeClasses.textMuted}`}
        >
          {currentDevice
            ? `本机：${currentDevice.title} · ${currentDevice.os}`
            : "正在识别当前设备"}
        </span>
      </div>

      <div className="space-y-2.5">
        {devices.map((item) => {
          const device = getDevicePresentation(item.deviceLabel);
          const DeviceIcon =
            device.formFactor === "tablet"
              ? Tablet
              : device.formFactor === "mobile"
                ? Smartphone
                : Laptop;
          const isRemoving = removingDeviceId === item.id;

          return (
            <article
              key={item.id}
              className="flex items-start gap-3 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] px-3.5 py-3"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--control-bg-hover)] text-[var(--text-secondary)]">
                <DeviceIcon className="h-4 w-4" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 pr-1">
                  <strong
                    className={`min-w-0 truncate text-[13px] font-semibold ${themeClasses.textPrimary}`}
                  >
                    {device.title}
                  </strong>
                  {item.current ? (
                    <span className="rounded-[5px] bg-emerald-400/15 px-1.5 py-0.5 text-[9px] font-medium text-emerald-300">
                      本机
                    </span>
                  ) : null}
                  <span className="rounded-[5px] bg-[var(--control-bg-hover)] px-1.5 py-0.5 text-[9px] text-[var(--text-muted)]">
                    {device.os}
                  </span>
                </div>

                <div
                  className={`mt-1 space-y-0.5 text-[10px] leading-4 ${themeClasses.textMuted}`}
                >
                  <p>
                    最近活跃：{formatRelativeTime(item.lastSeenAt)}（
                    {formatAbsoluteTime(item.lastSeenAt)}）
                  </p>
                  <p>首次登录：{formatAbsoluteTime(item.firstSeenAt)}</p>
                  <p className="truncate" title={device.userAgent ?? undefined}>
                    {device.userAgent ?? "未记录设备 User Agent"}
                  </p>
                </div>
              </div>

              {!item.current ? (
                <button
                  type="button"
                  disabled={isRemoving}
                  onClick={() => void handleRemoveDevice(item.id)}
                  aria-label={`移除 ${device.title}`}
                  className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] border border-red-400/35 px-2 text-[10px] font-medium text-red-400 transition hover:border-red-400/60 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRemoving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  移除
                </button>
              ) : null}
            </article>
          );
        })}

        {!isLoadingDevices && devices.length === 0 ? (
          <div
            className={`rounded-[10px] border border-dashed border-[var(--border-subtle)] px-4 py-8 text-center text-xs ${themeClasses.textMuted}`}
          >
            暂时没有可显示的登录设备。
          </div>
        ) : null}
      </div>

      {devicesError ? (
        <div
          role="alert"
          className="mt-3 rounded-[10px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-500 dark:text-red-200"
        >
          {devicesError}
        </div>
      ) : null}
    </section>
  );
}
