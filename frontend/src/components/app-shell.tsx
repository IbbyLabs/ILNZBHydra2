"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BackendSimpleUpdateInfo, backendGet } from "@/lib/backend";

type Section = "search" | "stats" | "config" | "system";

const NAV_ITEMS: Array<{ href: `/${Section}`; label: string; key: Section }> = [
  { href: "/search", label: "Search", key: "search" },
  { href: "/stats", label: "Stats", key: "stats" },
  { href: "/config", label: "Configuration", key: "config" },
  { href: "/system", label: "System", key: "system" },
];

type AppShellProps = {
  active: Section;
  title: string;
  subtitle: string;
  tabs: Array<{ href: string; label: string; active?: boolean }>;
  children: React.ReactNode;
};

const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/IbbyLabs/NZBHydra2";
const REPO_BRANCH = process.env.NEXT_PUBLIC_REPO_BRANCH ?? "develop";

export function AppShell({ active, title, subtitle, tabs, children }: AppShellProps) {
  const [version, setVersion] = useState<string>("Loading...");

  useEffect(() => {
    let cancelled = false;

    async function loadVersion() {
      try {
        const updates = await backendGet<BackendSimpleUpdateInfo>("/internalapi/updates/simpleInfos");
        if (!cancelled) {
          setVersion(updates.currentVersion ?? updates.packageInfo?.version ?? process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown");
        }
      } catch {
        if (!cancelled) {
          setVersion(process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown");
        }
      }
    }

    void loadVersion();
    return () => {
      cancelled = true;
    };
  }, []);

  const branchUrl = `${REPO_URL.replace(/\/$/, "")}/tree/${REPO_BRANCH}`;

  return (
    <div className="am-shell">
      <div className="am-shell-bg" />
      <div className="am-shell-wrap">
        <header className="am-shell-header">
          <p className="am-shell-kicker">NZBHydra 2</p>
          <h1>NZBHydra 2</h1>
          <p>Search, stats, settings, system.</p>

          <nav className="am-shell-nav" aria-label="Primary navigation">
            {NAV_ITEMS.map((item) => (
              <Link key={item.key} href={item.href} className={item.key === active ? "active" : ""}>
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="am-shell-main">
          <section className="panel" aria-label={title}>
            <h2>{title}</h2>
            <p>{subtitle}</p>
            <nav className="tabs" aria-label={`${title} tabs`}>
              {tabs.map((tab) => (
                <Link key={tab.href} href={tab.href} className={tab.active ? "active" : ""}>
                  {tab.label}
                </Link>
              ))}
            </nav>
            {children}
          </section>
        </main>

        <footer className="am-shell-footer" aria-label="Build and source information">
          <p>
            Repository:
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              IbbyLabs/NZBHydra2
            </a>
          </p>
          <p>
            Branch:
            <a href={branchUrl} target="_blank" rel="noreferrer">
              {REPO_BRANCH}
            </a>
          </p>
          <p>Version: {version}</p>
        </footer>
      </div>
    </div>
  );
}