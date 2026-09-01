import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Box,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  Download,
  FileUp,
  History,
  LayoutGrid,
  LoaderCircle,
  MapPin,
  Menu,
  Pencil,
  Plus,
  QrCode,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { api as realApi, createDemoApi } from "./lib/api";
import {
  completeCognitoCallback,
  getInitialAuthState,
  getAccessToken,
  isLocalApiDevSession,
} from "./lib/auth";
import type {
  ActivityEvent,
  ApiClient,
  AuditSummary,
  CreateGunInput,
  CurrentUser,
  Gun,
  ImportCommitResult,
  ImportPreview,
  ReconciliationResult,
} from "./lib/types";
import "./styles.css";

const todayLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date()).toUpperCase();

// Vitest loads the workspace's .env.local too. Keep component tests deterministic
// and browser-independent without changing the explicit real-API local/prod modes.
const demoMode = import.meta.env.MODE === "test" || import.meta.env.VITE_DEMO_MODE !== "false";
const client: ApiClient = demoMode ? createDemoApi() : realApi;
const localDevSession = isLocalApiDevSession(import.meta.env);
const initialAuthState = getInitialAuthState(
  import.meta.env,
  Boolean(getAccessToken()),
);

const statusTone: Record<Gun["status"], string> = {
  Stored: "green",
  "Checked out": "blue",
  "In repair": "orange",
  Archived: "gray",
};

export function formatGunLocation(gun: Gun): string {
  if (gun.status === "Stored") {
    return gun.safe != null && gun.slot != null
      ? `Safe ${gun.safe} · Slot ${gun.slot}`
      : gun.reportedSafe != null
        ? `Safe ${gun.reportedSafe} · Slot unknown`
        : "Location unassigned";
  }
  if (gun.status === "In repair") return gun.repairVendor || "Repair vendor unassigned";
  if (gun.status === "Checked out") return gun.holder || "Holder unassigned";
  return "Archived";
}

function formatScanTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : date.toLocaleString();
}

function userInitials(user: CurrentUser | null): string {
  if (!user) return "?";
  const words = user.displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
  return (words[0]?.slice(0, 2) || user.email.split("@", 1)[0].slice(0, 2) || "?").toUpperCase();
}

function roleLabel(role: CurrentUser["role"]): string {
  return role === "ACCOUNT_ADMIN" ? "Account administrator" : "Armory operator";
}

