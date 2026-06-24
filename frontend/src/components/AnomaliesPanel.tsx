import type { Anomalie, JonctionCandidate, Poste } from "../lib/types";
import { ANOMALY_LABEL } from "../lib/types";

interface Props {
  anomalies: Anomalie[];
  jonctions: JonctionCandidate[];
  postes: Poste[];
  onFix: (posteId: string) => void;
}

export function AnomaliesPanel({ anomalies, jonctions, postes, onFix }: Props) {
  const byId = new Map(postes.map((p) => [p.id, p]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="panel">
        <div className="panel-head">
          <span>Anomalies de données</span>
          <span className="mono muted">{anomalies.length}</span>
        </div>
        {anomalies.length === 0 ? (
          <div className="empty-good">
            ✓ Aucune anomalie détectée sur ce poste source.
          </div>
        ) : (
          anomalies.map((a, i) => (
            <div className="anom-item" key={i}>
              <span className={`lvl ${a.niveau}`} />
              <div className="txt">
                <span className="type">{ANOMALY_LABEL[a.type_anomalie]}</span>
                <strong>{a.nom || "(sans nom)"}</strong>
                {a.numero ? ` - N° ${a.numero}` : ""}
              </div>
              <button className="btn" onClick={() => onFix(a.poste_id)}>
                Corriger
              </button>
            </div>
          ))
        )}
      </div>

      {jonctions.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <span>
              Jonctions inter-postes-source probables (bouclage à confirmer)
            </span>
            <span className="mono muted">{jonctions.length}</span>
          </div>
          <div style={{ padding: 12, fontSize: 12, color: "var(--text-2)" }}>
            Même numéro de poste détecté sur 2 postes source différents. Souvent
            un vrai point de jonction/bouclage entre départs voisins - pas
            forcément une erreur. À confirmer avec le terrain avant de
            fusionner.
          </div>
          {jonctions.map((j) => (
            <div className="anom-item" key={j.numero}>
              <span className="lvl INFO" />
              <div className="txt">
                <span className="type">
                  N° {j.numero} - {j.noms[0]}
                </span>
                {j.postes_source.join(" ↔ ")} ({j.departs.join(" / ")})
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
