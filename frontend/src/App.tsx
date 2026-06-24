import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./lib/api";
import type { PosteSourceKpi } from "./lib/types";
import { fmtNum } from "./lib/format";
import { PosteSourcePage } from "./pages/PosteSourcePage";

interface Toast {
  id: number;
  msg: string;
  kind: "ok" | "warn" | "err";
}

export default function App() {
  const [sources, setSources] = useState<PosteSourceKpi[]>([]);
  const [active, setActive] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback(
    (msg: string, kind: "ok" | "warn" | "err" = "ok") => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, msg, kind }]);
      window.setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, 3200);
    },
    [],
  );

  useEffect(() => {
    let alive = true;

    async function loadSources() {
      setLoading(true);
      try {
        const s = await api.postesSource();
        if (!alive) return;

        const rows = Array.isArray(s) ? s : [];
        setSources(rows);

        if (rows.length === 0) {
          setActive("");
          toast("Aucun poste source retourné par l’API", "warn");
          return;
        }

        setActive((prev) =>
          prev && rows.some((x) => x.poste_source === prev)
            ? prev
            : rows[0].poste_source,
        );
      } catch (e) {
        if (!alive) return;
        setSources([]);
        setActive("");
        toast(`API inaccessible : ${(e as Error).message}`, "err");
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadSources();

    return () => {
      alive = false;
    };
  }, [toast]);

  const activeKpi = useMemo(
    () => sources.find((s) => s.poste_source === active),
    [sources, active],
  );

  const totals = useMemo(
    () =>
      sources.reduce(
        (acc, s) => ({
          puissance_kva: acc.puissance_kva + (s.puissance_kva || 0),
          nb_postes: acc.nb_postes + (s.nb_postes || 0),
          nb_clients: acc.nb_clients + (s.nb_clients || 0),
        }),
        { puissance_kva: 0, nb_postes: 0, nb_clients: 0 },
      ),
    [sources],
  );

  return (
    <div className="app-shell">
      <div className="toast-zone no-print">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>

      <header className="topbar no-print">
        <div className="brand">
          <span className="bolt">⚡</span>
          <span>HTA Digital Twin</span>
          <small>Mayotte · 20 kV</small>
        </div>

        <div className="source-tabs">
          {sources.map((s) => {
            const isActive = active === s.poste_source;
            return (
              <button
                key={s.poste_source}
                className={`source-tab ${isActive ? "active" : ""}`}
                onClick={() => setActive(s.poste_source)}
              >
                <span className="src-name">
                  {s.nom.replace("Poste Source ", "")}
                </span>
                <span className="src-stats">
                  <span className="n">{s.nb_postes}p</span>
                  <span className="kva">{fmtNum(s.puissance_kva)} kVA</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="topbar-spacer" />

        <div
          className="network-total"
          title="Cumul des postes source, indépendamment de l'onglet actif"
        >
          <span className="label">Réseau Mayotte</span>
          <span className="stat">
            <span className="v">{fmtNum(totals.puissance_kva)}</span> kVA
          </span>
          <span className="sep" />
          <span className="stat">
            <span className="v">{totals.nb_postes}</span> postes
          </span>
          <span className="sep" />
          <span className="stat">
            <span className="v">{fmtNum(totals.nb_clients)}</span> clients
          </span>
        </div>

        <button
          className="topbar-action"
          onClick={() =>
            window.open("/docs/ANOMALIES_DECOUVERTES.md", "_blank")
          }
        >
          Anomalies connues
        </button>
      </header>

      <main className="app-main">
        {loading ? (
          <div style={{ padding: 24 }}>Chargement des postes source…</div>
        ) : sources.length === 0 ? (
          <div style={{ padding: 24 }}>Aucun poste source chargé.</div>
        ) : !activeKpi ? (
          <div style={{ padding: 24 }}>Poste source actif introuvable.</div>
        ) : (
          <PosteSourcePage posteSource={active} kpi={activeKpi} toast={toast} />
        )}
      </main>
    </div>
  );
}
