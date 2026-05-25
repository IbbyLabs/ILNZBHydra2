export type BackendUserInfos = {
  username?: string;
  authType?: string;
  maySeeSearch?: boolean;
  maySeeStats?: boolean;
  maySeeAdmin?: boolean;
  authConfigured?: boolean;
  safeConfig?: Record<string, unknown>;
};

export type BackendIndexerStatus = {
  indexer: string;
  state: string;
  level: number;
  disabledUntil?: string | null;
  lastError?: string | null;
  apiResetTime?: string | null;
  downloadResetTime?: string | null;
  apiHits?: number | null;
  apiHitLimit?: number | null;
  downloadHits?: number | null;
  downloadHitLimit?: number | null;
  vipExpirationDate?: string | null;
};

export type BackendStatsResponse = {
  avgResponseTimes?: Array<{ indexer: string; avgResponseTime: number; delta: number }>;
  numberOfConfiguredIndexers?: number;
  numberOfEnabledIndexers?: number;
};

export type BackendTaskInfo = {
  name: string;
  lastExecutionTime?: string | null;
  nextExecutionTime?: string | null;
};

export type BackendHistoryRequest = {
  page: number;
  limit: number;
  distinct: boolean;
  onlyCurrentUser: boolean;
  filterModel: Record<string, unknown>;
  sortModel: {
    column: string;
    sortMode: number;
  };
};

export type BackendPage<T> = {
  content: T[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
};

export type BackendSearchHistoryRow = {
  id: number;
  source?: string;
  searchType?: string;
  time?: string;
  categoryName?: string;
  query?: string;
  title?: string;
  username?: string;
  ip?: string;
};

export type BackendDownloadHistoryRow = {
  id: number;
  time?: string;
  status?: string;
  nzbAccessType?: string;
  accessSource?: string;
  age?: number;
  username?: string;
  ip?: string;
};

export type BackendNotificationHistoryRow = {
  id: number;
  time?: string;
  notificationEventType?: string;
  messageType?: string;
  title?: string;
  body?: string;
  displayed?: boolean;
};

export type BackendSavedSearch = {
  searchType?: string;
  categoryName?: string;
  query?: string;
  title?: string;
  season?: number;
  episode?: string;
};

export type BackendSearchState = {
  searchRequestId: number;
  indexerSelectionFinished: boolean;
  searchFinished: boolean;
  indexersSelected: number;
  indexersFinished: number;
  messages: Array<{
    message: string;
    messageSortValue: string;
  }>;
};

export type BackendConfigValidationResult = {
  ok: boolean;
  restartNeeded: boolean;
  errorMessages: string[];
  warningMessages: string[];
  newConfig?: Record<string, unknown>;
};

export type BackendVersionsInfo = {
  currentVersion?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  betaUpdateAvailable?: boolean;
  latestVersionIgnored?: boolean;
  wrapperOutdated?: boolean;
};

export type BackendBackupEntry = {
  filename: string;
  creationDate: string;
};

export type BackendNewsEntry = {
  version: string;
  news: string;
  forCurrentVersion: boolean;
  forNewerVersion: boolean;
};

export type BackendUserNewsEntry = {
  id: string;
  title: string;
  newsAsHtml: string;
};

export type BackendSimpleUpdateInfo = {
  currentVersion?: string;
  packageInfo?: {
    releaseType?: string;
    version?: string;
    author?: string;
  };
};

type ErrorWithStatus = Error & { status?: number };

function resolveBackendUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  const base = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "").replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

function buildErrorMessage(response: Response, path: string, body: string): string {
  const contentType = response.headers.get("content-type") ?? "";
  const fallback = `Backend request failed (${response.status}) for ${path}`;
  if (contentType.includes("text/html")) {
    return `${fallback}. Received HTML instead of API data. Check backend routing or NEXT_PUBLIC_BACKEND_URL.`;
  }
  const trimmed = body.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.length > 400 ? `${trimmed.slice(0, 400)}...` : trimmed;
}

async function parsePayload<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return (await response.text()) as T;
}

async function backendRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const resolvedPath = resolveBackendUrl(path);
  const response = await fetch(resolvedPath, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    const error: ErrorWithStatus = new Error(buildErrorMessage(response, resolvedPath, message));
    error.status = response.status;
    throw error;
  }

  return parsePayload<T>(response);
}

export function backendGet<T>(path: string): Promise<T> {
  return backendRequest<T>(path, { method: "GET" });
}

export function backendPut<T>(path: string, body?: unknown): Promise<T> {
  return backendRequest<T>(path, {
    method: "PUT",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function backendDelete<T>(path: string): Promise<T> {
  return backendRequest<T>(path, { method: "DELETE" });
}

export function backendPost<T>(path: string, body: unknown): Promise<T> {
  return backendRequest<T>(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export function defaultStatsRequest(): Record<string, unknown> {
  return {
    includeDisabled: false,
    indexerApiAccessStats: true,
    avgIndexerUniquenessScore: true,
    avgResponseTimes: true,
    indexerDownloadShares: false,
    downloadsPerDayOfWeek: false,
    downloadsPerHourOfDay: false,
    searchesPerDayOfWeek: false,
    searchesPerHourOfDay: false,
    downloadsPerAgeStats: false,
    successfulDownloadsPerIndexer: false,
    downloadSharesPerUser: false,
    downloadSharesPerIp: false,
    searchSharesPerUser: false,
    searchSharesPerIp: false,
    userAgentSearchShares: false,
    userAgentDownloadShares: false,
  };
}

export function defaultHistoryRequest(column = "time"): BackendHistoryRequest {
  return {
    page: 1,
    limit: 25,
    distinct: false,
    onlyCurrentUser: false,
    filterModel: {},
    sortModel: {
      column,
      sortMode: -1,
    },
  };
}

export function nextSearchRequestId(): number {
  return Date.now();
}