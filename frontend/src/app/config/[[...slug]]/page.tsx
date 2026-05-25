"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackendConfigValidationResult, BackendUserInfos, backendGet, backendPut } from "@/lib/backend";

const tabDefs = [
  { key: "main", href: "/config/main", label: "Main" },
  { key: "auth", href: "/config/auth", label: "Authorization" },
  { key: "searching", href: "/config/searching", label: "Searching" },
  { key: "categories", href: "/config/categories", label: "Categories" },
  { key: "downloading", href: "/config/downloading", label: "Downloading" },
  { key: "externalTools", href: "/config/externalTools", label: "External tools" },
  { key: "indexers", href: "/config/indexers", label: "Indexers" },
  { key: "notifications", href: "/config/notifications", label: "Notifications" },
];

type FullConfig = Record<string, unknown>;
type PathSegment = string | number;

type ConfigSchemaField = {
  key: string;
  path: string;
  label: string;
  description?: string;
  kind: "object" | "array" | "string" | "number" | "boolean" | "enum";
  control?: "toggle" | "select" | "number" | "text" | "password" | "list" | "group";
  nullable: boolean;
  restartRequired?: boolean;
  sensitive?: boolean;
  min?: number | null;
  max?: number | null;
  enumValues?: string[];
  children?: ConfigSchemaField[];
  item?: ConfigSchemaField;
};

type ConfigSchemaResponse = {
  sections: ConfigSchemaField[];
  tabSections: Record<string, string[]>;
  quickPathsByTab?: Record<string, string[]>;
};

type ApiHelp = {
  newznabApi?: string;
  torznabApi?: string;
  apiKey?: string;
};

type IndexerType = "NEWZNAB" | "TORZNAB";

type IndexerDraft = {
  name: string;
  host: string;
  apiKey: string;
  searchModuleType: IndexerType;
};

type IndexerListEntry = {
  name: string;
  host: string;
  searchModuleType: string;
  state: string;
};

type IndexerPreset = {
  key: string;
  label: string;
  name: string;
  host: string;
  searchModuleType: IndexerType;
};

const indexerPresets: IndexerPreset[] = [
  { key: "newsgroupninja", label: "Newsgroup Ninja", name: "Newsgroup Ninja", host: "https://api.nzb.ninja", searchModuleType: "NEWZNAB" },
  { key: "althub", label: "Althub", name: "Althub", host: "https://api.althub.co.za", searchModuleType: "NEWZNAB" },
  { key: "nzbgeek", label: "NZBGeek", name: "NZBGeek", host: "https://api.nzbgeek.info", searchModuleType: "NEWZNAB" },
  { key: "usenetcrawler", label: "Usenet Crawler", name: "Usenet Crawler", host: "https://usenetcrawler.com", searchModuleType: "NEWZNAB" },
  { key: "drunkenslug", label: "DrunkenSlug", name: "DrunkenSlug", host: "https://api.drunkenslug.com", searchModuleType: "NEWZNAB" },
  { key: "nzbplanet", label: "NZBPlanet", name: "NZBPlanet", host: "https://api.nzbplanet.net", searchModuleType: "NEWZNAB" },
  { key: "dognzb", label: "DOGnzb", name: "DOGnzb", host: "https://api.dognzb.cr", searchModuleType: "NEWZNAB" },
  { key: "omgwtfnzbs", label: "omgwtfnzbs", name: "omgwtfnzbs", host: "https://api.omgwtfnzbs.me", searchModuleType: "NEWZNAB" },
];

