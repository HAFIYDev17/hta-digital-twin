// src/pages/PosteSourcePage.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { expandAntennaFamily } from "../lib/types";
import type {
  Anomalie,
  DepartCumul,
  DepartDrift,
  JonctionCandidate,
  Poste,
  PosteSourceKpi,
  TopologieNode,
} from "../lib/types";
import { fmtNum, safeColor } from "../lib/format";
import { SchemaView } from "../components/SchemaView";
import { TableView } from "../components/TableView";
import { PosteModal } from "../components/PosteModal";
import { AnomaliesPanel } from "../components/AnomaliesPanel";
import { ImportExportPanel } from "../components/ImportExportPanel";
import { DriftPanel } from "../components/DriftPanel";
import { MapView } from "../components/MapView";

type Tab = "schema" | "tableau" | "anomalies" | "derive" | "import" | "carte";

type RM6Item = {
  id: string;
  depart: string | null;
  x: number;
  y?: number;
  nom: string | null;
  label_detecte: string | null;
  commande: string | null;
  a_verifier?: boolean;
  etat?: string | null;
};

type PointOuverture = {
  id: string;
  x: number;
  y: number;
  etat: string;
};

type SchemaTopoNode = {
  poste_id: string;
  depart: string;
  parent_poste_id: string | null;
  ordre_principal: number | null;
  niveau_branche: number;
  rang_branche: number | null;
  nature_lien: string;
  extremite_reseau: boolean;
  bout_bouclage: boolean;
};

interface Props {
  posteSource: string;
  kpi: PosteSourceKpi | undefined;
  toast: (msg: string, kind?: "ok" | "warn" | "err") => void;
}

