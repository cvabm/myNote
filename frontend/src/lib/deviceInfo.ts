/** 登录时上报的设备信息（展示用，非安全凭证） */
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
  /** 与 curl ip.im 同类：浏览器侧查到的公网 IP / 归属地 */
  publicIp?: string;
  city?: string;
  region?: string;
  country?: string;
  isp?: string;
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/**
 * 浏览器主动问公网 IP 服务（原理同 curl ip.im：
 * 你的浏览器连出去，对方服务器看到出口 IP 再返回给你）。
 * 本站在 Docker/反代后往往只能看到 172.x，所以用这条补公网 IP + 城市。
 */
export async function fetchPublicNetworkInfo(): Promise<
  Pick<DeviceInfoPayload, 'publicIp' | 'city' | 'region' | 'country' | 'isp'>
> {
  // 1) ipapi.co：IP + 城市（浏览器 CORS 可用）
  try {
    const r = await withTimeout(
      fetch('https://ipapi.co/json/', { credentials: 'omit' }),
      3500
    );
    if (r.ok) {
      const j = (await r.json()) as Record<string, unknown>;
      if (typeof j.ip === 'string' && j.ip) {
        return {
          publicIp: j.ip,
          city: typeof j.city === 'string' ? j.city : undefined,
          region: typeof j.region === 'string' ? j.region : undefined,
          country:
            typeof j.country_name === 'string'
              ? j.country_name
              : typeof j.country === 'string'
                ? j.country
                : undefined,
          isp: typeof j.org === 'string' ? j.org : undefined,
        };
      }
    }
  } catch {
    /* try next */
  }

  // 2) ipify：仅 IP
  try {
    const r = await withTimeout(
      fetch('https://api.ipify.org?format=json', { credentials: 'omit' }),
      2500
    );
    if (r.ok) {
      const j = (await r.json()) as { ip?: string };
      if (j.ip) return { publicIp: j.ip };
    }
  } catch {
    /* ignore */
  }

  return {};
}

/** 采集浏览器环境（同步） */
export function collectDeviceInfoSync(): DeviceInfoPayload {
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

/** 设备信息 + 公网 IP/城市（登录时调用） */
export async function collectDeviceInfo(): Promise<DeviceInfoPayload> {
  const base = collectDeviceInfoSync();
  const net = await fetchPublicNetworkInfo();
  return { ...base, ...net };
}
