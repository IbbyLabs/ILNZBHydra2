"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";
import { AppShell } from "@/components/app-shell";
import { BackendSearchState, backendGet, backendPost, nextSearchRequestId } from "@/lib/backend";

type SearchResult = {
  title?: string;
  indexer?: string;
  size?: number;
  age?: string;
  category?: string;
  details_link?: string;
  link?: string;
};

type SearchResponse = {
  searchResults: SearchResult[];
  numberOfProcessedResults: number;
  numberOfAcceptedResults: number;
  numberOfRejectedResults: number;
};

type SafeConfigResponse = {
  indexers?: Array<{
    name?: string;
    state?: string;
    showOnSearch?: boolean;
  }>;
};

type IndexerOption = {
  name: string;
  state: string;
  enabled: boolean;
};

type BenchmarkRow = {
  indexer: string;
  avgMs: number;
  bestMs: number;
  worstMs: number;
  accepted: number;
  processed: number;
  failures: number;
  score: number;
};

const BENCHMARK_QUERIES = ["dune", "the last of us", "oppenheimer"];

const tabs = [
  { href: "/search", label: "Search", active: true },
  { href: "/stats/searches", label: "Search history", active: false },
  { href: "/stats/saved-searches", label: "Saved searches", active: false },
  { href: "/config/indexers", label: "Indexer config", active: false },
  { href: "/system/tasks", label: "System tasks", active: false },
];

