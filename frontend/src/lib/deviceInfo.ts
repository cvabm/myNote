/** 登录时上报的设备信息（展示用，非安全凭证；不含 IP） */
export type DeviceInfoPayload = {
  platform?: string;
  language?: string;
  languages?: string[];
  timezone?: string;
  screen?: string;
  colorDepth?: number;
  devicePixelRatio?: number;
  maxTouchPoints?: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  vendor?: string;
  brands?: string[];
  mobile?: boolean;
};

/** 采集浏览器环境信息 */
export function collectDeviceInfo(): DeviceInfoPayload {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return {};
  }

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: {
      brands?: { brand: string; version: string }[];
      mobile?: boolean;
      platform?: string;
    };
  };

  const info: DeviceInfoPayload = {
    platform: nav.userAgentData?.platform || nav.platform || undefined,
    language: nav.language || undefined,
    languages: nav.languages ? Array.from(nav.languages).slice(0, 8) : undefined,
    timezone: (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return undefined;
      }
    })(),
    screen:
      window.screen?.width && window.screen?.height
        ? `${window.screen.width}×${window.screen.height}`
        : undefined,
    colorDepth: window.screen?.colorDepth || undefined,
    devicePixelRatio: window.devicePixelRatio || undefined,
    maxTouchPoints: nav.maxTouchPoints || undefined,
    hardwareConcurrency: nav.hardwareConcurrency || undefined,
    deviceMemory: nav.deviceMemory || undefined,
    vendor: nav.vendor || undefined,
  };

  if (nav.userAgentData?.brands?.length) {
    info.brands = nav.userAgentData.brands
      .filter((b) => b.brand && !/not.?a.?brand/i.test(b.brand))
      .map((b) => `${b.brand} ${b.version}`.trim())
      .slice(0, 6);
    info.mobile = nav.userAgentData.mobile;
  }

  return info;
}
