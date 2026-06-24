import { useMemo, useState } from "react";
import type { Poste } from "../lib/types";
import { fmtNum, safeColor, typeBlocLabel } from "../lib/format";

interface Props {
  postes: Poste[];
  anomalyIds: Set<string>;
  onEdit: (p: Poste) => void;
  onDelete: (p: Poste) => void;
}

type SortKey = "numero" | "nom" | "depart" | "puissance_kva" | "nb_clients";

export function TableView({ postes, anomalyIds, onEdit, onDelete }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "depart",
    dir: 1,
  });

  const rows = useMemo(() => {
    const arr = postes.slice();
    arr.sort((a, b) => {
      let va: string | number = a[sort.key] ?? "";
      let vb: string | number = b[sort.key] ?? "";
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      if (va < vb) return -1 * sort.dir;
      if (va > vb) return 1 * sort.dir;
      return 0;
    });
    return arr;
  }, [postes, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 },
    );
  }

  function arrow(key: SortKey) {
    return sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "";
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span>
          {rows.length} poste{rows.length > 1 ? "s" : ""}
        </span>
      </div>
      <div style={{ maxHeight: "calc(100vh - 280px)", overflow: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th onClick={() => toggleSort("numero")}>N°{arrow("numero")}</th>
              <th onClick={() => toggleSort("nom")}>Nom{arrow("nom")}</th>
              <th>Type</th>
              <th onClick={() => toggleSort("depart")}>
                Départ{arrow("depart")}
              </th>
              <th
                onClick={() => toggleSort("puissance_kva")}
                style={{ textAlign: "right" }}
              >
                kVA{arrow("puissance_kva")}
              </th>
              <th
                onClick={() => toggleSort("nb_clients")}
                style={{ textAlign: "right" }}
              >
                Cl.{arrow("nb_clients")}
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.id}
                className={anomalyIds.has(p.id) ? "anomaly" : ""}
                onClick={() => onEdit(p)}
              >
                <td className="mono">{p.numero || "—"}</td>
                <td>{p.nom || <span className="muted">(sans nom)</span>}</td>
                <td className="muted" style={{ fontSize: 11 }}>
                  {typeBlocLabel(p.type_bloc)}
                </td>
                <td>
                  {p.depart ? (
                    <span className="badge">
                      <span
                        className="dot"
                        style={{ background: safeColor(p.depart_couleur) }}
                      />
                      {p.depart_libelle || p.depart}
                    </span>
                  ) : (
                    <span className="badge unknown">
                      {p.depart_brut || "non renseigné"}
                    </span>
                  )}
                </td>
                <td className="num">
                  {fmtNum(p.puissance_kva)}
                  <span
                    className="muted"
                    style={{ fontSize: 10, marginLeft: 3 }}
                  >
                    kVA
                  </span>
                </td>
                <td className="num">{p.nb_clients ?? "—"}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      className="icon-btn"
                      title="Modifier"
                      onClick={() => onEdit(p)}
                    >
                      ✎
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Supprimer"
                      onClick={() => onDelete(p)}
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