function parseIndexerOptions(config: SafeConfigResponse): IndexerOption[] {
  const raw = Array.isArray(config.indexers) ? config.indexers : [];
  return raw
    .map((entry) => {
      const name = String(entry?.name ?? "").trim();
      const state = String(entry?.state ?? "ENABLED").trim();
      const showOnSearch = entry?.showOnSearch !== false;
      if (!name || !showOnSearch) {
        return null;
      }
      return {
        name,
        state,
        enabled: state === "ENABLED",
      } satisfies IndexerOption;
    })
    .filter((entry): entry is IndexerOption => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function formatSize(size?: number): string {
  if (!size || size <= 0) {
    return "-";
  }
  const gb = size / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(2)} GB`;
  }
  const mb = size / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [useAllIndexers, setUseAllIndexers] = useState(true);
  const [selectedIndexers, setSelectedIndexers] = useState<string[]>([]);
  const [availableIndexers, setAvailableIndexers] = useState<IndexerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [searchState, setSearchState] = useState<BackendSearchState | null>(null);
  const [currentSearchRequestId, setCurrentSearchRequestId] = useState<number | null>(null);

  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkRows, setBenchmarkRows] = useState<BenchmarkRow[]>([]);
  const [benchmarkStatus, setBenchmarkStatus] = useState<string | null>(null);

  const stompRef = useRef<Client | null>(null);
  const initializedFromParams = useRef(false);

  const availableIndexerNames = useMemo(
    () => availableIndexers.filter((entry) => entry.enabled).map((entry) => entry.name),
    [availableIndexers],
  );

  const activeIndexerCount = useAllIndexers ? availableIndexerNames.length : selectedIndexers.length;

  useEffect(() => {
    void backendGet<SafeConfigResponse>("/internalapi/config/safe")
      .then((config) => setAvailableIndexers(parseIndexerOptions(config)))
      .catch(() => setAvailableIndexers([]));
  }, []);

  useEffect(() => {
    const backendBase = (process.env.NEXT_PUBLIC_BACKEND_URL ?? `${window.location.protocol}//${window.location.hostname}:5076`).replace(/\/$/, "");
    const client = new Client({
      webSocketFactory: () => new SockJS(`${backendBase}/websocket`),
      reconnectDelay: 2000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
    });

    client.onConnect = () => {
      client.subscribe("/topic/searchState", (message) => {
        try {
          const state = JSON.parse(message.body) as BackendSearchState;
          if (currentSearchRequestId !== null && state.searchRequestId === currentSearchRequestId) {
            setSearchState(state);
          }
        } catch {}
      });
    };

    client.activate();
    stompRef.current = client;

    return () => {
      if (stompRef.current) {
        void stompRef.current.deactivate();
      }
    };
  }, [currentSearchRequestId]);

  const runSearch = useCallback(
    async (
      event?: FormEvent<HTMLFormElement>,
      overrides?: {
        query?: string;
        indexers?: string[];
        useAllIndexers?: boolean;
      },
    ) => {
      if (event) {
        event.preventDefault();
      }

      const effectiveQuery = (overrides?.query ?? query).trim();
      const effectiveUseAll = overrides?.useAllIndexers ?? useAllIndexers;
      const effectiveIndexers = overrides?.indexers ?? selectedIndexers;

      if (!effectiveQuery) {
        setError("Enter a query.");
        return;
      }

      if (!effectiveUseAll && effectiveIndexers.length === 0) {
        setError("Select at least one indexer or enable all indexers.");
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const requestId = nextSearchRequestId();
        setCurrentSearchRequestId(requestId);
        setSearchState({
          searchRequestId: requestId,
          indexerSelectionFinished: false,
          searchFinished: false,
          indexersSelected: 0,
          indexersFinished: 0,
          messages: [],
        });

        const payload = {
          query: effectiveQuery,
          category: "all",
          mode: "search",
          offset: 0,
          limit: 100,
          loadAll: false,
          indexers: effectiveUseAll ? null : effectiveIndexers,
          searchRequestId: requestId,
        };

        const result = await backendPost<SearchResponse>("/internalapi/search", payload);
        setResponse(result);
        setSearchState((prev) => {
          if (!prev || prev.searchRequestId !== requestId) {
            return prev;
          }
          return {
            ...prev,
            searchFinished: true,
          };
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        setLoading(false);
      }
    },
    [query, selectedIndexers, useAllIndexers],
  );

  useEffect(() => {
    if (initializedFromParams.current || typeof window === "undefined") {
      return;
    }
    initializedFromParams.current = true;

    const params = new URLSearchParams(window.location.search);
    const queryParam = params.get("query") ?? "";
    const indexersParam = params.get("indexers") ?? "";

    if (!queryParam && !indexersParam) {
      return;
    }

    const preselectedIndexers = indexersParam
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const timeout = window.setTimeout(() => {
      void runSearch(undefined, {
        query: queryParam,
        indexers: preselectedIndexers,
        useAllIndexers: preselectedIndexers.length === 0,
      });
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [runSearch]);

  async function runIndexerBenchmark() {
    const candidateIndexers = (useAllIndexers ? availableIndexerNames : selectedIndexers).slice(0, 12);

    if (candidateIndexers.length === 0) {
      setError("No indexers available for benchmark.");
      return;
    }

    setBenchmarkRunning(true);
    setBenchmarkRows([]);
    setBenchmarkStatus(`Running benchmark for ${candidateIndexers.length} indexer(s)...`);
    setError(null);

    try {
      for (const indexer of candidateIndexers) {
        const durations: number[] = [];
        let accepted = 0;
        let processed = 0;
        let failures = 0;

        for (const benchmarkQuery of BENCHMARK_QUERIES) {
          const requestId = nextSearchRequestId();
          const startedAt = performance.now();

          try {
            const result = await backendPost<SearchResponse>("/internalapi/search", {
              query: benchmarkQuery,
              category: "all",
              mode: "search",
              offset: 0,
              limit: 25,
              loadAll: false,
              indexers: [indexer],
              searchRequestId: requestId,
            });

            const elapsed = Math.max(1, Math.round(performance.now() - startedAt));
            durations.push(elapsed);
            accepted += result.numberOfAcceptedResults;
            processed += result.numberOfProcessedResults;
          } catch {
            failures += 1;
          }
        }

        const avgMs = durations.length > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 999999;
        const bestMs = durations.length > 0 ? Math.min(...durations) : 999999;
        const worstMs = durations.length > 0 ? Math.max(...durations) : 999999;
        const score = avgMs > 0 ? Math.round((accepted * 1000) / avgMs) : 0;

        const row: BenchmarkRow = {
          indexer,
          avgMs,
          bestMs,
          worstMs,
          accepted,
          processed,
          failures,
          score,
        };

        setBenchmarkRows((prev) => [...prev, row].sort((a, b) => b.score - a.score || a.avgMs - b.avgMs));
      }

      setBenchmarkStatus("Benchmark completed.");
    } finally {
      setBenchmarkRunning(false);
    }
  }

  function toggleIndexer(name: string) {
    setSelectedIndexers((prev) => (prev.includes(name) ? prev.filter((value) => value !== name) : [...prev, name]));
  }

  const indexersSelected = searchState?.indexersSelected ?? 0;
  const indexersFinished = searchState?.indexersFinished ?? 0;
  const progressPercent = indexersSelected > 0 ? Math.min(100, Math.round((indexersFinished / indexersSelected) * 100)) : 0;
  const liveStatusRequest = currentSearchRequestId ?? "idle";
  const liveStatusIndexerSummary = searchState ? `${indexersFinished}/${indexersSelected}` : `${activeIndexerCount} ready`;
  const liveStatusProgress = searchState ? `${progressPercent}%` : "Idle";

  return (
    <AppShell active="search" title="Search" subtitle="Search across your enabled indexers." tabs={tabs}>
      <section className="search-redesign-grid">
        <article className="search-redesign-panel search-redesign-panel-main" aria-label="Search controls">
            <form onSubmit={runSearch} className="search-redesign-form">
              <label htmlFor="search-query-main" className="search-redesign-label">
                Search query
              </label>
              <input
                id="search-query-main"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="search-redesign-query"
                placeholder="Title, keyword, or media ID"
              />

              <div className="search-redesign-form-row">
                <label className="search-redesign-switch" htmlFor="search-use-all-indexers">
                  <input
                    id="search-use-all-indexers"
                    type="checkbox"
                    checked={useAllIndexers}
                    onChange={(event) => setUseAllIndexers(event.target.checked)}
                  />
                  <span>Use all enabled indexers</span>
                </label>
                <p className="search-redesign-meta">Active indexers: {activeIndexerCount}</p>
              </div>

              {!useAllIndexers ? (
                <div className="search-redesign-indexer-box">
                  <div className="search-redesign-indexer-head">
                    <p>Choose indexers</p>
                    <div className="search-redesign-indexer-actions">
                      <button
                        type="button"
                        className="search-redesign-inline-btn"
                        onClick={() => setSelectedIndexers(availableIndexerNames)}
                      >
                        Select all
                      </button>
                      <button type="button" className="search-redesign-inline-btn" onClick={() => setSelectedIndexers([])}>
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="search-redesign-indexer-list">
                    {availableIndexers.map((indexer) => {
                      const checked = selectedIndexers.includes(indexer.name);
                      return (
                        <label key={indexer.name} className={`search-redesign-chip${checked ? " active" : ""}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!indexer.enabled}
                            onChange={() => toggleIndexer(indexer.name)}
                          />
                          <span>{indexer.name}</span>
                          <strong>{indexer.enabled ? "online" : indexer.state.toLowerCase()}</strong>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="search-redesign-actions">
                <button type="submit" className="search-redesign-btn search-redesign-btn-primary" disabled={loading}>
                  {loading ? "Searching..." : "Search"}
                </button>
                <button
                  type="button"
                  className="search-redesign-btn search-redesign-btn-secondary"
                  onClick={() => void runIndexerBenchmark()}
                  disabled={benchmarkRunning}
                >
                  {benchmarkRunning ? "Benchmark running..." : "Benchmark indexers"}
                </button>
              </div>
            </form>

            {error ? <p className="search-redesign-error">{error}</p> : null}
        </article>

        <article className="search-redesign-panel" aria-label="Live status">
          <h2>Live status</h2>
          <div className="search-redesign-stat-grid">
            <div className="search-redesign-stat">
              <p>Request</p>
              <strong>{liveStatusRequest}</strong>
            </div>
            <div className="search-redesign-stat">
              <p>Indexers</p>
              <strong>{liveStatusIndexerSummary}</strong>
            </div>
            <div className="search-redesign-stat">
              <p>Progress</p>
              <strong>{liveStatusProgress}</strong>
            </div>
          </div>
          <div className="search-redesign-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
            <div className="search-redesign-progress-value" style={{ width: `${progressPercent}%` }} />
          </div>

          <h3>Indexer benchmark</h3>
          <p className="search-redesign-muted">Queries tested: {BENCHMARK_QUERIES.join(" / ")}</p>
          {benchmarkStatus ? <p className="search-redesign-muted">{benchmarkStatus}</p> : null}
          {benchmarkRows.length > 0 ? (
            <div className="search-redesign-table-wrap">
              <table className="search-redesign-table">
                <thead>
                  <tr>
                    <th>Indexer</th>
                    <th>Score</th>
                    <th>Avg</th>
                    <th>Best</th>
                    <th>Worst</th>
                    <th>Accepted</th>
                    <th>Fail</th>
                  </tr>
                </thead>
                <tbody>
                  {benchmarkRows.map((row) => (
                    <tr key={row.indexer}>
                      <td>{row.indexer}</td>
                      <td>{row.score}</td>
                      <td>{row.avgMs === 999999 ? "n/a" : `${row.avgMs} ms`}</td>
                      <td>{row.bestMs === 999999 ? "n/a" : `${row.bestMs} ms`}</td>
                      <td>{row.worstMs === 999999 ? "n/a" : `${row.worstMs} ms`}</td>
                      <td>{row.accepted}</td>
                      <td>{row.failures}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="search-redesign-muted">Run the benchmark to rank your indexers.</p>
          )}
        </article>
      </section>

      <section className="search-redesign-panel search-redesign-results" aria-label="Search results">
        <div className="search-redesign-results-head">
          <h2>Results</h2>
          {response ? (
            <p className="search-redesign-muted">
              {response.numberOfAcceptedResults} accepted, {response.numberOfProcessedResults} processed, {response.numberOfRejectedResults} rejected
            </p>
          ) : null}
        </div>

        {!response ? <p className="search-redesign-muted">Run a search to load results.</p> : null}
        {response && response.searchResults.length === 0 ? <p className="search-redesign-muted">No results found for this query.</p> : null}

        {response && response.searchResults.length > 0 ? (
          <div className="search-redesign-result-list">
            {response.searchResults.slice(0, 100).map((result, index) => (
              <article key={`${result.title ?? "result"}-${index}`} className="search-redesign-result-card">
                <div className="search-redesign-result-main">
                  <h3>{result.title ?? "Untitled release"}</h3>
                  <p>
                    {result.indexer ?? "Unknown indexer"} | {result.category ?? "Unknown category"} | {result.age ?? "Unknown age"} | {formatSize(result.size)}
                  </p>
                </div>
                <div className="search-redesign-result-actions">
                  {result.details_link ? (
                    <a href={result.details_link} target="_blank" rel="noreferrer" className="search-redesign-btn search-redesign-btn-secondary">
                      Details
                    </a>
                  ) : null}
                  {result.link ? (
                    <a href={result.link} target="_blank" rel="noreferrer" className="search-redesign-btn search-redesign-btn-primary">
                      Download
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {searchState?.messages?.length ? (
          <div className="search-redesign-log">
            {searchState.messages.slice(-14).map((entry, index) => (
              <p key={`${entry.messageSortValue}-${index}`}>{entry.message}</p>
            ))}
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
