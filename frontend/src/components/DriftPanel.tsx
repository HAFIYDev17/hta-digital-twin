import type { DepartDrift, JonctionCandidate } from "../lib/types";
import { fmtNum, fmtPct, safeColor } from "../lib/format";

interface Props {
  drift: DepartDrift[];
  jonctions?: JonctionCandidate[];
}

export function DriftPanel({ drift, jonctions = [] }: Props) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span>Cumul recalculé vs bilan enregistré dans le DWG</span>
      </div>
      <p
        style={{
          padding: "0 13px",
          margin: "10px 0",
          fontSize: 11.5,
          color: "var(--text-2)",
        }}
      >
        Le bloc « BILAN DES PUISSANCES INSTALLEES » du plan d'origine n'est mis
        à jour qu'à la main. Un grand écart signale soit une vraie évolution du
        réseau depuis le dernier calcul, soit un bilan jamais tenu à jour pour
        ce départ.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>Départ</th>
            <th style={{ textAlign: "right" }}>Postes</th>
            <th style={{ textAlign: "right" }}>Recalculé (kVA)</th>
            <th style={{ textAlign: "right" }}>Enregistré (kVA)</th>
            <th style={{ textAlign: "right" }}>Écart</th>
          </tr>
        </thead>
        <tbody>
          {drift.map((d) => (
            <tr key={d.depart}>
              <td>
                <span className="badge">
                  <span
                    className="dot"
                    style={{ background: safeColor(d.couleur) }}
                  />
                  {d.libelle}
                </span>
              </td>
              <td className="num">{d.nb_postes}</td>
              <td className="num">{fmtNum(d.puissance_recalculee_kva)}</td>
              <td className="num">
                {d.puissance_enregistree_kva === null
                  ? "-"
                  : fmtNum(d.puissance_enregistree_kva)}
              </td>
              <td
                className="num"
                style={{
                  color:
                    d.delta_pct && Math.abs(d.delta_pct) > 20
                      ? "var(--warn-600)"
                      : undefined,
                }}
              >
                {d.delta_pct === null ? "non renseigné" : fmtPct(d.delta_pct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {jonctions.length > 0 && (
        <>
          <div className="panel-head" style={{ marginTop: 18 }}>
            <span>Numéros vus sur plusieurs postes source ({jonctions.length})</span>
            <span className="muted">Candidats jonction / bouclage inter-source à vérifier</span>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Postes source</th>
                <th>Départs</th>
                <th>Noms vus</th>
              </tr>
            </thead>
            <tbody>
              {jonctions.map((j) => (
                <tr key={j.numero}>
                  <td>{j.numero}</td>
                  <td>{j.postes_source.join(" / ")}</td>
                  <td>{j.departs.filter(Boolean).join(" / ") || "-"}</td>
                  <td>{j.noms.filter(Boolean).join(" / ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