export function PosteSourcePage({ posteSource, kpi, toast }: Props) {
  const [tab, setTab] = useState<Tab>("schema");

  const [postes, setPostes] = useState<Poste[]>([]);
  const [topologie, setTopologie] = useState<TopologieNode[]>([]);
  const [departs, setDeparts] = useState<DepartCumul[]>([]);
  const [drift, setDrift] = useState<DepartDrift[]>([]);
  const [anomalies, setAnomalies] = useState<Anomalie[]>([]);
  const [jonctions, setJonctions] = useState<JonctionCandidate[]>([]);
  const [rm6, setRm6] = useState<RM6Item[]>([]);
  const [pointsOuverture, setPointsOuverture] = useState<PointOuverture[]>([]);

  const [fDep, setFDep] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [modalPoste, setModalPoste] = useState<Partial<Poste> | null>(null);

  const reload = useCallback(async () => {
    // Chaque appel est protégé individuellement — un échec n'empêche pas les autres
    const safe = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
      p.catch((e) => {
        console.warn("API partiel:", e.message);
        return fallback;
      });

    const [p, topo, d, dr, a, j, r, pts] = await Promise.all([
      safe(api.postes({ poste_source: posteSource }), []),
      safe(api.topologie({ poste_source: posteSource }), []),
      safe(api.departs(posteSource), []),
      safe(api.departsDrift(posteSource), []),
      safe(api.anomalies(posteSource), []),
      safe(api.jonctions(), []),
      safe(api.rm6(posteSource), []),
      safe(api.pointsOuverture(posteSource), []),
    ]);

    // Dedup postes (un LEFT JOIN ILD peut générer des doublons)
    const rawP = Array.isArray(p) ? p : [];
    const seenIds = new Set<string>();
    setPostes(
      rawP.filter((x: any) => {
        if (seenIds.has(x.id)) return false;
        seenIds.add(x.id);
        return true;
      }),
    );
    setTopologie(Array.isArray(topo) ? topo : []);
    setDeparts(Array.isArray(d) ? d : []);
    setDrift(Array.isArray(dr) ? dr : []);
    setAnomalies(Array.isArray(a) ? a : []);
    setJonctions(
      Array.isArray(j)
        ? j.filter((x) => x.postes_source?.includes(posteSource))
        : [],
    );
    setRm6(Array.isArray(r) ? r : []);
    setPointsOuverture(Array.isArray(pts) ? pts : []);
  }, [posteSource]);

  useEffect(() => {
    reload().catch((e: Error) => {
      toast(`Erreur de chargement : ${e.message}`, "err");
    });
  }, [reload, toast]);

  const filteredPostes = useMemo(() => {
    let rows = postes;
    const filterActive = Boolean(fDep || search.trim());

    if (fDep) {
      rows = rows.filter((p) => p.depart === fDep);
    }

    if (search.trim()) {
      const s = search.trim().toLowerCase();
      rows = rows.filter(
        (p) =>
          (p.nom || "").toLowerCase().includes(s) ||
          (p.numero || "").toLowerCase().includes(s),
      );
    }

    if (!filterActive) {
      return rows;
    }

    const ids = expandAntennaFamily(new Set(rows.map((p) => p.id)), postes);
    return postes.filter((p) => ids.has(p.id));
  }, [postes, fDep, search]);

  const filteredTopologie = useMemo(() => {
    let rows = topologie;

    if (fDep) {
      rows = rows.filter((x) => x.depart === fDep);
    }

    if (search.trim()) {
      const s = search.trim().toLowerCase();
      rows = rows.filter(
        (x) =>
          (x.nom || "").toLowerCase().includes(s) ||
          (x.numero || "").toLowerCase().includes(s) ||
          (x.depart_libelle || "").toLowerCase().includes(s),
      );
    }

    return rows;
  }, [topologie, fDep, search]);

  const topologieForSchema = useMemo<SchemaTopoNode[]>(() => {
    return filteredTopologie.map((x) => ({
      poste_id: x.poste_id,
      depart: x.depart || "",
      parent_poste_id: x.parent_poste_id ?? null,
      ordre_principal: x.ordre_principal ?? null,
      niveau_branche: x.niveau_branche ?? 0,
      rang_branche: x.rang_branche ?? null,
      nature_lien: x.nature_lien || "TRONC",
      extremite_reseau: Boolean(x.extremite_reseau),
      bout_bouclage: Boolean(x.bout_bouclage),
    }));
  }, [filteredTopologie]);

  const filteredRm6 = useMemo(() => {
    let rows = rm6;

    if (fDep) {
      rows = rows.filter((r) => r.depart === fDep);
    }

    if (search.trim()) {
      const s = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.nom || "").toLowerCase().includes(s) ||
          (r.label_detecte || "").toLowerCase().includes(s) ||
          (r.commande || "").toLowerCase().includes(s),
      );
    }

    return rows;
  }, [rm6, fDep, search]);

  const anomalyIds = useMemo(() => {
    return new Set(anomalies.map((a) => a.poste_id));
  }, [anomalies]);

  async function handleSave(payload: Partial<Poste>) {
    try {
      if (payload.id) {
        await api.updatePoste(payload.id, {
          ...payload,
          poste_source: posteSource,
        });
        toast("Poste mis à jour", "ok");
      } else {
        await api.createPoste({
          ...payload,
          poste_source: posteSource,
        });
        toast("Poste ajouté", "ok");
      }

      setModalPoste(null);
      await reload();
    } catch (e) {
      toast(`Erreur : ${(e as Error).message}`, "err");
    }
  }

  async function handleUpdateRm6(id: string, data: Record<string, unknown>) {
    try {
      await api.updateRm6(id, data);
      toast("RM6 mis à jour", "ok");
      await reload();
    } catch (e) {
      toast(`Erreur RM6 : ${(e as Error).message}`, "err");
    }
  }

  async function handleReorder(items: { id: string; x: number }[]) {
    try {
      await api.reorderPostes(items);
      toast("Ordre mis à jour", "ok");
      await reload();
    } catch (e) {
      toast(`Erreur réagencement : ${(e as Error).message}`, "err");
    }
  }

  async function handleDelete(poste: Poste) {
    if (!confirm(`Supprimer le poste "${poste.nom || poste.numero}" ?`)) {
      return;
    }

    try {
      await api.deletePoste(poste.id);
      toast("Poste supprimé", "warn");
      await reload();
    } catch (e) {
      toast(`Erreur suppression : ${(e as Error).message}`, "err");
    }
  }

  async function handleImport(rows: Partial<Poste>[]) {
    try {
      for (const row of rows) {
        await api.createPoste({
          ...row,
          poste_source: posteSource,
        });
      }

      toast("Import terminé", "ok");
      await reload();
    } catch (e) {
      toast(`Erreur import : ${(e as Error).message}`, "err");
    }
  }

  function fixAnomaly(posteId: string) {
    const poste = postes.find((x) => x.id === posteId);
    if (poste) {
      setModalPoste(poste);
    }
  }

  console.log("modalPoste", modalPoste);

  return (
    <>
      <div className="kpi-bar">
        <div className="kpi-cell">
          <div className="label">Puissance installée</div>
          <div className="value">
            {fmtNum(kpi?.puissance_kva)} <span className="unit">kVA</span>
          </div>
        </div>

        <div className="kpi-cell">
          <div className="label">Postes</div>
          <div className="value">{kpi?.nb_postes ?? "-"}</div>
        </div>

        <div className="kpi-cell">
          <div className="label">DP / AB</div>
          <div className="value">
            {kpi?.nb_dp ?? "-"}{" "}
            <span className="unit">/ {kpi?.nb_ab ?? "-"}</span>
          </div>
        </div>

        <div className="kpi-cell">
          <div className="label">Clients</div>
          <div className="value">{fmtNum(kpi?.nb_clients)}</div>
        </div>

        {!!anomalies.length && (
          <div className="kpi-cell warn">
            <div className="label">Anomalies</div>
            <div className="value">{anomalies.length}</div>
          </div>
        )}
      </div>

      <div className="filter-row">
        <div className="view-tabs">
          {(
            [
              ["schema", "Schéma"],
              ["tableau", "Tableau"],
              ["carte", "Carte"],
              ["anomalies", "Anomalies"],
              ["derive", "Dérive"],
              ["import", "Import/Export"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={`view-tab ${tab === key ? "active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {(tab === "schema" || tab === "tableau" || tab === "carte") && (
          <>
            <button
              className={`chip ${!fDep ? "active" : ""}`}
              onClick={() => setFDep(null)}
            >
              Tous
            </button>

            {departs.map((d) => (
              <button
                key={d.depart}
                className={`chip ${fDep === d.depart ? "active" : ""}`}
                onClick={() =>
                  setFDep((curr) => (curr === d.depart ? null : d.depart))
                }
              >
                <span
                  className="dot"
                  style={{ background: safeColor(d.couleur) }}
                />
                {d.libelle} <span className="n">{d.nb_postes}</span>
              </button>
            ))}

            <input
              className="search-input"
              placeholder="Rechercher un poste"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </>
        )}

        {(tab === "schema" || tab === "tableau") && (
          <button
            className="btn primary"
            onClick={() => setModalPoste({ poste_source: posteSource })}
          >
            + Poste
          </button>
        )}

        {tab === "schema" && (
          <button
            className="btn no-print"
            onClick={() => {
              const svg = document.querySelector(".schema-svg");
              if (!svg) return;

              const w = window.open("", "_blank", "width=1400,height=900");
              if (!w) return;

              w.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Impression schéma</title>
        <style>
          @page { size: A3 landscape; margin: 10mm; }
          html, body { margin: 0; padding: 0; background: #fff; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .wrap { padding: 8mm; background: #fff; }
          svg { width: 100%; height: auto; display: block; background: #fff; }
          svg text,
svg tspan {
  fill: #111111 !important;
}

svg line,
svg polyline,
svg path,
svg circle,
svg rect {
  stroke: #222222;
}

svg [fill="#edf4f8"],
svg [fill="#95a7b4"],
svg [fill="#cdd7de"] {
  fill: #111111 !important;
}
        </style>
      </head>
      <body>
        <div class="wrap">
  ${svg.outerHTML
    .replace(/#edf4f8/gi, "#111111")
    .replace(/#95a7b4/gi, "#444444")
    .replace(/#cdd7de/gi, "#666666")
    .replace(/#ffffff/gi, "#ffffff")}
</div>
      </body>
    </html>
  `);

              w.document.close();
              setTimeout(() => {
                w.focus();
                w.print();
              }, 250);
            }}
          >
            🖨 Imprimer (A3)
          </button>
        )}
      </div>

      <div className="content">
        {tab === "schema" && (
          <SchemaView
            postes={filteredPostes}
            departs={departs}
            rm6={filteredRm6}
            pointsOuverture={pointsOuverture}
            posteSourceLabel={kpi?.nom || posteSource}
            selectedId={selected}
            onSelect={setSelected}
            onEdit={setModalPoste}
            onReorder={handleReorder}
            onUpdateRm6={handleUpdateRm6}
            topologie={topologieForSchema}
          />
        )}

        {tab === "tableau" && (
          <TableView
            postes={filteredPostes}
            anomalyIds={anomalyIds}
            onEdit={setModalPoste}
            onDelete={handleDelete}
          />
        )}

        {tab === "carte" && (
          <MapView postes={filteredPostes} departs={departs} />
        )}

        {tab === "anomalies" && (
          <AnomaliesPanel
            anomalies={anomalies}
            jonctions={jonctions}
            postes={postes}
            onFix={fixAnomaly}
          />
        )}

        {tab === "derive" && <DriftPanel drift={drift} />}

        {tab === "import" && (
          <ImportExportPanel
            postes={postes}
            posteSource={posteSource}
            onImport={handleImport}
            onRestored={reload}
            toast={toast}
          />
        )}
      </div>

      {modalPoste && (
        <PosteModal
          poste={modalPoste}
          departs={departs}
          postes={postes}
          existingNumeros={postes.map((p) => p.numero || "")}
          onClose={() => setModalPoste(null)}
          onSave={handleSave}
        />
      )}
    </>
  );
}