const tabSectionKeys: Record<string, string[]> = {
  main: ["main", "auth", "searching", "categoriesConfig", "categories", "downloading", "externalTools", "indexers", "notificationConfig", "notifications", "emby"],
  auth: ["auth"],
  searching: ["searching"],
  categories: ["categoriesConfig", "categories"],
  downloading: ["downloading"],
  externalTools: ["externalTools"],
  indexers: ["indexers"],
  notifications: ["notificationConfig", "notifications"],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneConfig<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function countEntries(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (isPlainObject(value)) {
    return Object.keys(value).length;
  }
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  return 1;
}

function schemaPathToSegments(path: string): PathSegment[] {
  if (!path) {
    return [];
  }
  return path.split(".").filter((segment) => segment.length > 0);
}

function readAtPath(root: unknown, path: PathSegment[]): unknown {
  let cursor: unknown = root;
  for (const segment of path) {
    if (Array.isArray(cursor) && typeof segment === "number") {
      cursor = cursor[segment];
      continue;
    }
    if (isPlainObject(cursor) && typeof segment === "string") {
      cursor = cursor[segment];
      continue;
    }
    return undefined;
  }
  return cursor;
}

function isSimpleSchema(field: ConfigSchemaField): boolean {
  if (["string", "number", "boolean", "enum"].includes(field.kind)) {
    return true;
  }
  if (field.kind === "array" && field.item && ["string", "number", "boolean", "enum"].includes(field.item.kind)) {
    return true;
  }
  return false;
}

function collectSimpleFields(field: ConfigSchemaField): ConfigSchemaField[] {
  if (isSimpleSchema(field)) {
    return [field];
  }
  return (field.children ?? []).flatMap((child) => collectSimpleFields(child));
}


function updateAtPath(root: FullConfig, path: PathSegment[], nextValue: unknown): FullConfig {
  if (path.length === 0) {
    return (isPlainObject(nextValue) ? nextValue : root) as FullConfig;
  }

  const nextRoot = cloneConfig(root) as Record<string, unknown>;
  let cursor: unknown = nextRoot;

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    if (Array.isArray(cursor) && typeof segment === "number") {
      cursor = cursor[segment];
      continue;
    }
    if (isPlainObject(cursor) && typeof segment === "string") {
      cursor = cursor[segment];
      continue;
    }
    return root;
  }

  const last = path[path.length - 1];
  if (Array.isArray(cursor) && typeof last === "number") {
    cursor[last] = nextValue;
    return nextRoot;
  }
  if (isPlainObject(cursor) && typeof last === "string") {
    cursor[last] = nextValue;
    return nextRoot;
  }
  return root;
}

