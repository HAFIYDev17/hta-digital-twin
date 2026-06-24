import type { DepartCumul, Anomalie } from "../lib/types";
import { fmtNum, safeColor } from "../lib/format";

interface Props {
  departs: DepartCumul[];
  anomalies: Anomalie[];
  onSelectDepart: (dep: string) => void;
}

export function DepartOverview({ departs, anomalies, onSelectDepart }: Props) {
  // Compteur d'anomalies par départ (via les postes)
  const anomByDep = new Map<string, number>();
  anomalies.forEach((a) => {
    // On utilise le depart du poste associé si disponible
    const dep = (a as any).depart;
    if (dep) anomByDep.set(dep, (anomByDep.get(dep) || 0) + 1);
  });

  const totalKva = departs.reduce((s, d) => s + (d.puissance_kva || 0), 0);
  const totalPostes = departs.reduce((s, d) => s + (d.nb_postes || 0), 0);
  const totalClients = departs.reduce((s, d) => s + (d.nb_clients || 0), 0);

  return (
    <div className="depart-overview">
      {/* Résumé global */}
      <div className="depart-summary">
        <div className="summary-stat">
          <span className="summary-value">{fmtNum(totalKva)}</span>
          <span className="summary-label">kVA installés</span>
        </div>
        <div className="summary-stat">
          <span className="summary-value">{totalPostes}</span>
          <span className="summary-label">postes</span>
        </div>
        <div className="summary-stat">
          <span className="summary-value">{fmtNum(totalClients)}</span>
          <span className="summary-label">clients</span>
        </div>
        <div className="summary-stat">
          <span className="summary-value">{departs.length}</span>
          <span className="summary-label">départs</span>
        </div>
        <div className="summary-stat warn">
          <span className="summary-value">{anomalies.length}</span>
          <span className="summary-label">anomalies</span>
        </div>
      </div>

      {/* Grille des départs */}
      <div className="depart-grid">
        {departs.map((d) => {
          const color = safeColor(d.couleur);
          const anom = anomByDep.get(d.depart) || 0;
          const pct = totalKva > 0 ? Math.round((d.puissance_kva / totalKva) * 100) : 0;

          return (
            <button
              key={d.depart}
              className="depart-card"
              style={{ borderTopColor: color }}
              onClick={() => onSelectDepart(d.depart)}
            >
              <div className="dc-header">
                <span className="dc-dot" style={{ background: color }} />
                <span className="dc-name">{d.libelle}</span>
                {anom > 0 && <span className="dc-badge">{anom} ⚠</span>}
              </div>

              <div className="dc-kpis">
                <div className="dc-kpi">
                  <span className="dc-kpi-val">{fmtNum(d.puissance_kva)}</span>
                  <span className="dc-kpi-unit">kVA</span>
                </div>
                <div className="dc-kpi">
                  <span className="dc-kpi-val">{d.nb_postes}</span>
                  <span className="dc-kpi-unit">postes</span>
                </div>
                <div className="dc-kpi">
                  <span className="dc-kpi-val">{fmtNum(d.nb_clients)}</span>
                  <span className="dc-kpi-unit">clients</span>
                </div>
              </div>

              {/* Barre de charge relative */}
              <div className="dc-bar-wrap">
                <div className="dc-bar" style={{ width: `${pct}%`, background: color }} />
              </div>
              <div className="dc-pct">{pct}% de la puissance totale</div>

              <div className="dc-action">→ Voir le schéma</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