function Badge({
  children,
  tone = "gray",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}

function Shell({
  children,
  page,
  onPageChange,
  localDevSession = false,
  currentUser,
  currentUserLoading = false,
}: {
  children: React.ReactNode;
  page: string;
  onPageChange: (p: string) => void;
  localDevSession?: boolean;
  currentUser: CurrentUser | null;
  currentUserLoading?: boolean;
}) {
  const [mobileNav, setMobileNav] = useState(false);
  const navItems = [
    { id: "inventory", label: "Inventory", icon: LayoutGrid },
    { id: "archived", label: "Archived guns", icon: Archive },
    { id: "audits", label: "Audits", icon: ClipboardCheck },
    { id: "people", label: "People", icon: UsersRound },
    { id: "history", label: "Activity history", icon: History },
  ];
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={18} />
          </div>
          <span>
            USMA SKEET & TRAP
            <br />
            <b>ARMORY</b>
          </span>
          <button className="close-nav" onClick={() => setMobileNav(false)}>
            <X size={18} />
          </button>
        </div>
        <nav aria-label="Main navigation">
          <div className="nav-label">Workspace</div>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${page === item.id ? "active" : ""}`}
                onClick={() => {
                  onPageChange(item.id);
                  setMobileNav(false);
                }}
              >
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" disabled title="Settings is not available in V1">
            <Settings2 size={17} />
            Settings <small>(Not in V1)</small>
          </button>
          <div className="account-card">
            <div className="avatar avatar-navy" aria-label={currentUser ? `${currentUser.displayName} initials` : "Current user initials"}>{currentUserLoading ? "…" : userInitials(currentUser)}</div>
            <div>
              <strong>{currentUserLoading ? "Loading account…" : currentUser?.displayName || "Account unavailable"}</strong>
              <small>{currentUser ? roleLabel(currentUser.role) : "Signed-in user"}</small>
            </div>
            <ChevronDown size={14} />
          </div>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)}>
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            <span>Team inventory</span>
            <ArrowRight size={14} />
            <b>
              {page === "inventory"
                ? "Inventory"
                : page[0].toUpperCase() + page.slice(1)}
            </b>
          </div>
          {localDevSession && (
            <span className="local-dev-badge" role="status">
              Local development · actor header enabled
            </span>
          )}
          <div className="top-actions">
            <button className="icon-button" aria-label="Activity" onClick={() => onPageChange("history")}>
              <Clock3 size={18} />
            </button>
            <button className="help-button" disabled title="Help is not available in V1">?</button>
            <div className="topbar-user" aria-label="Current user">
              <div className="topbar-user-copy">
                <strong>{currentUserLoading ? "Loading account…" : currentUser?.displayName || "Account unavailable"}</strong>
                <small>{currentUser ? roleLabel(currentUser.role) : "Signed-in user"}</small>
              </div>
              <div className="avatar avatar-navy" aria-label={currentUser ? `${currentUser.displayName} initials` : "Current user initials"}>{currentUserLoading ? "…" : userInitials(currentUser)}</div>
            </div>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function ArchivedGuns({
  onSelectGun,
  refreshToken = 0,
}: {
  onSelectGun: (gun: Gun) => void;
  refreshToken?: number;
}) {
  const [query, setQuery] = useState("");
  const [guns, setGuns] = useState<Gun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(true);
    setError("");
    client.listGuns(query, { lifecycle: "ARCHIVED" })
      .then((items) => setGuns(items.filter((gun) => gun.status === "Archived")))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load archived guns"))
      .finally(() => setLoading(false));
  }, [query, refreshToken]);
  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PERMANENT RECORDS</p>
          <h1>Archived guns</h1>
          <p className="subheading">Guns retained for history but excluded from active inventory.</p>
        </div>
      </div>
      <div className="section-heading">
        <div>
          <h2>Archived register</h2>
          <span className="muted">{guns.length} archived gun{guns.length === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div className="table-toolbar">
        <div className="search-wrap">
          <Search size={17} />
          <input aria-label="Search archived guns" placeholder="Search serial or model" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>
      {error && <div className="scan-message error" role="alert">{error}</div>}
      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Serial number</th><th>Gun</th><th>Location</th><th>Status</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="table-state"><LoaderCircle className="spin" /> Loading archived guns…</td></tr>
              ) : guns.length === 0 ? (
                <tr><td colSpan={6} className="table-state">No archived guns match the current search.</td></tr>
              ) : guns.map((gun) => (
                <tr key={gun.serial} onClick={() => onSelectGun(gun)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onSelectGun(gun)}>
                  <td><button className="serial-link" onClick={(event) => { event.stopPropagation(); onSelectGun(gun); }}>{gun.serial}</button></td>
                  <td><div className="gun-cell"><div><strong>{gun.model}</strong><small>{gun.gauge || "Gauge unknown"} · {gun.type || "Type unknown"}</small></div></div></td>
                  <td><span className="muted">Location unassigned</span></td>
                  <td><Badge tone={statusTone[gun.status]}>{gun.status}</Badge></td>
                  <td className="muted">{gun.updatedAt}</td>
                  <td><button className="row-chevron" aria-label={`Open ${gun.serial}`} onClick={(event) => { event.stopPropagation(); onSelectGun(gun); }}><ArrowRight size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer"><span>Showing {guns.length} archived gun{guns.length === 1 ? "" : "s"}</span></div>
      </div>
    </div>
  );
}

function Inventory({
  onSelectGun,
  onStartAudit,
  refreshToken = 0,
}: {
  onSelectGun: (gun: Gun) => void;
  onStartAudit: () => void;
  refreshToken?: number;
}) {
  const [guns, setGuns] = useState<Gun[]>([]);
  const [loading, setLoading] = useState(true);
  const [registerFilter, setRegisterFilter] = useState<"All" | "Assigned" | "Unassigned" | "Stored" | "Checked out" | "Repair">("All");
  const [ownerFilter, setOwnerFilter] = useState<"All" | "Beretta" | "DCA" | "Personal" | "Owner unknown">("All");
  const [locationFilter, setLocationFilter] = useState<"All locations" | "Safe 2" | "Safe 3" | "Safe 4" | "Safe 5" | "Safe 6" | "Safe 7" | "Unlocated/off-site">("All locations");
  const [showAddGun, setShowAddGun] = useState(false);
  const [message, setMessage] = useState("");
  const [importPreview, setImportPreview] = useState<{ file: File; result: ImportPreview } | null>(null);
  const [importResult, setImportResult] = useState<ImportCommitResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [sort, setSort] = useState<{ key: "serial" | "gun" | "cadet" | "location" | "status" | "updated"; direction: "asc" | "desc" }>({ key: "serial", direction: "asc" });
  const importInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setLoading(true);
    client
      .listGuns()
      .then(setGuns)
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load inventory"))
      .finally(() => setLoading(false));
  }, [refreshToken]);
  const displayedGuns = useMemo(() => {
    const filtered = guns.filter((gun) => {
      const matchesRegister = (() => {
        switch (registerFilter) {
          case "Assigned": return Boolean(gun.assignedCadet);
          case "Unassigned": return !gun.assignedCadet;
          case "Stored": return gun.status === "Stored";
          case "Checked out": return gun.status === "Checked out";
          case "Repair": return gun.status === "In repair";
          default: return true;
        }
      })();
      const owner = gun.owner?.trim().toLowerCase();
      const matchesOwner = ownerFilter === "All"
        ? true
        : ownerFilter === "Owner unknown"
          ? !owner
          : owner === ownerFilter.toLowerCase();
      const knownSafe = gun.safe ?? gun.reportedSafe;
      const isStoredInSafe = gun.status === "Stored" && knownSafe != null;
      const matchesLocation = locationFilter === "All locations"
        || (locationFilter === "Unlocated/off-site" && !isStoredInSafe)
        || (locationFilter.startsWith("Safe ") && isStoredInSafe && knownSafe === Number(locationFilter.slice(5)));
      return matchesRegister && matchesOwner && matchesLocation;
    });
    const valueFor = (gun: Gun): string => {
      switch (sort.key) {
        case "gun": return `${gun.model} ${gun.gauge || ""} ${gun.type || ""}`;
        case "cadet": return gun.assignedCadet || "";
        case "location": return formatGunLocation(gun);
        case "status": return gun.status;
        case "updated": return gun.updatedAt;
        default: return gun.serial;
      }
    };
    return [...filtered].sort((left, right) => {
      const result = valueFor(left).localeCompare(valueFor(right), undefined, { numeric: true, sensitivity: "base" }) || left.serial.localeCompare(right.serial, undefined, { numeric: true, sensitivity: "base" });
      return sort.direction === "asc" ? result : -result;
    });
  }, [guns, registerFilter, ownerFilter, locationFilter, sort]);
  const changeSort = (key: typeof sort.key) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
  const sortLabel = (key: typeof sort.key, label: string) => `${label}, sorted ${sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "not sorted"}`;
  const counts = useMemo(() => ({
    total: guns.length,
    stored: guns.filter((gun) => gun.status === "Stored").length,
    out: guns.filter((gun) => gun.status === "Checked out").length,
    repair: guns.filter((gun) => gun.status === "In repair").length,
  }), [guns]);
  const storageOverview = useMemo(() => ({
    safes: [2, 3, 4, 5, 6, 7].map((safe) => ({
      safe,
      count: guns.filter((gun) => gun.status === "Stored" && (gun.safe ?? gun.reportedSafe) === safe).length,
    })),
    unlocated: guns.filter((gun) => !(gun.status === "Stored" && (gun.safe ?? gun.reportedSafe) != null)).length,
  }), [guns]);
  const addGun = async (input: CreateGunInput) => {
    try {
      if (input.safe === undefined && input.slot !== undefined) {
        throw new Error("Slot cannot be supplied without a safe");
      }
      await client.createGun(input);
      setShowAddGun(false);
      setMessage("Gun added to the inventory.");
      setLoading(true);
      setGuns(await client.listGuns());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add gun");
    } finally {
      setLoading(false);
    }
  };
  const previewImport = async (file: File) => {
    setImportBusy(true);
    setImportResult(null);
    setMessage("");
    try {
      setImportPreview({ file, result: await client.previewGunImport(file) });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to preview import");
    } finally {
      setImportBusy(false);
    }
  };
  const commitImport = async () => {
    if (!importPreview) return;
    setImportBusy(true);
    try {
      const result = await client.commitGunImport(importPreview.file);
      setImportResult(result);
      setLoading(true);
      setGuns(await client.listGuns());
      setMessage(`Import complete: ${result.created} created, ${result.updated} updated.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to commit import");
    } finally {
      setImportBusy(false);
    }
  };
  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            CURRENT REGISTER <span>·</span> {todayLabel}
          </p>
          <h1>Inventory</h1>
          <p className="subheading">
            Every gun, every location, every handoff.
          </p>
        </div>
        <button className="button button-primary" onClick={onStartAudit}>
          <QrCode size={17} /> Start monthly audit
        </button>
      </div>
      <div className="stat-grid">
        <button
          type="button"
          className={`stat-card ${registerFilter === "All" && ownerFilter === "All" && locationFilter === "All locations" ? "selected" : ""}`}
          aria-label="Show all active guns"
          aria-pressed={registerFilter === "All" && ownerFilter === "All" && locationFilter === "All locations"}
          onClick={() => { setRegisterFilter("All"); setOwnerFilter("All"); setLocationFilter("All locations"); }}
        >
          <div className="stat-icon">
            <Box size={18} />
          </div>
          <div>
            <span>Total active guns</span>
            <strong>{counts.total}</strong>
            <small>
              <Zap size={12} /> Up to date
            </small>
          </div>
        </button>
        <button
          type="button"
          className={`stat-card ${registerFilter === "Stored" ? "selected" : ""}`}
          aria-label="Show stored guns"
          aria-pressed={registerFilter === "Stored"}
          onClick={() => setRegisterFilter("Stored")}
        >
          <div className="stat-icon stat-green">
            <MapPin size={18} />
          </div>
          <div>
            <span>In storage</span>
            <strong>{counts.stored}</strong>
            <small>{counts.total ? Math.round((counts.stored / counts.total) * 100) : 0}% of loaded inventory</small>
          </div>
        </button>
        <button
          type="button"
          className={`stat-card ${registerFilter === "Checked out" ? "selected" : ""}`}
          aria-label="Show checked out guns"
          aria-pressed={registerFilter === "Checked out"}
          onClick={() => setRegisterFilter("Checked out")}
        >
          <div className="stat-icon stat-blue">
            <UserRound size={18} />
          </div>
          <div>
            <span>Checked out</span>
            <strong>{counts.out}</strong>
            <small>To cadets & staff</small>
          </div>
        </button>
        <button
          type="button"
          className={`stat-card ${registerFilter === "Repair" ? "selected" : ""}`}
          aria-label="Show guns in repair"
          aria-pressed={registerFilter === "Repair"}
          onClick={() => setRegisterFilter("Repair")}
        >
          <div className="stat-icon stat-orange">
            <Wrench size={18} />
          </div>
          <div>
            <span>In repair</span>
            <strong>{counts.repair}</strong>
            <small className="text-orange">Needs attention</small>
          </div>
        </button>
      </div>
      <section className="storage-overview" aria-label="Storage location overview">
        <div className="storage-overview-heading">
          <strong>Storage overview</strong>
          <span>Active guns by current location</span>
        </div>
        <div className="storage-overview-grid">
          {storageOverview.safes.map(({ safe, count }) => (
            <button
              key={safe}
              type="button"
              className={`storage-overview-item ${locationFilter === `Safe ${safe}` ? "selected" : ""}`}
              aria-label={`Filter inventory to Safe ${safe}, ${count} guns`}
              aria-pressed={locationFilter === `Safe ${safe}`}
              onClick={() => setLocationFilter(`Safe ${safe}` as typeof locationFilter)}
            >
              <span>Safe {safe}</span>
              <strong>{count}</strong>
            </button>
          ))}
          <button
            type="button"
            className={`storage-overview-item storage-overview-unlocated ${locationFilter === "Unlocated/off-site" ? "selected" : ""}`}
            aria-label={`Filter inventory to unlocated or off-site guns, ${storageOverview.unlocated} guns`}
            aria-pressed={locationFilter === "Unlocated/off-site"}
            onClick={() => setLocationFilter("Unlocated/off-site")}
          >
            <span>Unlocated / off-site</span>
            <strong>{storageOverview.unlocated}</strong>
          </button>
        </div>
      </section>
      <div className="section-heading">
        <div>
          <h2>Gun register</h2>
          <span className="muted">Showing active inventory · {counts.total} guns loaded</span>
        </div>
        <div className="section-actions">
          <input ref={importInputRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void previewImport(file); event.target.value = ""; }} />
          <button className="button button-secondary hide-mobile" onClick={() => importInputRef.current?.click()} disabled={importBusy}>
            <ArrowDownToLine size={16} /> Import
          </button>
          <button className="button button-secondary" onClick={() => setShowAddGun(true)}>
            <Plus size={16} /> Add gun
          </button>
        </div>
      </div>
      <div className="table-toolbar">
        <div className="register-filter-groups">
          <div className="register-filter-group" role="group" aria-label="Assignment filters">
            <span className="register-filter-label">Assignment</span>
            <div className="register-filters">
              {(["All assignments", "Assigned", "Unassigned"] as const).map((filter) => {
                const selected = filter === "All assignments" ? registerFilter === "All" : registerFilter === filter;
                return (
                  <button
                    key={filter}
                    type="button"
                    className={`register-filter-chip ${selected ? "selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => setRegisterFilter(filter === "All assignments" ? "All" : filter)}
                  >
                    {filter}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="register-filter-group" role="group" aria-label="Owner filters">
            <span className="register-filter-label">Owner</span>
            <div className="register-filters">
              {(["All owners", "Beretta", "DCA", "Personal", "Owner unknown"] as const).map((filter) => {
                const selected = filter === "All owners" ? ownerFilter === "All" : ownerFilter === filter;
                return (
                  <button
                    key={filter}
                    type="button"
                    className={`register-filter-chip ${selected ? "selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => setOwnerFilter(filter === "All owners" ? "All" : filter)}
                  >
                    {filter}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {message && <div className="scan-message success" role="status">{message}<button onClick={() => setMessage("")} aria-label="Dismiss message"><X size={14} /></button></div>}
      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {([
                  ["serial", "Serial number"],
                  ["gun", "Gun"],
                  ["cadet", "Assigned cadet"],
                  ["location", "Location"],
                  ["status", "Status"],
                  ["updated", "Updated"],
                ] as const).map(([key, label]) => (
                  <th key={key} aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className="table-sort-button" onClick={() => changeSort(key)} aria-label={sortLabel(key, label)}>
                      {label}<span aria-hidden="true">{sort.key === key ? (sort.direction === "asc" ? " ↑" : " ↓") : " ↕"}</span>
                    </button>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="table-state">
                    <LoaderCircle className="spin" /> Loading inventory…
                  </td>
                </tr>
              ) : displayedGuns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="table-state">
                    No guns match the current filters.
                  </td>
                </tr>
              ) : (
                displayedGuns.map((gun) => (
                  <tr
                    key={gun.serial}
                    onClick={() => onSelectGun(gun)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && onSelectGun(gun)}
                  >
                    <td>
                      <button
                        className="serial-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectGun(gun);
                        }}
                      >
                        {gun.serial}
                      </button>
                    </td>
                    <td>
                      <div className="gun-cell">
                        <div>
                          <strong>{gun.model}</strong>
                          <small>
                            {gun.gauge || "Gauge unknown"} · {gun.type || "Type unknown"}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {gun.assignedCadet ? (
                        <span className="person-cell">
                          <span className="mini-avatar">
                            {gun.assignedCadet
                              .split(" ")
                              .map((s) => s[0])
                              .join("")}
                          </span>
                          {gun.assignedCadet}
                        </span>
                      ) : (
                        <span className="muted">Unassigned</span>
                      )}
                    </td>
                    <td>
                      {gun.status === "Stored" ? (
                        <span className="location">
                          <MapPin size={14} />
                          {formatGunLocation(gun)}
                        </span>
                      ) : gun.status === "In repair" ? (
                        <span className="location repair-location">
                          <Wrench size={14} />
                          {gun.repairVendor}
                        </span>
                      ) : (
                        <span className="location">
                          <UserRound size={14} />
                          {gun.holder}
                        </span>
                      )}
                    </td>
                    <td>
                      <Badge tone={statusTone[gun.status]}>{gun.status}</Badge>
                    </td>
                    <td className="muted">{gun.updatedAt}</td>
                    <td>
                      <button
                        className="row-chevron"
                        aria-label={`Open ${gun.serial}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectGun(gun);
                        }}
                      >
                        <ArrowRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>Showing {displayedGuns.length} of {counts.total} guns</span>
          <div className="pagination">
            <span className="muted">All loaded rows shown</span>
          </div>
        </div>
      </div>
      {showAddGun && <AddGunModal onClose={() => setShowAddGun(false)} onSave={addGun} />}
      {importPreview && <ImportModal preview={importPreview.result} fileName={importPreview.file.name} busy={importBusy} result={importResult} onCommit={commitImport} onClose={() => { setImportPreview(null); setImportResult(null); }} />}
    </div>
  );
}

function AddGunModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (input: CreateGunInput) => Promise<void>;
}) {
  const [serialNumber, setSerialNumber] = useState("");
  const [model, setModel] = useState("");
  const [gauge, setGauge] = useState("12 ga");
  const [owner, setOwner] = useState("");
  const [barrelLength, setBarrelLength] = useState("");
  const [lengthOfPull, setLengthOfPull] = useState("");
  const [handedness, setHandedness] = useState<CreateGunInput["handedness"]>("RIGHT");
  const [type, setType] = useState<CreateGunInput["type"]>("SKEET");
  const [highRib, setHighRib] = useState(false);
  const [safe, setSafe] = useState("");
  const [slot, setSlot] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        serialNumber,
        model,
        gauge,
        owner: owner.trim() || undefined,
        barrelLength: barrelLength ? Number(barrelLength) : undefined,
        lengthOfPull: lengthOfPull ? Number(lengthOfPull) : undefined,
        handedness,
        type,
        highRib,
        safe: safe ? Number(safe) : undefined,
        slot: slot ? Number(slot) : undefined,
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <form className="modal" role="dialog" aria-modal="true" onSubmit={submit}>
        <div className="modal-icon"><Plus size={21} /></div>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close add gun"><X size={18} /></button>
        <h2>Add gun</h2>
        <p>Enter the serial number and the armory details for this gun.</p>
        <div className="form-grid">
          <label>Serial number<input required value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} autoFocus /></label>
          <label>Model<input required value={model} onChange={(event) => setModel(event.target.value)} /></label>
          <label>Gauge<select value={gauge} onChange={(event) => setGauge(event.target.value)}><option>12 ga</option><option>20 ga</option><option>.410 ga</option></select></label>
          <label>Owner / manufacturer<input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Optional" /></label>
          <label>Type<select value={type ?? ""} onChange={(event) => setType(event.target.value as CreateGunInput["type"])}><option value="SKEET">Skeet</option><option value="TRAP">Trap</option><option value="SPORTING">Sporting</option></select></label>
          <label>Barrel length (in)<input type="number" min="1" step="any" value={barrelLength} onChange={(event) => setBarrelLength(event.target.value)} /></label>
          <label>Length of pull (in)<input type="number" min="1" step="any" value={lengthOfPull} onChange={(event) => setLengthOfPull(event.target.value)} /></label>
          <label>Handedness<select value={handedness} onChange={(event) => setHandedness(event.target.value as CreateGunInput["handedness"])}><option value="RIGHT">Right</option><option value="LEFT">Left</option><option value="AMBIDEXTROUS">Ambidextrous</option></select></label>
          <label className="checkbox-field"><input type="checkbox" checked={highRib} onChange={(event) => setHighRib(event.target.checked)} /> High-rib</label>
          <label>Safe (optional)<select value={safe} onChange={(event) => setSafe(event.target.value)}><option value="">Not in storage</option>{[2,3,4,5,6,7].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Slot (optional)<input type="number" min="1" max="28" value={slot} onChange={(event) => setSlot(event.target.value)} /></label>
        </div>
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving || !serialNumber.trim() || !model.trim()}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Add gun</button></div>
      </form>
    </div>
  );
}

function ImportModal({
  preview,
  fileName,
  busy,
  result,
  onCommit,
  onClose,
}: {
  preview: ImportPreview;
  fileName: string;
  busy: boolean;
  result: ImportCommitResult | null;
  onCommit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="modal-icon"><ArrowDownToLine size={21} /></div>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close import"><X size={18} /></button>
        <h2 id="import-title">Review inventory import</h2>
        <p><b>{fileName}</b> was parsed by the server. Review the summary before committing actor-attributed changes.</p>
        <div className="recon-results">
          <div className="recon-stat"><strong>{preview.summary.rows}</strong><span>rows</span></div>
          <div className="recon-stat"><strong>{preview.summary.creates}</strong><span>creates</span></div>
          <div className="recon-stat"><strong>{preview.summary.updates}</strong><span>updates</span></div>
          <div className={`recon-stat ${preview.summary.issues ? "recon-error" : "recon-stat"}`}><strong>{preview.summary.issues}</strong><span>issues</span></div>
        </div>
        {preview.issues.length > 0 && (
          <div className="recon-preview-warning" role="alert">
            {preview.issues.slice(0, 8).map((issue, index) => <span key={`${issue.row}-${issue.field}-${index}`}>Row {issue.row}{issue.field ? ` · ${issue.field}` : ""}: {issue.message}</span>)}
            {preview.issues.length > 8 && <span>+ {preview.issues.length - 8} more issues</span>}
          </div>
        )}
        {preview.warnings && preview.warnings.length > 0 && (
          <div className="recon-preview-warning" role="status">
            {preview.warnings.map((warning, index) => <span key={index}>{warning}</span>)}
          </div>
        )}
        <div className="table-scroll import-preview-table">
          <table><thead><tr><th>Serial</th><th>Model</th><th>Decision</th></tr></thead><tbody>{preview.rows.slice(0, 10).map((row) => <tr key={`${row.sourceRow}-${row.serialNumber}`}><td>{row.serialNumber}</td><td>{row.model || "—"}</td><td><Badge tone={row.decision === "create" ? "green" : "blue"}>{row.decision}</Badge></td></tr>)}</tbody></table>
          {preview.rows.length > 10 && <small className="muted">Showing first 10 of {preview.rows.length} rows.</small>}
        </div>
        {result && <div className="scan-message success" role="status">Import committed: {result.created} created, {result.updated} updated ({result.imported} total).</div>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Close</button><button type="button" className="button button-primary" onClick={onCommit} disabled={busy || !preview.valid || Boolean(result)}>{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Commit import</button></div>
      </div>
    </div>
  );
}

function GunDrawer({
  gun,
  onClose,
  onGunUpdated,
}: {
  gun: Gun;
  onClose: () => void;
  onGunUpdated: (gun: Gun) => void;
}) {
  const [tab, setTab] = useState<"overview" | "history">("overview");
  const [history, setHistory] = useState<ActivityEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [form, setForm] = useState<
    "none" | "edit" | "location" | "custody" | "repair" | "return" | "assignment"
  >("none");
  const [showUnassign, setShowUnassign] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showUnarchive, setShowUnarchive] = useState(false);
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      setHistory(await client.getGunHistory(gun.serial));
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : "Unable to load activity history");
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [gun.serial]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);
  return (
    <div
      className="drawer-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside className="drawer" aria-label={`Details for ${gun.serial}`}>
        <div className="drawer-top">
          <span className="eyebrow">GUN DETAILS</span>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close details"
          >
            <X size={19} />
          </button>
        </div>
        <div className="drawer-title">
          <div className="large-gun-thumb">
            <Box size={24} />
          </div>
          <div>
            <h2>{gun.serial}</h2>
            <p>
              {gun.model} · {gun.gauge || "Gauge unknown"}
            </p>
          </div>
          <Badge tone={statusTone[gun.status]}>{gun.status}</Badge>
        </div>
        <div className="drawer-tabs">
          <button
            className={tab === "overview" ? "active" : ""}
            onClick={() => setTab("overview")}
          >
            Overview
          </button>
          <button
            className={tab === "history" ? "active" : ""}
            onClick={() => { setTab("history"); void loadHistory(); }}
          >
            History <span>{historyLoading ? "…" : history.length}</span>
          </button>
        </div>
        {tab === "overview" ? (
          <div className="drawer-body">
            <div className="detail-actions">
              <button onClick={() => setForm("edit")}>
                <Pencil size={15} /> Edit details
              </button>
              {gun.status === "Archived" ? (
                <button onClick={() => setShowUnarchive(true)}>
                  <Archive size={15} /> Unarchive
                </button>
              ) : (
                <>
                  <button onClick={() => setForm("assignment")}>
                    <UsersRound size={15} /> {gun.assignedCadet ? "Reassign" : "Assign"}
                  </button>
                  {gun.assignedCadet && <button onClick={() => setShowUnassign(true)}>
                    <UserRound size={15} /> Unassign
                  </button>}
                  {gun.status === "Stored" ? (
                    <button onClick={() => setForm("location")}>
                      <MapPin size={15} /> Location
                    </button>
                  ) : gun.status === "Checked out" || gun.status === "In repair" ? (
                    <button onClick={() => setForm("return")}>
                      <MapPin size={15} /> Check in
                    </button>
                  ) : null}
                  <button onClick={() => setForm("custody")}>
                    <UserRound size={15} /> Check out
                  </button>
                  <button onClick={() => setForm("repair")}>
                    <Wrench size={15} /> Repair
                  </button>
                  <button onClick={() => setShowArchive(true)}>
                    <Archive size={15} /> Archive gun
                  </button>
                </>
              )}
            </div>
            <DetailBlock
              title="Current location"
              icon={<MapPin size={16} />}
            >
              <div className="whereabouts-highlight">
                {gun.status === "Stored" ? (
                  <>
                    <strong>
                      {formatGunLocation(gun)}
                    </strong>
                    <span>USMA Skeet &amp; Trap Armory</span>
                  </>
                ) : (
                  <>
                    <strong>
                      {gun.status === "In repair"
                        ? gun.repairVendor
                        : `With ${gun.holder}`}
                    </strong>
                    <span>
                      {gun.status === "In repair"
                        ? "External repair vendor"
                        : "Temporary custody"}
                    </span>
                  </>
                )}
              </div>
            </DetailBlock>
            <DetailBlock title="Assignment" icon={<UsersRound size={16} />}>
              <InfoRow
                label="Cadet shooter"
                value={gun.assignedCadet || "Unassigned"}
              />
              <InfoRow
                label="Assignment type"
                value="Long-term responsibility"
              />
            </DetailBlock>
            <DetailBlock
              title="Specifications"
              icon={<SlidersHorizontal size={16} />}
            >
              <div className="spec-grid">
                <InfoRow label="Model" value={gun.model} />
                <InfoRow label="Type" value={gun.type || "Unknown"} />
                <InfoRow label="Owner / manufacturer" value={gun.owner || "Unknown"} />
                <InfoRow label="Barrel" value={gun.barrelLength} />
                <InfoRow label="Length of pull" value={gun.lengthOfPull} />
                <InfoRow label="Handedness" value={gun.handedness} />
                <InfoRow label="High-rib" value={gun.highRib == null ? "Unknown" : gun.highRib ? "Yes" : "No"} />
              </div>
            </DetailBlock>
          </div>
        ) : (
          <div className="drawer-body">
            <div className="history-note">
              <ShieldCheck size={16} /> History is permanent. Corrections create
              a new event.
            </div>
            {historyLoading ? (
              <div className="empty-state"><LoaderCircle className="spin" size={17} /> Loading activity history…</div>
            ) : historyError ? (
              <div className="scan-message error" role="alert">
                {historyError}
                <button type="button" onClick={() => { void loadHistory(); }}>Try again</button>
              </div>
            ) : history.length === 0 ? (
              <div className="empty-state"><History size={17} /> No activity recorded for this gun.</div>
            ) : (
              <div className="timeline">
                {history.map((event) => (
                  <div className="timeline-item" key={event.id}>
                    <div className={`timeline-marker ${event.tone || ""}`}>
                      <Check size={13} />
                    </div>
                    <div>
                      <strong>{event.action}</strong>
                      <p>{event.detail}</p>
                      <small>
                        {event.actor} · {event.timestamp}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {form !== "none" && (
          <FormModal
            type={form}
            gun={gun}
            onClose={() => setForm("none")}
            onSaved={(updated) => {
              onGunUpdated(updated);
              setForm("none");
            }}
          />
        )}
        {showUnassign && (
          <UnassignModal
            gun={gun}
            onClose={() => setShowUnassign(false)}
            onUnassigned={(updated) => {
              onGunUpdated(updated);
              setShowUnassign(false);
            }}
          />
        )}
        {showArchive && (
          <ArchiveModal
            gun={gun}
            onClose={() => setShowArchive(false)}
            onArchived={(updated) => {
              onGunUpdated(updated);
              setShowArchive(false);
            }}
          />
        )}
        {showUnarchive && (
          <UnarchiveModal
            gun={gun}
            onClose={() => setShowUnarchive(false)}
            onUnarchived={(updated) => {
              onGunUpdated(updated);
              setShowUnarchive(false);
            }}
          />
        )}
      </aside>
    </div>
  );
}

function DetailBlock({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="detail-block">
      <div className="detail-block-heading">
        {icon}
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function measurementInput(value: string): string {
  return value.replace(/\s*in\.?$/i, "").trim();
}

function parseMeasurementInput(value: string, label: string): number | null {
  const normalized = measurementInput(value);
  if (!normalized) return null;
  const mixed = normalized.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  const fraction = normalized.match(/^(\d+)\/(\d+)$/);
  const parsed = mixed
    ? Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
    : fraction
      ? Number(fraction[1]) / Number(fraction[2])
      : Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error(`${label} must be a positive number.`);
  }
  return parsed;
}

function FormModal({
  type,
  gun,
  onClose,
  onSaved,
}: {
  type: "edit" | "location" | "custody" | "repair" | "return" | "assignment";
  gun: Gun;
  onClose: () => void;
  onSaved: (gun: Gun) => void;
}) {
  const title = {
    edit: "Edit gun details",
    location: "Update location",
    custody: "Check out gun",
    repair: "Send to repair",
    return: "Check in gun",
    assignment: gun.assignedCadet ? "Reassign cadet" : "Assign cadet",
  }[type];
  const savedSafe = gun.defaultSafe ?? gun.safe;
  const savedSlot = gun.defaultSlot ?? gun.slot;
  const [safe, setSafe] = useState(savedSafe == null ? "" : String(savedSafe));
  const [slot, setSlot] = useState(savedSlot == null ? "" : String(savedSlot));
  const [useSavedLocation, setUseSavedLocation] = useState(type === "return" && savedSafe != null && savedSlot != null);
  const [model, setModel] = useState(gun.model);
  const [gauge, setGauge] = useState(gun.gauge || "");
  const [owner, setOwner] = useState(gun.owner || "");
  const [barrelLength, setBarrelLength] = useState(measurementInput(gun.barrelLength));
  const [lengthOfPull, setLengthOfPull] = useState(measurementInput(gun.lengthOfPull));
  const [handedness, setHandedness] = useState(gun.handedness === "Left" ? "LEFT" : gun.handedness === "Ambidextrous" ? "AMBIDEXTROUS" : "RIGHT");
  const [gunType, setGunType] = useState(gun.type === "Trap" ? "TRAP" : gun.type === "Sporting" ? "SPORTING" : gun.type === "Skeet" ? "SKEET" : "");
  const [highRib, setHighRib] = useState(gun.highRib == null ? "" : gun.highRib ? "yes" : "no");
  const [person, setPerson] = useState("");
  const [cadet, setCadet] = useState(gun.assignedCadet || "");
  const [note, setNote] = useState("");
  const [vendor, setVendor] = useState(gun.repairVendor || "");
  const [reason, setReason] = useState("");
  const [expectedReturn, setExpectedReturn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      let updated: Gun;
      if (type === "edit") {
        updated = await client.updateGunDetails(gun.serial, {
          model: model.trim(),
          gauge: gauge.trim() || null,
          owner: owner.trim() || null,
          barrelLength: parseMeasurementInput(barrelLength, "Barrel length"),
          lengthOfPull: parseMeasurementInput(lengthOfPull, "Length of pull"),
          handedness: handedness as "RIGHT" | "LEFT" | "AMBIDEXTROUS",
          type: gunType ? gunType as "SKEET" | "TRAP" | "SPORTING" : null,
          highRib: highRib === "" ? null : highRib === "yes",
        });
      } else if (type === "location") {
        updated = await client.updateLocation(gun.serial, { safe: Number(safe), slot: Number(slot) });
      } else if (type === "return") {
        if (!gun.custodyId) throw new Error("Active custody record is unavailable; refresh the gun and try again");
        updated = await client.returnGun(gun.serial, gun.custodyId, { safe: Number(safe), slot: Number(slot) });
      } else if (type === "assignment") {
        updated = await client.assignCadet(gun.serial, cadet.trim());
      } else if (type === "custody") {
        updated = await client.checkoutGun(gun.serial, { personName: person, notes: note || undefined });
      } else if (type === "repair") {
        updated = await client.sendToRepair(gun.serial, { vendor, reason, notes: note || undefined, expectedReturn: expectedReturn || undefined });
      } else {
        throw new Error("Unsupported gun form");
      }
      onSaved(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save change");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="inline-modal">
      <div className="inline-modal-header">
        <strong>{title}</strong>
        <button onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="form-grid">
        {type === "edit" ? (
          <>
            <label>
              Model
              <input value={model} onChange={(event) => setModel(event.target.value)} required autoFocus />
            </label>
            <label>
              Gauge
              <input value={gauge} onChange={(event) => setGauge(event.target.value)} placeholder="e.g. 12 ga" />
            </label>
            <label>
              Barrel length
              <input value={barrelLength} onChange={(event) => setBarrelLength(event.target.value)} placeholder="30" inputMode="decimal" />
            </label>
            <label>
              Length of pull
              <input value={lengthOfPull} onChange={(event) => setLengthOfPull(event.target.value)} placeholder="14.375" inputMode="decimal" />
            </label>
            <label>
              Handedness
              <select value={handedness} onChange={(event) => setHandedness(event.target.value)}>
                <option value="RIGHT">Right</option>
                <option value="LEFT">Left</option>
                <option value="AMBIDEXTROUS">Ambidextrous</option>
              </select>
            </label>
            <label>
              Type
              <select value={gunType} onChange={(event) => setGunType(event.target.value)}>
                <option value="">Unknown</option>
                <option value="SKEET">Skeet</option>
                <option value="TRAP">Trap</option>
                <option value="SPORTING">Sporting</option>
              </select>
            </label>
            <label>
              Owner / manufacturer
              <input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Unknown" />
            </label>
            <label>
              High-rib
              <select value={highRib} onChange={(event) => setHighRib(event.target.value)}>
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          </>
        ) : type === "location" || type === "return" ? (
          <>
            {type === "return" && savedSafe != null && savedSlot != null && <label className="checkbox-field full-field">
              <input type="checkbox" checked={useSavedLocation} onChange={(event) => {
                const checked = event.target.checked;
                setUseSavedLocation(checked);
                if (checked) {
                  setSafe(String(savedSafe));
                  setSlot(String(savedSlot));
                } else {
                  setSafe("");
                  setSlot("");
                }
              }} />
              Use saved location (Safe {savedSafe} · Slot {savedSlot})
            </label>}
            {(!useSavedLocation || type === "location") && <>
              <label>
                Safe
                <select value={safe} onChange={(event) => setSafe(event.target.value)}>
                  <option value="">Select safe…</option>
                  <option>2</option>
                  <option>3</option>
                  <option>4</option>
                  <option>5</option>
                  <option>6</option>
                  <option>7</option>
                </select>
              </label>
              <label>
                Slot
                <input type="number" min="1" max="28" value={slot} onChange={(event) => setSlot(event.target.value)} required />
              </label>
            </>}
            {type === "location" && <label className="full-field">
              Reason
              <input placeholder="Why is this moving?" />
            </label>}
          </>
        ) : type === "assignment" ? (
          <label className="full-field">
            Cadet shooter
            <input placeholder="Cadet name" value={cadet} onChange={(event) => setCadet(event.target.value)} required autoFocus />
          </label>
        ) : type === "custody" ? (
          <>
            <label className="full-field">
              Person
              <input placeholder="Search a person…" value={person} onChange={(event) => setPerson(event.target.value)} required />
            </label>
            <label className="full-field">
              Checkout note
              <textarea placeholder="Optional note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label>
              Vendor
              <input
                value={vendor}
                onChange={(event) => setVendor(event.target.value)}
                placeholder="Vendor name"
                required
              />
            </label>
            <label>
              Expected return
              <input type="date" value={expectedReturn} onChange={(event) => setExpectedReturn(event.target.value)} />
            </label>
            <label className="full-field">
              Reason
              <input placeholder="Repair or modification needed" value={reason} onChange={(event) => setReason(event.target.value)} required />
            </label>
            <label className="full-field">
              Notes
              <textarea
                placeholder="Add details for the armory record"
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </>
        )}
      </div>
      {error && <div className="signin-error" role="alert">{error}</div>}
      <div className="form-actions">
        <button className="button button-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="button button-primary" onClick={save} disabled={saving || (type === "edit" && !model.trim()) || (type === "custody" && !person.trim()) || (type === "assignment" && !cadet.trim()) || (type === "repair" && (!vendor.trim() || !reason.trim())) || ((type === "location" || type === "return") && (!safe || !slot))}>
          {saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Save change
        </button>
      </div>
    </div>
  );
}

function ArchiveModal({
  gun,
  onClose,
  onArchived,
}: {
  gun: Gun;
  onClose: () => void;
  onArchived: (gun: Gun) => void;
}) {
  const [justification, setJustification] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const archive = async () => {
    if (!justification.trim()) {
      setError("Archive justification is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      onArchived(await client.archiveGun(gun.serial, justification.trim()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to archive gun");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="archive-title">
        <div className="modal-icon modal-icon-warning"><Archive size={21} /></div>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close archive confirmation" disabled={busy}><X size={18} /></button>
        <h2 id="archive-title">Archive gun?</h2>
        <p><strong>{gun.serial}</strong> will leave active inventory but remain in the permanent archive. Active custody must be returned first.</p>
        <label className="full-field">Justification
          <textarea value={justification} onChange={(event) => setJustification(event.target.value)} placeholder="Why is this gun being archived?" rows={3} autoFocus disabled={busy} />
        </label>
        <label className="checkbox-field">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} />
          I understand this removes the gun from active inventory.
        </label>
        {error && <div className="signin-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="button button-primary" onClick={() => void archive()} disabled={busy || !confirmed || !justification.trim()}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Archive size={15} />} Archive gun
          </button>
        </div>
      </div>
    </div>
  );
}

function UnarchiveModal({
  gun,
  onClose,
  onUnarchived,
}: {
  gun: Gun;
  onClose: () => void;
  onUnarchived: (gun: Gun) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unarchive = async () => {
    setBusy(true);
    setError("");
    try {
      onUnarchived(await client.unarchiveGun(gun.serial));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to unarchive gun");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="unarchive-title">
        <div className="modal-icon"><Archive size={21} /></div>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close unarchive confirmation" disabled={busy}><X size={18} /></button>
        <h2 id="unarchive-title">Unarchive gun?</h2>
        <p><strong>{gun.serial}</strong> will return to active inventory as stored, with <strong>Location unassigned</strong>. Choose a safe and slot separately before putting it away.</p>
        <label className="checkbox-field">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} />
          I understand this does not restore the previous location.
        </label>
        {error && <div className="signin-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="button button-primary" onClick={() => void unarchive()} disabled={busy || !confirmed}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Unarchive gun
          </button>
        </div>
      </div>
    </div>
  );
}

function UnassignModal({
  gun,
  onClose,
  onUnassigned,
}: {
  gun: Gun;
  onClose: () => void;
  onUnassigned: (gun: Gun) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unassign = async () => {
    setBusy(true);
    setError("");
    try {
      onUnassigned(await client.unassignCadet(gun.serial));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to remove the cadet assignment");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="unassign-title">
        <div className="modal-icon modal-icon-warning"><UserRound size={21} /></div>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close unassign confirmation" disabled={busy}><X size={18} /></button>
        <h2 id="unassign-title">Remove cadet assignment?</h2>
        <p>This removes <strong>{gun.assignedCadet}</strong> as the current cadet shooter for <strong>{gun.serial}</strong>. The historical assignment record is preserved.</p>
        <label className="checkbox-field">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} />
          I understand this ends the active assignment.
        </label>
        {error && <div className="signin-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="button button-primary" onClick={() => void unassign()} disabled={busy || !confirmed}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Unassign gun
          </button>
        </div>
      </div>
    </div>
  );
}

function AuditPage({
  audit,
  setAudit,
  onBack,
}: {
  audit: AuditSummary;
  setAudit: (a: AuditSummary) => void;
  onBack: () => void;
}) {
  const [serial, setSerial] = useState("");
  const [scanned, setScanned] = useState<Array<{ serial: string; scannedAt: string }>>(() => audit.scannedGuns ?? []);
  const [scanMessage, setScanMessage] = useState<{
    tone: "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const [reconciliation, setReconciliation] =
    useState<ReconciliationResult | null>(null);
  const [finalizeError, setFinalizeError] = useState("");
  const [finalizing, setFinalizing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reviewFile, setReviewFile] = useState<{
    name: string;
    serials: string[];
    duplicates: string[];
    invalidTokens: string[];
    warnings: string[];
    pageCount: number;
  } | null>(null);
  const [reviewedSerials, setReviewedSerials] = useState("");
  const [exceptionSerial, setExceptionSerial] = useState<string | null>(null);
  const [exceptionPickerOpen, setExceptionPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const progress = Math.round((audit.resolved / audit.expected) * 100);
  const unresolvedItems = (audit.items || []).filter((item) => item.status === "UNRESOLVED");
  const scan = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const normalized = serial.trim().toUpperCase();
    if (!normalized) {
      setScanMessage({ tone: "warning", text: "Scan or enter a serial number before submitting." });
      inputRef.current?.focus();
      return;
    }
    if (scanned.some((item) => item.serial === normalized)) {
      setScanMessage({
        tone: "warning",
        text: `${normalized} was already scanned in this audit.`,
      });
      setSerial("");
      return;
    }
    try {
      const result = await client.scanAuditSerial(audit.id, normalized);
      if (result.outcome === "scanned") {
        setScanned((prev) => [{ serial: normalized, scannedAt: new Date().toISOString() }, ...prev.filter((item) => item.serial !== normalized)]);
        setScanMessage({
          tone: "success",
          text: `${normalized} verified in current inventory.`,
        });
        setAudit({
          ...audit,
          resolved: audit.resolved + 1,
          scanned: audit.scanned + 1,
          items: audit.items?.map((item) => item.serial === normalized ? { ...item, status: "SCANNED" } : item),
        });
      } else if (result.outcome === "duplicate") {
        setScanMessage({ tone: "warning", text: `${normalized} was already resolved in this audit.` });
      } else {
        setScanMessage({
          tone: "error",
          text: result.outcome === "unexpected"
            ? `${normalized} is not in the active inventory snapshot.`
            : `${normalized} is archived and cannot resolve this audit.`,
        });
      }
    } catch (caught) {
      setScanMessage({
        tone: "error",
        text: caught instanceof Error ? caught.message : "Unable to record this scan.",
      });
    }
    setSerial("");
    inputRef.current?.focus();
  };
  const prepareUpload = async (file: File) => {
    setUploading(true);
    try {
      const preview = await client.previewReconciliationPdf(audit.id, file);
      setReviewFile({
        name: file.name,
        serials: preview.serials,
        duplicates: preview.duplicates.map((item) => item.serial),
        invalidTokens: preview.invalidTokens,
        warnings: preview.warnings,
        pageCount: preview.pageCount,
      });
      setReviewedSerials(preview.serials.join("\n"));
    } finally {
      setUploading(false);
    }
  };
  const upload = async () => {
    if (!reviewFile) return;
    const serials = [
      ...new Set(
        reviewedSerials
          .split(/[\s,]+/)
          .map((value) => value.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    setUploading(true);
    try {
      setReconciliation(
        await client.uploadReconciliation(audit.id, {
          sourceName: reviewFile.name,
          serials,
        }),
      );
      setAudit({ ...audit, reconciliation: "Reconciled", status: "Complete" });
    } finally {
      setUploading(false);
    }
  };
  const finalize = async () => {
    setFinalizing(true);
    setFinalizeError("");
    try {
      await client.finalizeAudit(audit.id);
      setAudit({ ...audit, status: "Physical count finalized" });
    } catch (caught) {
      setFinalizeError(caught instanceof Error ? caught.message : "Unable to finalize the physical count.");
    } finally {
      setFinalizing(false);
    }
  };
  const downloadEvidence = async (format: "csv" | "pdf") => {
    const blob = await client.exportAudit(audit.id, format);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${audit.label.replace(/\s+/g, "-").toLowerCase()}-evidence.${format}`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <div className="page-wrap audit-page">
      <div className="page-heading">
        <div>
          <button className="back-link" onClick={onBack}>
            <ArrowLeft size={15} /> All audits
          </button>
          <p className="eyebrow">
            MONTHLY INVENTORY <span>·</span> STARTED {audit.startedAt || "—"}
          </p>
          <h1>{audit.label}</h1>
          <p className="subheading">
            Scan each gun once. Resolve every exception before finalizing.
          </p>
        </div>
        <div className="heading-actions">
          <Badge tone="orange">{audit.status}</Badge>
          <button
            className="button button-secondary"
            onClick={() => downloadEvidence("csv")}
            disabled={audit.status === "In progress"}
          >
            <Download size={16} /> CSV evidence
          </button>
          <button
            className="button button-secondary"
            onClick={() => downloadEvidence("pdf")}
            disabled={audit.status === "In progress"}
          >
            <Download size={16} /> PDF evidence
          </button>
        </div>
      </div>
      <div className="audit-layout">
        <section className="audit-main">
          <div className="audit-progress-card">
            <div className="progress-copy">
              <div>
                <span className="eyebrow">PHYSICAL COUNT</span>
                <h2>
                  {audit.resolved} <small>of {audit.expected} resolved</small>
                </h2>
              </div>
              <strong>{progress}%</strong>
            </div>
            <div className="progress-track">
              <div style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-breakdown">
              <span>
                <i className="legend-dot green" />
                {audit.scanned} scanned
              </span>
              <span>
                <i className="legend-dot blue" />
                {audit.repairVerified} repair verified
              </span>
              <span>
                <i className="legend-dot orange" />
                {audit.exceptions} exception
              </span>
              <span className="remaining">
                <b>{audit.expected - audit.resolved}</b> remaining
              </span>
            </div>
            <div className="audit-finalize-row">
              <span>
                {audit.status === "In progress"
                  ? audit.expected === audit.resolved
                    ? "All snapshot items are resolved. The physical count is ready to finalize."
                    : "Resolve every snapshot item to finalize the physical count."
                  : "Physical count evidence is finalized."}
              </span>
              <button
                className="button button-primary"
                onClick={finalize}
                disabled={
                  finalizing ||
                  audit.status !== "In progress" ||
                  audit.expected !== audit.resolved
                }
              >
                {finalizing ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Finalize physical count
              </button>
            </div>
            {finalizeError && <div className="scan-message error" role="alert">{finalizeError}</div>}
          </div>
          <div className="scan-card">
            <div className="scan-card-heading">
              <div className="scan-icon">
                <QrCode size={24} />
              </div>
              <div>
                <h2>Scan a gun</h2>
                <p>Use your camera or a connected USB scanner.</p>
              </div>
              <span className="live-pill">
                <i /> Live
              </span>
            </div>
            <form className="scan-form" onSubmit={scan}>
              <input
                ref={inputRef}
                autoFocus
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                placeholder="Scan QR code or enter serial number"
                aria-label="Scan QR code or enter serial number"
              />
              <button className="button button-primary" type="submit">
                <QrCode size={18} /> Scan
              </button>
            </form>
            {scanMessage && (
              <div className={`scan-message ${scanMessage.tone}`} role={scanMessage.tone === "error" ? "alert" : "status"}>
                <span className="message-icon">
                  {scanMessage.tone === "success" ? (
                    <Check size={15} />
                  ) : (
                    <X size={15} />
                  )}
                </span>
                {scanMessage.text}
              </div>
            )}
            <div className="scan-tip">
              <Zap size={14} />
              <span>
                <b>Tip:</b> A duplicate scan is flagged automatically. Scanning
                never changes location or custody.
              </span>
            </div>
          </div>
          <div className="recent-scans">
            <div className="section-heading">
              <div>
                <h2>Scanned guns</h2>
                <span className="muted">Newest scans first</span>
              </div>
              <span className="muted">{scanned.length} scanned</span>
            </div>
            <div className="scan-list">
              {scanned.length === 0 ? (
                <div className="empty-state">
                  <QrCode size={20} />
                  <span>Your scans will appear here.</span>
                </div>
              ) : (
                scanned.map((item) => (
                  <div className="scan-row" key={item.serial}>
                    <span className="scan-check">
                      <Check size={14} />
                    </span>
                    <div>
                      <strong>{item.serial}</strong>
                      <small>Verified · {formatScanTime(item.scannedAt)}</small>
                    </div>
                    <Badge tone="green">Scanned</Badge>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
        <aside className="audit-side">
          <div className="side-card">
            <div className="side-card-heading">
              <h3>Resolve before finalizing</h3>
              <span className="count-badge">
                {audit.expected - audit.resolved}
              </span>
            </div>
            <div className="resolve-list">
              <button disabled title="The API does not expose unresolved-item details yet">
                <span className="resolve-icon resolve-gray">
                  <Archive size={15} />
                </span>
                <span>
                  <strong>Not yet scanned</strong>
                  <small>{audit.expected - audit.resolved} guns</small>
                </span>
                <ArrowRight size={15} />
              </button>
              <button disabled title="Repair verification is available from the audit API; item browsing is not in V1">
                <span className="resolve-icon resolve-orange">
                  <Wrench size={15} />
                </span>
                <span>
                  <strong>Repair verification</strong>
                  <small>5 guns at vendors</small>
                </span>
                <ArrowRight size={15} />
              </button>
              <button onClick={() => setExceptionPickerOpen((open) => !open)} disabled={unresolvedItems.length === 0}>
                <span className="resolve-icon resolve-red">
                  <ShieldCheck size={15} />
                </span>
                <span>
                  <strong>Exceptions</strong>
                  <small>{audit.exceptions} needs review</small>
                </span>
                <ArrowRight size={15} />
              </button>
              {exceptionPickerOpen && unresolvedItems.length > 0 && (
                <div className="exception-picker">
                  <label htmlFor="exception-item">Unresolved gun</label>
                  <select id="exception-item" defaultValue="" onChange={(event) => event.target.value && setExceptionSerial(event.target.value)}>
                    <option value="" disabled>Select a serial number…</option>
                    {unresolvedItems.map((item) => <option key={item.serial} value={item.serial}>{item.serial}</option>)}
                  </select>
                  <small>Select the exact unresolved snapshot item before adding an exception.</small>
                </div>
              )}
            </div>
          </div>
          <div className="side-card reconciliation-card">
            <div className="side-card-heading">
              <div>
                <h3>PDF reconciliation</h3>
                <small>External monitored list</small>
              </div>
              <Badge tone={reconciliation ? "green" : "gray"}>
                {reconciliation ? "Reconciled" : "Not uploaded"}
              </Badge>
            </div>
            {!reconciliation ? (
              <>
                <p>
                  Upload the report from the monitoring group after the physical
                  count. The source PDF is processed and discarded.
                </p>
                {reviewFile ? (
                  <div className="reconciliation-review">
                    <p>
                      <b>{reviewFile.name}</b> previewed by the server (
                      {reviewFile.pageCount} pages). Review the extracted serial
                      set before attaching it; source PDF bytes were discarded.
                    </p>
                    {(reviewFile.duplicates.length > 0 ||
                      reviewFile.invalidTokens.length > 0 ||
                      reviewFile.warnings.length > 0) && (
                      <div className="recon-preview-warning">
                        {reviewFile.duplicates.length > 0 && (
                          <span>
                            {reviewFile.duplicates.length} duplicate candidate
                            {reviewFile.duplicates.length === 1 ? "" : "s"}
                          </span>
                        )}
                        {reviewFile.invalidTokens.length > 0 && (
                          <span>
                            {reviewFile.invalidTokens.length} invalid token
                            {reviewFile.invalidTokens.length === 1 ? "" : "s"}
                          </span>
                        )}
                        {reviewFile.warnings.map((warning) => (
                          <span key={warning}>{warning}</span>
                        ))}
                      </div>
                    )}
                    <textarea
                      aria-label="Reviewed serial numbers"
                      rows={6}
                      value={reviewedSerials}
                      onChange={(e) => setReviewedSerials(e.target.value)}
                    />
                    <button
                      className="button button-primary full-button"
                      onClick={upload}
                      disabled={uploading || !reviewedSerials.trim()}
                    >
                      {uploading ? (
                        <LoaderCircle className="spin" size={15} />
                      ) : (
                        <Check size={15} />
                      )}{" "}
                      Attach reviewed serial set
                    </button>
                  </div>
                ) : (
                  <label className="upload-zone">
                    <input
                      type="file"
                      accept="application/pdf"
                      disabled={audit.status === "In progress"}
                      onChange={(e) =>
                        e.target.files?.[0] && prepareUpload(e.target.files[0])
                      }
                    />
                    {uploading ? (
                      <LoaderCircle className="spin" />
                    ) : (
                      <FileUp size={21} />
                    )}
                    <strong>
                      {uploading ? "Reading report…" : "Upload PDF report"}
                    </strong>
                    <span>
                      {audit.status === "In progress"
                        ? "Finalize physical count first"
                        : "Selectable-text PDF · max 10 MB"}
                    </span>
                  </label>
                )}
              </>
            ) : (
              <Reconciliation result={reconciliation} />
            )}
          </div>
        </aside>
      </div>
      {exceptionSerial && (
        <ExceptionModal
          serial={exceptionSerial}
          onClose={() => setExceptionSerial(null)}
          onSave={(reason, note) => {
            void client
              .approveException(audit.id, exceptionSerial, reason, note)
              .then(() => {
                setExceptionSerial(null);
                setAudit({
                  ...audit,
                  exceptions: audit.exceptions + 1,
                  resolved: audit.resolved + 1,
                  items: audit.items?.map((item) => item.serial === exceptionSerial ? { ...item, status: "EXCEPTION" } : item),
                });
              });
          }}
        />
      )}
    </div>
  );
}

function Reconciliation({ result }: { result: ReconciliationResult }) {
  return (
    <div className="recon-results">
      <div className="recon-stat">
        <strong>{result.matched}</strong>
        <span>matched</span>
      </div>
      <div className="recon-stat recon-warning">
        <strong>{result.missing.length}</strong>
        <span>missing</span>
      </div>
      <div className="recon-stat recon-error">
        <strong>{result.unknown.length + result.duplicate.length}</strong>
        <span>review</span>
      </div>
      <div className="recon-group">
        <h4>Needs attention</h4>
        {result.missing.map((s) => (
          <div className="recon-row" key={s}>
            <span className="mini-dot warning" />
            {s}
            <span className="recon-label">Missing</span>
          </div>
        ))}
        {result.unknown.map((s) => (
          <div className="recon-row" key={s}>
            <span className="mini-dot error" />
            {s}
            <span className="recon-label">Unknown</span>
          </div>
        ))}
        {result.duplicate.map((s) => (
          <div className="recon-row" key={s}>
            <span className="mini-dot error" />
            {s}
            <span className="recon-label">Duplicate</span>
          </div>
        ))}
      </div>
      <button className="button button-primary full-button" disabled title="Reconciliation review is represented by the findings above">
        Reconciliation findings shown <Check size={15} />
      </button>
    </div>
  );
}
function ExceptionModal({
  serial,
  onClose,
  onSave,
}: {
  serial: string;
  onClose: () => void;
  onSave: (reason: string, note: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-icon modal-icon-warning">
          <ShieldCheck size={21} />
        </div>
        <button className="modal-close" onClick={onClose}>
          <X size={18} />
        </button>
        <h2>Resolve as an exception</h2>
        <p><strong>{serial}</strong> is an unresolved item in this audit snapshot. Record why it was verified as an exception.</p>
        <label>
          Reason
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            <option value="" disabled>
              Select a reason…
            </option>
            <option>Gun is physically present but not on snapshot</option>
            <option>Gun is at an unrecorded location</option>
            <option>Serial needs correction</option>
          </select>
        </label>
        <label>
          Required note
          <textarea
            rows={3}
            placeholder="Explain what was verified and why…"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button button-primary"
            onClick={() => onSave(reason, note)}
            disabled={!reason || !note.trim()}
          >
            <Check size={15} /> Approve exception
          </button>
        </div>
      </div>
    </div>
  );
}

function StartAuditModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = name.trim();
    if (!normalized) {
      setError("Audit name is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(normalized);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start audit");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="start-audit-title" onSubmit={submit}>
        <div className="modal-icon"><QrCode size={21} /></div>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close start audit"><X size={18} /></button>
        <h2 id="start-audit-title">Start an audit</h2>
        <p>Give this physical count a unique name so it can be found in the audit history.</p>
        <label>Audit name<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. September 2026 monthly inventory" /></label>
        {error && <div className="signin-error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={saving || !name.trim()}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Start audit</button></div>
      </form>
    </div>
  );
}

function Audits({ onOpen, onStart }: { onOpen: (audit: AuditSummary) => void; onStart: () => void }) {
  const [audits, setAudits] = useState<AuditSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<AuditSummary["status"] | "All">("All");
  const [error, setError] = useState("");
  useEffect(() => {
    client.listAudits()
      .then(setAudits)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load audits"))
      .finally(() => setLoading(false));
  }, []);
  const filteredAudits = statusFilter === "All" ? audits : audits.filter((audit) => audit.status === statusFilter);
  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">INVENTORY CONTROL</p>
          <h1>Audits</h1>
          <p className="subheading">
            Physical counts and external report reconciliation.
          </p>
        </div>
        <button className="button button-primary" onClick={onStart}>
          <Plus size={17} /> Start an audit
        </button>
      </div>
      <div className="audit-list-card">
        <div className="table-toolbar">
          <div>
            <h2>All audits</h2>
            <span className="muted">
              Monthly physical counts remain available as evidence.
            </span>
          </div>
          <label className="audit-status-filter">
            <span>Filter by status</span>
            <select className="audit-status-filter-select" aria-label="Audit status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AuditSummary["status"] | "All")}>
              <option>All</option><option>In progress</option><option>Physical count finalized</option><option>Complete</option>
            </select>
          </label>
        </div>
        {error && <div className="scan-message error" role="alert">{error}</div>}
        {loading ? (
          <div className="empty-panel"><LoaderCircle className="spin" size={22} /><p>Loading audits…</p></div>
        ) : filteredAudits.length === 0 ? (
          <div className="empty-panel">
            <div className="empty-panel-icon"><ClipboardCheck size={22} /></div>
            <h2>{audits.length === 0 ? "No audits yet" : "No audits match this filter"}</h2>
            <p>{audits.length === 0 ? "Start a physical count to create the first persisted audit." : "Choose another status to view persisted audits."}</p>
            {audits.length === 0 && <button className="button button-primary" onClick={onStart}><Plus size={16} /> Start an audit</button>}
          </div>
        ) : (
          <>
            <div className="audit-row audit-row-header"><span>Audit</span><span>Progress</span><span>Status</span><span>Reconciliation</span><span /></div>
            {filteredAudits.map((audit) => <button className="audit-row" key={audit.id} onClick={() => onOpen(audit)}>
              <div><strong>{audit.label}</strong><small>Started by {audit.startedBy || "Unknown"} · {audit.startedAt}</small></div>
              <div className="audit-row-progress"><span>{audit.resolved} / {audit.expected}</span><div className="mini-progress"><i style={{ width: `${audit.expected ? (audit.resolved / audit.expected) * 100 : 0}%` }} /></div></div>
              <Badge tone={audit.status === "Complete" ? "green" : "orange"}>{audit.status}</Badge>
              <Badge tone={audit.reconciliation === "Reconciled" ? "green" : "gray"}>{audit.reconciliation || "Not uploaded"}</Badge>
              <ArrowRight size={16} />
            </button>)}
          </>
        )}
      </div>
    </div>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const hostedSignIn = !demoMode;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await client.signIn(email, password);
      // Hosted Cognito navigation has started. Do not mark this React session
      // authenticated yet: doing so triggers protected API requests before the
      // callback has exchanged its authorization code for an access token.
      // Those 401s clear the PKCE verifier and cancel the sign-in flow.
      if (hostedSignIn) return;
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="signin-page">
      <div className="signin-card">
        <div className="signin-brand">
          <div className="brand-mark">
            <ShieldCheck size={20} />
          </div>
          <span>
            USMA SKEET & TRAP
            <br />
            <b>ARMORY</b>
          </span>
        </div>
        <p className="eyebrow">SECURE INVENTORY ACCESS</p>
        <h1>Welcome back</h1>
        <p className="signin-copy">
          Sign in to manage the armory register and monthly audits.
        </p>
        <form onSubmit={submit}>
          {!hostedSignIn && (
            <label>
              Email address
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@usma.edu"
                required
              />
            </label>
          )}
          {!hostedSignIn && (
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
              />
            </label>
          )}
          {error && <div className="signin-error">{error}</div>}
          <button className="button button-primary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <ShieldCheck size={16} />
            )}
            {busy
              ? "Opening secure sign-in…"
              : hostedSignIn
                ? "Continue with Cognito"
                : "Sign in"}
          </button>
        </form>
        <button className="forgot-link">
          {hostedSignIn
            ? "Sign-in is managed by the USMA Skeet & Trap Cognito user pool."
            : "Forgot password? Contact an account administrator."}
        </button>
        <small className="signin-footnote">
          Password-only access is enabled for V1. All changes are
          actor-attributed.
        </small>
      </div>
    </div>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState(
    initialAuthState.authenticated,
  );
  const [authChecking, setAuthChecking] = useState(initialAuthState.checking);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [currentUserLoading, setCurrentUserLoading] = useState(true);
  const [page, setPage] = useState("inventory");
  const [selectedGun, setSelectedGun] = useState<Gun | null>(null);
  const [inventoryRefresh, setInventoryRefresh] = useState(0);
  const [audit, setAudit] = useState<AuditSummary | null>(null);
  const [showStartAudit, setShowStartAudit] = useState(false);
  const startAudit = async (name: string) => {
    const created = await client.createAudit(name);
    setAudit(await client.getAudit(created.id));
    setShowStartAudit(false);
  };
  useEffect(() => {
    if (demoMode || localDevSession) return;
    completeCognitoCallback()
      .then((valid) => setAuthenticated(valid))
      .catch(() => setAuthenticated(false))
      .finally(() => setAuthChecking(false));
  }, []);
  useEffect(() => {
    if (!authenticated) {
      setCurrentUser(null);
      setCurrentUserLoading(false);
      return;
    }
    let cancelled = false;
    setCurrentUserLoading(true);
    client.getCurrentUser()
      .then((user) => { if (!cancelled) setCurrentUser(user); })
      .catch(() => { if (!cancelled) setCurrentUser(null); })
      .finally(() => { if (!cancelled) setCurrentUserLoading(false); });
    return () => { cancelled = true; };
  }, [authenticated]);
  if (authChecking)
    return (
      <div className="signin-page">
        <LoaderCircle className="spin" size={24} color="#d3a55b" />
      </div>
    );
  if (!authenticated)
    return <SignIn onSignedIn={() => setAuthenticated(true)} />;
  return (
    <Shell
      page={page}
      localDevSession={localDevSession}
      currentUser={currentUser}
      currentUserLoading={currentUserLoading}
      onPageChange={(p) => {
        setPage(p);
        if (p !== "audits") setAudit(null);
      }}
    >
      {audit ? (
        <AuditPage
          audit={audit}
          setAudit={setAudit}
          onBack={() => setAudit(null)}
        />
      ) : page === "inventory" ? (
        <Inventory onSelectGun={setSelectedGun} onStartAudit={() => setShowStartAudit(true)} refreshToken={inventoryRefresh} />
      ) : page === "archived" ? (
        <ArchivedGuns onSelectGun={setSelectedGun} refreshToken={inventoryRefresh} />
      ) : page === "audits" ? (
        <Audits onOpen={setAudit} onStart={() => setShowStartAudit(true)} />
      ) : page === "history" ? (
        <ActivityHistory onSelectGun={async (serial) => setSelectedGun(await client.getGun(serial))} />
      ) : (
        <Placeholder page={page} />
      )}
      {selectedGun && (
        <GunDrawer
          gun={selectedGun}
          onClose={() => setSelectedGun(null)}
          onGunUpdated={(updated) => {
            setSelectedGun(updated);
            setInventoryRefresh((value) => value + 1);
          }}
        />
      )}
      {showStartAudit && <StartAuditModal onClose={() => setShowStartAudit(false)} onSave={startAudit} />}
    </Shell>
  );
}

function ActivityHistory({ onSelectGun }: { onSelectGun: (serial: string) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("");
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setEvents(await client.listActivity({ query: query.trim() || undefined, action: action || undefined }));
    } catch (caught) {
      setEvents([]);
      setError(caught instanceof Error ? caught.message : "Unable to load activity history");
    } finally {
      setLoading(false);
    }
  }, [query, action]);
  useEffect(() => { void load(); }, [load]);

  const actionOptions = useMemo(() => {
    const options = new Map<string, string>();
    events.forEach((event) => { if (event.actionCode) options.set(event.actionCode, event.action); });
    return [...options.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [events]);
  const openGun = async (serial: string) => {
    setOpening(serial);
    try { await onSelectGun(serial); }
    catch (caught) { setError(caught instanceof Error ? caught.message : `Unable to open ${serial}`); }
    finally { setOpening(""); }
  };

  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">AUDIT TRAIL</p>
          <h1>Activity history</h1>
          <p className="subheading">A permanent record of inventory changes and the operator who made them.</p>
        </div>
      </div>
      <div className="table-toolbar">
        <div className="search-wrap">
          <Search size={17} />
          <input aria-label="Search activity" placeholder="Search serial, model, action, or reason" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <label className="history-filter">Action
          <select aria-label="Filter activity by action" value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="">All actions</option>
            {actionOptions.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
      </div>
      {error && <div className="scan-message error" role="alert">{error}<button type="button" onClick={() => { void load(); }}>Try again</button></div>}
      <div className="section-heading"><div><h2>All activity</h2><span className="muted">{loading ? "Loading…" : `${events.length} event${events.length === 1 ? "" : "s"}`}</span></div></div>
      <div className="table-card activity-history-card">
        {loading ? <div className="empty-state"><LoaderCircle className="spin" size={17} /> Loading activity history…</div> : events.length === 0 ? <div className="empty-state"><History size={17} /> No activity matches the current filters.</div> : (
              <div className="timeline activity-timeline">
            {events.map((event, index) => (
              <div className="timeline-item activity-item" key={`${event.relatedSerial || "activity"}-${event.id}-${index}`}>
                <div className={`timeline-marker ${event.tone || ""}`}><Check size={13} /></div>
                <div className="activity-item-content">
                  <div className="activity-item-heading"><strong>{event.action}</strong>{event.relatedSerial && <button className="serial-link" disabled={opening === event.relatedSerial} onClick={() => { void openGun(event.relatedSerial!); }}>{opening === event.relatedSerial ? "Opening…" : event.relatedSerial}</button>}</div>
                  <p>{event.detail}</p>
                  <small>{event.actor} · {event.timestamp}</small>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Placeholder({ page }: { page: string }) {
  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1>{page[0].toUpperCase() + page.slice(1)}</h1>
          <p className="subheading">
            This workspace is ready for the next inventory workflow.
          </p>
        </div>
      </div>
      <div className="empty-panel">
        <div className="empty-panel-icon">
          <Settings2 size={22} />
        </div>
            <h2>Not in V1</h2>
            <p>
          This section is not available in V1. Use Inventory and Audits for the
          live workflows currently connected to the actor-attributed API.
        </p>
      </div>
    </div>
  );
}

export default App;
