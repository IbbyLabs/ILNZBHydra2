"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  BackendDownloadHistoryRow,
  BackendIndexerStatus,
  BackendNotificationHistoryRow,
  BackendPage,
  BackendSavedSearch,
  BackendSearchHistoryRow,
  BackendStatsResponse,
  BackendUserInfos,
  backendDelete,
  backendGet,
  backendPost,
  defaultHistoryRequest,
  defaultStatsRequest,
} from "@/lib/backend";

const tabDefs = [
  { key: "indexers", href: "/stats/indexers", label: "Indexer statuses" },
  { key: "searches", href: "/stats/searches", label: "Search history" },
  { key: "saved-searches", href: "/stats/saved-searches", label: "Saved searches" },
  { key: "downloads", href: "/stats/downloads", label: "Download history" },
  { key: "notifications", href: "/stats/notifications", label: "Notification history" },
  { key: "stats", href: "/stats/stats", label: "Deep stats" },
];

type SearchDetails = {
  username?: string;
  ip?: string;
  userAgent?: string;
  source?: string;
  details?: Array<{
    indexer?: string;
    successful?: boolean;
    resultsCount?: number;
  }>;
};

export default function StatsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<BackendStatsResponse | null>(null);
  const [statuses, setStatuses] = useState<BackendIndexerStatus[]>([]);
  const [searches, setSearches] = useState<BackendPage<BackendSearchHistoryRow> | null>(null);
  const [downloads, setDownloads] = useState<BackendPage<BackendDownloadHistoryRow> | null>(null);
  const [notifications, setNotifications] = useState<BackendPage<BackendNotificationHistoryRow> | null>(null);
  const [savedSearches, setSavedSearches] = useState<BackendSavedSearch[]>([]);
  const [userInfos, setUserInfos] = useState<BackendUserInfos | null>(null);
  const [searchDetails, setSearchDetails] = useState<SearchDetails | null>(null);
  const [searchDetailsLoading, setSearchDetailsLoading] = useState(false);
  const [searchDetailsRequestId, setSearchDetailsRequestId] = useState<number | null>(null);
  const [searchDetailsError, setSearchDetailsError] = useState<string | null>(null);

  const pathname = usePathname();
  const selectedTab = pathname.split("/")[2] || "indexers";
  const tabs = useMemo(
    () => tabDefs.map((tab) => ({ href: tab.href, label: tab.label, active: tab.key === selectedTab })),
    [selectedTab],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const baseCalls = [
          backendPost<BackendStatsResponse>("/internalapi/stats", defaultStatsRequest()),
          backendGet<BackendIndexerStatus[]>("/internalapi/indexerstatuses"),
          backendGet<BackendUserInfos>("/internalapi/userinfos"),
        ] as const;

        if (selectedTab === "searches") {
          const [statsResponse, statusResponse, userResponse, searchesResponse] = await Promise.all([
            ...baseCalls,
            backendPost<BackendPage<BackendSearchHistoryRow>>("/internalapi/history/searches", defaultHistoryRequest("time")),
          ]);
          if (!cancelled) {
            setStats(statsResponse);
            setStatuses(statusResponse);
            setUserInfos(userResponse);
            setSearches(searchesResponse);
          }
        } else if (selectedTab === "downloads") {
          const [statsResponse, statusResponse, userResponse, downloadsResponse] = await Promise.all([
            ...baseCalls,
            backendPost<BackendPage<BackendDownloadHistoryRow>>("/internalapi/history/downloads", defaultHistoryRequest("time")),
          ]);
          if (!cancelled) {
            setStats(statsResponse);
            setStatuses(statusResponse);
            setUserInfos(userResponse);
            setDownloads(downloadsResponse);
          }
        } else if (selectedTab === "notifications") {
          const [statsResponse, statusResponse, userResponse, notificationsResponse] = await Promise.all([
            ...baseCalls,
            backendPost<BackendPage<BackendNotificationHistoryRow>>("/internalapi/history/notifications", defaultHistoryRequest("time")),
          ]);
          if (!cancelled) {
            setStats(statsResponse);
            setStatuses(statusResponse);
            setUserInfos(userResponse);
            setNotifications(notificationsResponse);
          }
        } else if (selectedTab === "saved-searches") {
          const [statsResponse, statusResponse, userResponse, savedResponse] = await Promise.all([
            ...baseCalls,
            backendGet<BackendSavedSearch[]>("/internalapi/savedsearches"),
          ]);
          if (!cancelled) {
            setStats(statsResponse);
            setStatuses(statusResponse);
            setUserInfos(userResponse);
            setSavedSearches(savedResponse);
          }
        } else {
          const [statsResponse, statusResponse, userResponse] = await Promise.all(baseCalls);
          if (!cancelled) {
            setStats(statsResponse);
            setStatuses(statusResponse);
            setUserInfos(userResponse);
          }
        }
      } catch (e) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : "Failed to load stats";
          setError(message || "Failed to load stats");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [selectedTab]);

  const enabledIndexers = stats?.numberOfEnabledIndexers ?? statuses.filter((x) => x.state === "ENABLED").length;
  const configuredIndexers = stats?.numberOfConfiguredIndexers ?? statuses.length;
  const avgResponseTime =
    stats?.avgResponseTimes && stats.avgResponseTimes.length > 0
      ? Math.round(stats.avgResponseTimes.reduce((sum, x) => sum + x.avgResponseTime, 0) / stats.avgResponseTimes.length)
      : 0;

  const showSearches = selectedTab === "searches";
  const showDownloads = selectedTab === "downloads";
  const showNotifications = selectedTab === "notifications";
  const showSavedSearches = selectedTab === "saved-searches";
  const showDeepStats = selectedTab === "stats";

  async function deleteSavedSearch(index: number) {
    try {
      setError(null);
      await backendDelete<unknown>(`/internalapi/savedsearches/${index}`);
      const savedResponse = await backendGet<BackendSavedSearch[]>("/internalapi/savedsearches");
      setSavedSearches(savedResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete saved search");
    }
  }

  async function loadSearchDetails(searchId: number) {
    try {
      setSearchDetailsLoading(true);
      setSearchDetailsRequestId(searchId);
      setSearchDetailsError(null);
      setSearchDetails(null);
      const detail = await backendGet<SearchDetails>(`/internalapi/history/searches/details/${searchId}`);
      setSearchDetails(detail);
    } catch (e) {
      setSearchDetailsError(e instanceof Error ? e.message : "Failed to load search details");
    } finally {
      setSearchDetailsLoading(false);
    }
  }

  return (
    <AppShell
      active="stats"
      title="Analytics"
      subtitle="Indexer health and history."
      tabs={tabs}
    >
      {error ? (
        <section className="card" aria-label="Stats loading error">
          <p className="error-text">{error}</p>
          <p className="muted">Sign in to the backend, then refresh.</p>
        </section>
      ) : null}

      <section className="card" aria-label="Analytics snapshot">
        <div className="metric-grid">
          <article className="metric">
            <p className="metric-label">Enabled indexers</p>
            <p className="metric-value">{enabledIndexers}</p>
            <p className="muted">Configured: {configuredIndexers}</p>
          </article>
          <article className="metric">
            <p className="metric-label">Avg response time</p>
            <p className="metric-value">{avgResponseTime} ms</p>
            <p className="muted">From response stats.</p>
          </article>
          <article className="metric">
            <p className="metric-label">Session access</p>
            <p className="metric-value ok">{userInfos?.username ? "Authenticated" : "Anonymous"}</p>
            <p className="muted">User: {userInfos?.username ?? "none"}</p>
          </article>
        </div>

        <div className="table-wrap">
          <h3>{showSearches ? "Search history" : showDownloads ? "Download history" : showNotifications ? "Notification history" : showSavedSearches ? "Saved searches" : "Indexer statuses"}</h3>
          {loading ? <p className="muted">Loading...</p> : null}
          {!loading && !showSearches && !showDownloads && !showNotifications && !showSavedSearches && statuses.length === 0 ? (
            <p className="muted">No indexers configured yet.</p>
          ) : null}

          {!loading && !showSearches && !showDownloads && !showNotifications && !showSavedSearches && statuses.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Indexer</th>
                  <th>State</th>
                  <th>API hits</th>
                  <th>Download hits</th>
                </tr>
              </thead>
              <tbody>
                {statuses.slice(0, 8).map((status) => (
                  <tr key={status.indexer}>
                    <td>{status.indexer}</td>
                    <td>{status.state}</td>
                    <td>
                      {status.apiHits ?? 0}
                      {status.apiHitLimit ? ` / ${status.apiHitLimit}` : ""}
                    </td>
                    <td>
                      {status.downloadHits ?? 0}
                      {status.downloadHitLimit ? ` / ${status.downloadHitLimit}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {!loading && showSearches ? (
            searches && searches.content.length > 0 ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Query</th>
                    <th>Type</th>
                    <th>User</th>
                    <th>Source</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {searches.content.map((item) => (
                    <tr key={item.id}>
                      <td>{item.time ?? ""}</td>
                      <td>{item.query || item.title || "-"}</td>
                      <td>{item.searchType ?? "-"}</td>
                      <td>{item.username ?? "anonymous"}</td>
                      <td>{item.source ?? "-"}</td>
                      <td>
                        <button
                          type="button"
                          className="action-btn action-btn-small"
                          onClick={() => void loadSearchDetails(item.id)}
                          disabled={searchDetailsLoading && searchDetailsRequestId === item.id}
                        >
                          {searchDetailsLoading && searchDetailsRequestId === item.id ? "Loading..." : "Details"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No search history entries found.</p>
            )
          ) : null}

          {!loading && showSearches && searchDetailsLoading && searchDetailsRequestId !== null ? (
            <article className="metric" aria-label="Search details loading">
              <p className="metric-label">Search details</p>
              <p className="muted">Loading details for search #{searchDetailsRequestId}...</p>
            </article>
          ) : null}

          {!loading && showSearches && searchDetailsError ? <p className="error-text">{searchDetailsError}</p> : null}

          {!loading && showDownloads ? (
            downloads && downloads.content.length > 0 ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Status</th>
                    <th>Access type</th>
                    <th>Age</th>
                    <th>User</th>
                  </tr>
                </thead>
                <tbody>
                  {downloads.content.map((item) => (
                    <tr key={item.id}>
                      <td>{item.time ?? ""}</td>
                      <td>{item.status ?? "-"}</td>
                      <td>{item.nzbAccessType ?? "-"}</td>
                      <td>{item.age ?? "-"}</td>
                      <td>{item.username ?? "anonymous"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No download history entries found.</p>
            )
          ) : null}

          {!loading && showNotifications ? (
            notifications && notifications.content.length > 0 ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Type</th>
                    <th>Title</th>
                    <th>Displayed</th>
                  </tr>
                </thead>
                <tbody>
                  {notifications.content.map((item) => (
                    <tr key={item.id}>
                      <td>{item.time ?? ""}</td>
                      <td>{item.notificationEventType ?? "-"}</td>
                      <td>{item.messageType ?? "-"}</td>
                      <td>{item.title ?? "-"}</td>
                      <td>{item.displayed ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No notifications.</p>
            )
          ) : null}

          {!loading && showSavedSearches ? (
            savedSearches.length > 0 ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Query</th>
                    <th>Title</th>
                    <th>Category</th>
                    <th>Season/Episode</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {savedSearches.map((item, index) => (
                    <tr key={`${item.query ?? "saved"}-${index}`}>
                      <td>{item.searchType ?? "SEARCH"}</td>
                      <td>{item.query ?? "-"}</td>
                      <td>{item.title ?? "-"}</td>
                      <td>{item.categoryName ?? "-"}</td>
                      <td>
                        {item.season ?? "-"}/{item.episode ?? "-"}
                      </td>
                      <td>
                        <button type="button" className="action-btn action-btn-small action-btn-secondary" onClick={() => void deleteSavedSearch(index)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No saved searches configured.</p>
            )
          ) : null}

          {!loading && showDeepStats ? (
            <div className="metric-grid">
              {(stats?.avgResponseTimes ?? []).slice(0, 6).map((entry) => (
                <article className="metric" key={entry.indexer}>
                  <p className="metric-label">{entry.indexer}</p>
                  <p className="metric-value">{Math.round(entry.avgResponseTime)} ms</p>
                  <p className="muted">Change: {Math.round(entry.delta)}</p>
                </article>
              ))}
              {(stats?.avgResponseTimes ?? []).length === 0 ? <p className="muted">No deep stats yet.</p> : null}
            </div>
          ) : null}

          {searchDetails ? (
            <article className="metric" aria-label="Search details">
              <p className="metric-label">Search details</p>
              <p className="muted">User: {searchDetails.username ?? "anonymous"}</p>
              <p className="muted">IP: {searchDetails.ip ?? "n/a"}</p>
              <p className="muted">Source: {searchDetails.source ?? "n/a"}</p>
              <p className="muted">User agent: {searchDetails.userAgent ?? "n/a"}</p>
              {(searchDetails.details ?? []).length > 0 ? (
                (searchDetails.details ?? []).map((entry, index) => (
                  <p className="muted" key={`${entry.indexer ?? "indexer"}-${index}`}>
                    {entry.indexer ?? "unknown"}: {entry.successful ? "ok" : "failed"} ({entry.resultsCount ?? 0} results)
                  </p>
                ))
              ) : (
                <p className="muted">No per-indexer details.</p>
              )}
            </article>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}