export default function ConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fullConfig, setFullConfig] = useState<FullConfig | null>(null);
  const [configDraft, setConfigDraft] = useState<FullConfig | null>(null);
  const [schemaSections, setSchemaSections] = useState<ConfigSchemaField[]>([]);
  const [schemaTabSections, setSchemaTabSections] = useState<Record<string, string[]>>(tabSectionKeys);
  const [quickPathsByTab, setQuickPathsByTab] = useState<Record<string, string[]>>({});
  const [apiHelp, setApiHelp] = useState<ApiHelp | null>(null);
  const [userInfos, setUserInfos] = useState<BackendUserInfos | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [selectedIndexerPreset, setSelectedIndexerPreset] = useState<string>("");
  const [indexerDraft, setIndexerDraft] = useState<IndexerDraft>({
    name: "",
    host: "",
    apiKey: "",
    searchModuleType: "NEWZNAB",
  });

  const pathname = usePathname();
  const selectedTab = pathname.split("/")[2] || "main";
  const tabs = useMemo(
    () => tabDefs.map((tab) => ({ href: tab.href, label: tab.label, active: tab.key === selectedTab })),
    [selectedTab],
  );

  const selectedTabLabel = tabDefs.find((tab) => tab.key === selectedTab)?.label ?? "Main";
  const selectedTabSummary: Record<string, string> = {
    main: "Edit every setting with typed controls and save changes directly.",
    auth: "Authorization and login related settings.",
    searching: "Search behavior and indexer selection settings.",
    categories: "Category mapping and grouping settings.",
    downloading: "Downloader settings and transfer behavior.",
    externalTools: "External integrations and helper tools.",
    indexers: "Indexer registry and quick add tools.",
    notifications: "Notification delivery and display settings.",
  };
  const tabSummary = selectedTabSummary[selectedTab] ?? selectedTabSummary.main;

  const schemaByPath = useMemo(() => {
    const map = new Map<string, ConfigSchemaField>();
    const visit = (field: ConfigSchemaField) => {
      map.set(field.path, field);
      (field.children ?? []).forEach(visit);
      if (field.item) {
        visit(field.item);
      }
    };
    schemaSections.forEach(visit);
    return map;
  }, [schemaSections]);

  const quickSchemas = useMemo(() => {
    const sectionKeys = schemaTabSections[selectedTab] ?? tabSectionKeys[selectedTab] ?? [];
    const curated = (quickPathsByTab[selectedTab] ?? [])
      .map((path) => schemaByPath.get(path))
      .filter((schema): schema is ConfigSchemaField => Boolean(schema))
      .filter((schema) => isSimpleSchema(schema));

    const derived = sectionKeys
      .map((key) => schemaByPath.get(key))
      .filter((schema): schema is ConfigSchemaField => Boolean(schema))
      .flatMap((section) => collectSimpleFields(section));

    const unique = new Map<string, ConfigSchemaField>();
    [...curated, ...derived].forEach((schema) => {
      if (!unique.has(schema.path)) {
        unique.set(schema.path, schema);
      }
    });
    return Array.from(unique.values());
  }, [quickPathsByTab, selectedTab, schemaByPath, schemaTabSections]);

  const sourceConfig = configDraft ?? fullConfig;
  const allTopLevelKeys = useMemo(() => {
    if (!sourceConfig) {
      return [] as string[];
    }
    return Object.keys(sourceConfig).sort((left, right) => left.localeCompare(right));
  }, [sourceConfig]);

  const isDirty = useMemo(() => {
    if (!fullConfig || !configDraft) {
      return false;
    }
    return JSON.stringify(fullConfig) !== JSON.stringify(configDraft);
  }, [fullConfig, configDraft]);

  const selectedSectionRows = useMemo(() => {
    const preferred = schemaTabSections[selectedTab] ?? tabSectionKeys[selectedTab] ?? [];
    const rows = preferred.map((key) => ({
      key,
      entries: countEntries(sourceConfig?.[key]),
    }));
    return rows;
  }, [selectedTab, sourceConfig, schemaTabSections]);

  const indexerEntries = useMemo(() => {
    const list = Array.isArray(sourceConfig?.indexers) ? sourceConfig.indexers : [];
    return list.map((entry) => {
      const value = (entry ?? {}) as Record<string, unknown>;
      return {
        name: String(value.name ?? "unnamed"),
        host: String(value.host ?? "n/a"),
        searchModuleType: String(value.searchModuleType ?? "unknown"),
        state: String(value.state ?? "unknown"),
      } satisfies IndexerListEntry;
    });
  }, [sourceConfig]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [fullConfigResponse, apiHelpResponse, userResponse, schemaResponse] = await Promise.all([
          backendGet<FullConfig>("/internalapi/config"),
          backendGet<ApiHelp>("/internalapi/config/apiHelp"),
          backendGet<BackendUserInfos>("/internalapi/userinfos"),
          backendGet<ConfigSchemaResponse>("/internalapi/config/schema"),
        ]);

        if (cancelled) {
          return;
        }

        if (!isPlainObject(fullConfigResponse)) {
          throw new Error("Full config response was not JSON. Refresh after logging in to the backend.");
        }
        if (!isPlainObject(apiHelpResponse)) {
          throw new Error("API help response was not JSON. Refresh after logging in to the backend.");
        }
        if (!isPlainObject(userResponse)) {
          throw new Error("User info response was not JSON. Refresh after logging in to the backend.");
        }
        if (!isPlainObject(schemaResponse)) {
          throw new Error("Config schema response was not JSON. Refresh after logging in to the backend.");
        }

        setFullConfig(fullConfigResponse);
        setConfigDraft(cloneConfig(fullConfigResponse));
        setApiHelp(apiHelpResponse);
        setUserInfos(userResponse);
        setSchemaSections(Array.isArray(schemaResponse.sections) ? schemaResponse.sections : []);
        if (schemaResponse.tabSections && typeof schemaResponse.tabSections === "object") {
          setSchemaTabSections(schemaResponse.tabSections);
        }
        if (schemaResponse.quickPathsByTab && typeof schemaResponse.quickPathsByTab === "object") {
          setQuickPathsByTab(schemaResponse.quickPathsByTab);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load config");
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
  }, []);

  function updateDraft(path: PathSegment[], nextValue: unknown) {
    setConfigDraft((prev) => {
      if (!prev) {
        return prev;
      }
      return updateAtPath(prev, path, nextValue);
    });
  }

  async function refreshConfigFromBackend(statusMessage?: string) {
    const fullConfigResponse = await backendGet<FullConfig>("/internalapi/config");

    if (!isPlainObject(fullConfigResponse)) {
      throw new Error("Full config response was not JSON. Refresh after logging in to the backend.");
    }

    setFullConfig(fullConfigResponse);
    setConfigDraft(cloneConfig(fullConfigResponse));
    if (statusMessage) {
      setMessage(statusMessage);
    }
  }

  async function saveDraftConfig() {
    if (!configDraft) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setMessage(null);

      const result = await backendPut<BackendConfigValidationResult>("/internalapi/config", configDraft);
      if (!result.ok) {
        setError(result.errorMessages.join("\n") || "Config validation failed.");
        return;
      }

      const success = result.restartNeeded
        ? "Settings saved. Backend restart is required."
        : "Settings saved successfully.";

      await refreshConfigFromBackend(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function reloadConfig() {
    try {
      setSaving(true);
      setError(null);
      setMessage(null);
      await backendGet<unknown>("/internalapi/config/reload");
      await refreshConfigFromBackend("Config reloaded from disk.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to reload config");
    } finally {
      setSaving(false);
    }
  }

  async function addIndexerDraft() {
    if (!configDraft) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setMessage(null);

      const existingIndexers = Array.isArray(configDraft.indexers)
        ? (configDraft.indexers as Array<Record<string, unknown>>)
        : [];
      const name = indexerDraft.name.trim();
      const host = indexerDraft.host.trim();

      if (!name || !host) {
        setError("Indexer name and host are required.");
        return;
      }

      const duplicateName = existingIndexers.some((entry) => String(entry.name ?? "").toLowerCase() === name.toLowerCase());
      if (duplicateName) {
        setError(`An indexer named '${name}' already exists.`);
        return;
      }

      const draftIndexer: Record<string, unknown> = {
        name,
        host,
        apiKey: indexerDraft.apiKey.trim() || null,
        searchModuleType: indexerDraft.searchModuleType,
        state: "ENABLED",
        enabledForSearchSource: "BOTH",
        showOnSearch: true,
        preselect: true,
      };

      const nextConfig: FullConfig = {
        ...configDraft,
        indexers: [...existingIndexers, draftIndexer],
      };

      const result = await backendPut<BackendConfigValidationResult>("/internalapi/config", nextConfig);
      if (!result.ok) {
        setError(result.errorMessages.join("\n") || "Config validation failed.");
        return;
      }

      await refreshConfigFromBackend(
        result.restartNeeded ? "Indexer saved. Backend restart is required." : "Indexer saved and active.",
      );
      setIndexerDraft((prev) => ({ ...prev, name: "", host: "", apiKey: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to add indexer");
    } finally {
      setSaving(false);
    }
  }

  function applyIndexerPreset(presetKey: string) {
    setSelectedIndexerPreset(presetKey);
    if (!presetKey) {
      return;
    }

    const preset = indexerPresets.find((entry) => entry.key === presetKey);
    if (!preset) {
      return;
    }

    setIndexerDraft((prev) => ({
      ...prev,
      name: preset.name,
      host: preset.host,
      searchModuleType: preset.searchModuleType,
    }));
    setMessage(`Preset loaded: ${preset.label}. Add your API key and save.`);
  }

  async function copyApiKey() {
    const apiKeyValue = String(apiHelp?.apiKey ?? "");
    if (!apiKeyValue) {
      setError("No API key is available for this user.");
      return;
    }

    try {
      await navigator.clipboard.writeText(apiKeyValue);
      setMessage("API key copied to clipboard.");
      setError(null);
    } catch {
      setError("Clipboard access failed. Copy the API key manually.");
    }
  }

  function renderQuickSetting(schema: ConfigSchemaField) {
    const segments = schemaPathToSegments(schema.path);
    const value = readAtPath(sourceConfig, segments);
    const control = schema.control ?? "text";
    const arrayValues = Array.isArray(value) ? value : [];

    function addArrayValue() {
      const itemKind = schema.item?.kind ?? "string";
      const nextValue = itemKind === "number" ? 0 : itemKind === "boolean" ? false : "";
      updateDraft(segments, [...arrayValues, nextValue]);
    }

    function updateArrayValue(index: number, nextValue: unknown) {
      const nextValues = [...arrayValues];
      nextValues[index] = nextValue;
      updateDraft(segments, nextValues);
    }

    function removeArrayValue(index: number) {
      const nextValues = arrayValues.filter((_, valueIndex) => valueIndex !== index);
      updateDraft(segments, nextValues);
    }

    return (
      <article key={schema.path} className="settings-quick-item">
        <div className="settings-quick-head">
          <p className="settings-node-title">{schema.label}</p>
          {schema.restartRequired ? <span className="settings-chip">Restart required</span> : null}
        </div>
        {schema.description ? <p className="muted">{schema.description}</p> : null}

        {control === "toggle" ? (
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(event) => updateDraft(segments, event.target.checked)}
            />
            <span>{Boolean(value) ? "Enabled" : "Disabled"}</span>
          </label>
        ) : null}

        {control === "select" && Array.isArray(schema.enumValues) && schema.enumValues.length > 0 ? (
          <select
            className="form-input"
            value={String(value ?? schema.enumValues[0])}
            onChange={(event) => updateDraft(segments, event.target.value)}
          >
            {schema.enumValues.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : null}

        {control === "number" ? (
          <input
            type="number"
            className="form-input"
            value={typeof value === "number" ? value : 0}
            min={typeof schema.min === "number" ? schema.min : undefined}
            max={typeof schema.max === "number" ? schema.max : undefined}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              updateDraft(segments, Number.isNaN(parsed) ? 0 : parsed);
            }}
          />
        ) : null}

        {control === "text" || control === "password" ? (
          <input
            className="form-input"
            type={control === "password" ? "password" : "text"}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => updateDraft(segments, event.target.value)}
          />
        ) : null}

        {schema.kind === "array" && schema.item && ["string", "number", "boolean", "enum"].includes(schema.item.kind) ? (
          <div className="settings-quick-array">
            <div className="actions-row actions-row-inline">
              <button type="button" className="action-btn action-btn-small" onClick={addArrayValue}>
                Add value
              </button>
            </div>
            {arrayValues.length === 0 ? <p className="muted">No values added yet.</p> : null}
            {arrayValues.map((entry, index) => (
              <div key={`${schema.path}-${index}`} className="settings-quick-array-row">
                {schema.item?.kind === "boolean" ? (
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(entry)}
                      onChange={(event) => updateArrayValue(index, event.target.checked)}
                    />
                    <span>{Boolean(entry) ? "Enabled" : "Disabled"}</span>
                  </label>
                ) : null}

                {schema.item?.kind === "number" ? (
                  <input
                    type="number"
                    className="form-input"
                    value={typeof entry === "number" ? entry : 0}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      updateArrayValue(index, Number.isNaN(parsed) ? 0 : parsed);
                    }}
                  />
                ) : null}

                {schema.item?.kind === "enum" && Array.isArray(schema.item.enumValues) && schema.item.enumValues.length > 0 ? (
                  <select
                    className="form-input"
                    value={String(entry ?? schema.item.enumValues[0])}
                    onChange={(event) => updateArrayValue(index, event.target.value)}
                  >
                    {schema.item.enumValues.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : null}

                {schema.item?.kind === "string" ? (
                  <input
                    className="form-input"
                    value={typeof entry === "string" ? entry : ""}
                    onChange={(event) => updateArrayValue(index, event.target.value)}
                  />
                ) : null}

                <button type="button" className="action-btn action-btn-secondary action-btn-small" onClick={() => removeArrayValue(index)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </article>
    );
  }

  const apiKeyValue = String(apiHelp?.apiKey ?? "");

  return (
    <AppShell
      active="config"
      title="Settings"
      subtitle="Your NZBHydra settings."
      tabs={tabs}
    >
      {error ? (
        <section className="card" aria-label="Configuration loading error">
          <p className="error-text">{error}</p>
          <p className="muted">Check backend login and role.</p>
        </section>
      ) : null}

      {message ? (
        <section className="card" aria-label="Configuration status message">
          <p className="ok-text">{message}</p>
        </section>
      ) : null}

      <section className="card" aria-label="Configuration overview">
        <div className="metric-grid">
          <article className="metric">
            <p className="metric-label">User</p>
            <p className="metric-value">{userInfos?.username ?? "anonymous"}</p>
            <p className="muted">Auth type: {userInfos?.authType ?? "none"}</p>
          </article>
          <article className="metric">
            <p className="metric-label">Config sections</p>
            <p className="metric-value">{allTopLevelKeys.length}</p>
            <p className="muted">Editable in this app</p>
          </article>
          <article className="metric">
            <p className="metric-label">Admin access</p>
            <p className="metric-value ok">{userInfos?.maySeeAdmin ? "Granted" : "Denied"}</p>
            <p className="muted">Controls edit access.</p>
          </article>
        </div>

        <div className="table-wrap">
          <h3>{selectedTabLabel}</h3>
          <p className="muted">{tabSummary}</p>
          <p className="muted">Edit this tab below.</p>
          {loading ? <p className="muted">Loading settings...</p> : null}
          {!loading ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Entries</th>
                </tr>
              </thead>
              <tbody>
                {selectedSectionRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.key === "topLevel" ? "Top-level keys" : row.key}</td>
                    <td>{row.entries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>

        <div className="table-wrap">
          <h3>API key</h3>
          <p className="muted">Copy your API key and endpoints.</p>
          <div className="settings-api-key-box">
            <input
              className="form-input"
              value={apiKeyValue ? (showApiKey ? apiKeyValue : "*".repeat(Math.max(apiKeyValue.length, 8))) : "No API key available"}
              readOnly
            />
            <div className="actions-row actions-row-inline">
              <button type="button" className="action-btn action-btn-small" onClick={() => setShowApiKey((prev) => !prev)}>
                {showApiKey ? "Hide key" : "Show key"}
              </button>
              <button type="button" className="action-btn action-btn-small" onClick={() => void copyApiKey()} disabled={!apiKeyValue}>
                Copy key
              </button>
            </div>
          </div>
          <p className="muted">Newznab endpoint: {apiHelp?.newznabApi ?? "n/a"}</p>
          <p className="muted">Torznab endpoint: {apiHelp?.torznabApi ?? "n/a"}</p>
        </div>

        {selectedTab === "indexers" ? (
          <div className="table-wrap">
            <h3>Quick add indexer</h3>
            <p className="muted">Pick a preset and save.</p>
            <div className="search-form">
              <label className="form-label" htmlFor="indexer-draft-provider">Provider preset</label>
              <select
                id="indexer-draft-provider"
                className="form-input"
                value={selectedIndexerPreset}
                onChange={(event) => applyIndexerPreset(event.target.value)}
              >
                <option value="">Manual custom</option>
                {indexerPresets.map((preset) => (
                  <option key={preset.key} value={preset.key}>
                    {preset.label}
                  </option>
                ))}
              </select>

              <label className="form-label" htmlFor="indexer-draft-name">Name</label>
              <input
                id="indexer-draft-name"
                className="form-input"
                value={indexerDraft.name}
                onChange={(event) => setIndexerDraft((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="My indexer"
              />

              <label className="form-label" htmlFor="indexer-draft-host">Host</label>
              <input
                id="indexer-draft-host"
                className="form-input"
                value={indexerDraft.host}
                onChange={(event) => setIndexerDraft((prev) => ({ ...prev, host: event.target.value }))}
                placeholder="https://indexer.example"
              />

              <label className="form-label" htmlFor="indexer-draft-type">Type</label>
              <select
                id="indexer-draft-type"
                className="form-input"
                value={indexerDraft.searchModuleType}
                onChange={(event) => setIndexerDraft((prev) => ({ ...prev, searchModuleType: event.target.value as IndexerType }))}
              >
                <option value="NEWZNAB">NEWZNAB</option>
                <option value="TORZNAB">TORZNAB</option>
              </select>

              <label className="form-label" htmlFor="indexer-draft-api-key">API key</label>
              <input
                id="indexer-draft-api-key"
                className="form-input"
                value={indexerDraft.apiKey}
                onChange={(event) => setIndexerDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
                placeholder="Optional"
              />
            </div>
            <div className="actions-row">
              <button type="button" className="action-btn" onClick={() => void addIndexerDraft()} disabled={saving}>
                Save indexer
              </button>
            </div>

            <h3>Configured indexers</h3>
            {indexerEntries.length === 0 ? <p className="muted">No indexers are configured yet.</p> : null}
            {indexerEntries.length > 0 ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Host</th>
                    <th>Type</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {indexerEntries.map((entry, index) => (
                    <tr key={`${entry.name}-${index}`}>
                      <td>{entry.name}</td>
                      <td>{entry.host}</td>
                      <td>{entry.searchModuleType}</td>
                      <td>{entry.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        ) : null}

        <div className="table-wrap">
          <h3>Tab settings</h3>
          <p className="muted">All editable options are below.</p>
          <div className="actions-row">
            <button type="button" className="action-btn" onClick={() => void saveDraftConfig()} disabled={saving || !isDirty || !configDraft}>
              {saving ? "Saving..." : "Save settings"}
            </button>
            <button type="button" className="action-btn action-btn-secondary" onClick={() => void reloadConfig()} disabled={saving}>
              Reload from backend
            </button>
          </div>
          <p className="muted">{isDirty ? "You have unsaved changes." : "All changes are saved."}</p>

          <div className="settings-quick-grid">
            {quickSchemas.map((schema) => renderQuickSetting(schema))}
          </div>

          {quickSchemas.length === 0 ? <p className="muted">No editable settings are available for this tab.</p> : null}
        </div>
      </section>
    </AppShell>
  );
}
