"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  BackendBackupEntry,
  BackendNewsEntry,
  BackendSimpleUpdateInfo,
  BackendTaskInfo,
  BackendUserNewsEntry,
  BackendVersionsInfo,
  backendGet,
  backendPut,
} from "@/lib/backend";

const tabDefs = [
  { key: "control", href: "/system/control", label: "Control" },
  { key: "updates", href: "/system/updates", label: "Updates" },
  { key: "log", href: "/system/log", label: "Log" },
  { key: "tasks", href: "/system/tasks", label: "Tasks" },
  { key: "backup", href: "/system/backup", label: "Backup" },
  { key: "bugreport", href: "/system/bugreport", label: "Bugreport" },
  { key: "news", href: "/system/news", label: "News" },
  { key: "about", href: "/system/about", label: "About" },
];

type SessionProbe = "unknown" | "authenticated" | "unauthenticated";

export default function SystemPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tasks, setTasks] = useState<BackendTaskInfo[]>([]);
  const [updates, setUpdates] = useState<BackendSimpleUpdateInfo | null>(null);
  const [detailedUpdates, setDetailedUpdates] = useState<BackendVersionsInfo | null>(null);
  const [updateMessages, setUpdateMessages] = useState<string[]>([]);
  const [backups, setBackups] = useState<BackendBackupEntry[]>([]);
  const [news, setNews] = useState<BackendNewsEntry[]>([]);
  const [userNews, setUserNews] = useState<BackendUserNewsEntry[]>([]);
  const [logText, setLogText] = useState("");
  const [logFiles, setLogFiles] = useState<string[]>([]);
  const [uploadedDebugUrl, setUploadedDebugUrl] = useState<string | null>(null);
  const [endpointCount, setEndpointCount] = useState<number | null>(null);
  const [bugreportWarning, setBugreportWarning] = useState<string | null>(null);
  const [sessionProbe, setSessionProbe] = useState<SessionProbe>("unknown");

  const pathname = usePathname();
  const selectedTab = pathname.split("/")[2] || "control";
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
        setMessage(null);
        setBugreportWarning(null);

        const askPasswordResponse = await fetch("/internalapi/askpassword", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        const updatesResponse = await backendGet<BackendSimpleUpdateInfo>("/internalapi/updates/simpleInfos");

        if (selectedTab === "updates") {
          const [infoResponse, messagesResponse] = await Promise.all([
            backendGet<BackendVersionsInfo>("/internalapi/updates/infos"),
            backendGet<string[]>("/internalapi/updates/messages"),
          ]);
          if (!cancelled) {
            setDetailedUpdates(infoResponse);
            setUpdateMessages(messagesResponse);
          }
        } else if (selectedTab === "tasks") {
          const tasksResponse = await backendGet<BackendTaskInfo[]>("/internalapi/tasks");
          if (!cancelled) {
            setTasks(tasksResponse);
          }
        } else if (selectedTab === "backup") {
          const backupResponse = await backendGet<BackendBackupEntry[]>("/internalapi/backup/list");
          if (!cancelled) {
            setBackups(backupResponse);
          }
        } else if (selectedTab === "news" || selectedTab === "about") {
          const [newsResponse, userNewsResponse] = await Promise.all([
            backendGet<BackendNewsEntry[]>("/internalapi/news/forcurrentversion"),
            backendGet<BackendUserNewsEntry[]>("/internalapi/usernews"),
          ]);
          if (!cancelled) {
            setNews(newsResponse);
            setUserNews(userNewsResponse);
          }
        } else if (selectedTab === "log") {
          const [fileNamesResponse, logResponse] = await Promise.all([
            backendGet<string[]>("/internalapi/debuginfos/logfilenames"),
            fetch("/internalapi/debuginfos/currentlogfile", {
              method: "GET",
              credentials: "include",
              cache: "no-store",
            }),
          ]);
          const logBody = await logResponse.text();
          if (!cancelled) {
            setLogFiles(fileNamesResponse);
            setLogText(logBody.slice(-12000));
          }
        } else if (selectedTab === "bugreport") {
          try {
            const endpointsResponse = await backendGet<Array<{ endpoints?: unknown[] }>>("/internalapi/debuginfos/endpoints");
            if (!cancelled) {
              const count = endpointsResponse.reduce((sum, group) => sum + (Array.isArray(group.endpoints) ? group.endpoints.length : 0), 0);
              setEndpointCount(count);
            }
          } catch {
            if (!cancelled) {
              setEndpointCount(null);
              setBugreportWarning("Endpoint mapping is unavailable right now.");
            }
          }
        }

        if (!cancelled) {
          setUpdates(updatesResponse);
          setSessionProbe(askPasswordResponse.status === 200 ? "authenticated" : "unauthenticated");
        }
      } catch (e) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : "Failed to load system data";
          setError(message || "Failed to load system data");
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

  async function runTask(taskName: string) {
    try {
      setError(null);
      setMessage(null);
      const encodedName = encodeURIComponent(taskName);
      const response = await backendPut<BackendTaskInfo[]>(`/internalapi/tasks/${encodedName}`);
      setTasks(response);
      setMessage(`Task '${taskName}' started.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run task");
    }
  }

  async function doControlAction(action: "ping" | "restart" | "shutdown") {
    try {
      setError(null);
      setMessage(null);
      if (action !== "ping") {
        const confirmed = window.confirm(`Are you sure you want to ${action} the backend?`);
        if (!confirmed) {
          return;
        }
      }
      await backendGet<unknown>(`/internalapi/control/${action}`);
      setMessage(action === "ping" ? "Backend ping succeeded." : `Backend ${action} requested.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to run ${action}`);
    }
  }

  async function refreshUpdateCache() {
    try {
      setError(null);
      await backendGet<unknown>("/internalapi/updates/resetCache");
      const [infoResponse, messagesResponse] = await Promise.all([
        backendGet<BackendVersionsInfo>("/internalapi/updates/infos"),
        backendGet<string[]>("/internalapi/updates/messages"),
      ]);
      setDetailedUpdates(infoResponse);
      setUpdateMessages(messagesResponse);
      setMessage("Update cache refreshed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh updates");
    }
  }

  async function createBackupOnly() {
    try {
      setError(null);
      await backendGet<unknown>("/internalapi/backup/backuponly");
      const backupResponse = await backendGet<BackendBackupEntry[]>("/internalapi/backup/list");
      setBackups(backupResponse);
      setMessage("Backup created.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create backup");
    }
  }

  async function restoreBackup(filename: string) {
    try {
      const confirmed = window.confirm(`Restore backup ${filename}? This may restart backend state.`);
      if (!confirmed) {
        return;
      }
      setError(null);
      await backendGet<unknown>(`/internalapi/backup/restore?filename=${encodeURIComponent(filename)}`);
      setMessage(`Restore requested for ${filename}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to restore backup");
    }
  }

  async function dismissUserNews(id: string) {
    try {
      setError(null);
      await backendPut<unknown>(`/internalapi/usernews/${encodeURIComponent(id)}/dismiss`);
      const userNewsResponse = await backendGet<BackendUserNewsEntry[]>("/internalapi/usernews");
      setUserNews(userNewsResponse);
      setMessage("User news dismissed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to dismiss news");
    }
  }

  async function uploadDebugBundle() {
    try {
      setError(null);
      const response = await fetch("/internalapi/debuginfos/createAndUploadDebugInfos", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to upload debug infos");
      }
      const url = await response.text();
      setUploadedDebugUrl(url);
      setMessage("Debug bundle uploaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload debug bundle");
    }
  }

  function openDownloadUrl(path: string) {
    window.location.assign(path);
  }

  function openExternal(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <AppShell active="system" title="System" subtitle="Updates, tasks, backups, diagnostics." tabs={tabs}>
      {error ? (
        <section className="card" aria-label="System loading error">
          <p className="error-text">{error}</p>
          <p className="muted">Administrator access required.</p>
        </section>
      ) : null}

      {message ? (
        <section className="card" aria-label="System status message">
          <p className="ok-text">{message}</p>
        </section>
      ) : null}

      <section className="card" aria-label="System overview">
        <div className="metric-grid">
          <article className="metric">
            <p className="metric-label">Current version</p>
            <p className="metric-value">{updates?.currentVersion ?? "unknown"}</p>
            <p className="muted">Package: {updates?.packageInfo?.releaseType ?? "unknown"}</p>
          </article>
          <article className="metric">
            <p className="metric-label">Scheduled tasks</p>
            <p className="metric-value">{tasks.length}</p>
            <p className="muted">From scheduler.</p>
          </article>
          <article className="metric">
            <p className="metric-label">Session probe</p>
            <p className="metric-value ok">
              {sessionProbe === "authenticated" ? "Authenticated" : sessionProbe === "unauthenticated" ? "Unauthorized" : "Unknown"}
            </p>
            <p className="muted">Session check result.</p>
          </article>
        </div>

        <div className="table-wrap">
          {selectedTab === "control" ? (
            <>
              <h3>Control actions</h3>
              <div className="actions-row">
                <button type="button" className="action-btn" onClick={() => void doControlAction("ping")}>
                  Ping backend
                </button>
                <button type="button" className="action-btn action-btn-secondary" onClick={() => void doControlAction("restart")}>
                  Restart backend
                </button>
                <button type="button" className="action-btn action-btn-danger" onClick={() => void doControlAction("shutdown")}>
                  Shutdown backend
                </button>
              </div>
            </>
          ) : null}

          {selectedTab === "updates" ? (
            <>
              <h3>Update status</h3>
              <p className="muted">Current: {detailedUpdates?.currentVersion ?? updates?.currentVersion ?? "n/a"}</p>
              <p className="muted">Latest: {detailedUpdates?.latestVersion ?? "n/a"}</p>
              <p className="muted">Update available: {detailedUpdates?.updateAvailable ? "yes" : "no"}</p>
              <div className="actions-row">
                <button type="button" className="action-btn" onClick={() => void refreshUpdateCache()}>
                  Refresh update data
                </button>
              </div>
              <h3>Update messages</h3>
              {updateMessages.length === 0 ? <p className="muted">No update messages.</p> : null}
              {updateMessages.map((entry, index) => (
                <p className="muted" key={`${entry}-${index}`}>
                  {entry}
                </p>
              ))}
            </>
          ) : null}

          {selectedTab === "tasks" ? (
            <>
              <h3>Task schedule</h3>
              {loading ? <p className="muted">Loading scheduler tasks...</p> : null}
              {!loading && tasks.length === 0 ? <p className="muted">No scheduled tasks.</p> : null}
              {!loading && tasks.length > 0 ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Last execution</th>
                      <th>Next execution</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.slice(0, 20).map((task) => (
                      <tr key={task.name}>
                        <td>{task.name}</td>
                        <td>{task.lastExecutionTime ?? "n/a"}</td>
                        <td>{task.nextExecutionTime ?? "n/a"}</td>
                        <td>
                          <button type="button" className="action-btn action-btn-small" onClick={() => void runTask(task.name)}>
                            Run now
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </>
          ) : null}

          {selectedTab === "backup" ? (
            <>
              <h3>Backups</h3>
              <div className="actions-row">
                <button type="button" className="action-btn" onClick={() => void createBackupOnly()}>
                  Create backup
                </button>
              </div>
              {backups.length === 0 ? <p className="muted">No backups found.</p> : null}
              {backups.length > 0 ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Filename</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backups.map((entry) => (
                      <tr key={entry.filename}>
                        <td>{entry.filename}</td>
                        <td>{entry.creationDate}</td>
                        <td>
                          <div className="actions-row actions-row-inline">
                            <button
                              type="button"
                              className="action-btn action-btn-small"
                              onClick={() => openDownloadUrl(`/internalapi/backup/download?filename=${encodeURIComponent(entry.filename)}`)}
                            >
                              Download
                            </button>
                            <button type="button" className="action-btn action-btn-small action-btn-secondary" onClick={() => void restoreBackup(entry.filename)}>
                              Restore
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </>
          ) : null}

          {selectedTab === "news" || selectedTab === "about" ? (
            <>
              <h3>News</h3>
              {news.length === 0 ? <p className="muted">No version news available.</p> : null}
              {news.map((entry, index) => (
                <article className="metric" key={`${entry.version}-${index}`}>
                  <p className="metric-label">Version {entry.version}</p>
                  <div className="rich-html" dangerouslySetInnerHTML={{ __html: entry.news }} />
                </article>
              ))}
              <h3>User news</h3>
              {userNews.length === 0 ? <p className="muted">No unread user news.</p> : null}
              {userNews.map((entry) => (
                <article className="metric" key={entry.id}>
                  <p className="metric-label">{entry.title}</p>
                  <div className="rich-html" dangerouslySetInnerHTML={{ __html: entry.newsAsHtml }} />
                  <div className="actions-row">
                    <button type="button" className="action-btn action-btn-small" onClick={() => void dismissUserNews(entry.id)}>
                      Dismiss
                    </button>
                  </div>
                </article>
              ))}
              {selectedTab === "about" ? (
                <article className="metric">
                  <p className="metric-label">Build package</p>
                  <p className="muted">Type: {updates?.packageInfo?.releaseType ?? "unknown"}</p>
                  <p className="muted">Version: {updates?.packageInfo?.version ?? updates?.currentVersion ?? "unknown"}</p>
                  <p className="muted">Author: {updates?.packageInfo?.author ?? "unknown"}</p>
                </article>
              ) : null}
            </>
          ) : null}

          {selectedTab === "log" ? (
            <>
              <h3>Current log tail</h3>
              <p className="muted">Latest backend log entries.</p>
              <pre className="log-view">{logText || "No log content received."}</pre>
              <h3>Available log files</h3>
              {logFiles.length === 0 ? <p className="muted">No log files available.</p> : null}
              <div className="actions-row">
                {logFiles.map((fileName) => (
                  <a
                    key={fileName}
                    className="action-btn action-btn-small action-link"
                    href={`/internalapi/debuginfos/downloadlog?logfilename=${encodeURIComponent(fileName)}`}
                  >
                    {fileName}
                  </a>
                ))}
              </div>
            </>
          ) : null}

          {selectedTab === "bugreport" ? (
            <>
              <h3>Bug report bundle</h3>
              <p className="muted">Collect or upload diagnostics.</p>
              <div className="actions-row">
                <button
                  type="button"
                  className="action-btn"
                  onClick={() => openDownloadUrl("/internalapi/debuginfos/createAndProvideZipAsBytes")}
                >
                  Download debug bundle
                </button>
                <button type="button" className="action-btn action-btn-secondary" onClick={() => void uploadDebugBundle()}>
                  Upload debug bundle
                </button>
              </div>
              <p className="muted">Mapped endpoints discovered: {endpointCount ?? "unavailable"}</p>
              {bugreportWarning ? <p className="muted">{bugreportWarning}</p> : null}
              {uploadedDebugUrl ? (
                <p className="muted">
                  Uploaded to:
                  <button type="button" className="inline-link-btn" onClick={() => openExternal(uploadedDebugUrl)}>
                    {uploadedDebugUrl}
                  </button>
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}