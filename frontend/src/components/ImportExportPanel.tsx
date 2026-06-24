import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { Poste, Snapshot } from "../lib/types";
import { api } from "../lib/api";

interface Props {
  postes: Poste[];
  posteSource: string;
  onImport: (rows: Partial<Poste>[]) => void;
  onRestored?: () => void;
  toast: (msg: string, kind?: "ok" | "warn" | "err") => void;
}

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function ImportExportPanel({
  postes,
  posteSource,
  onImport,
  onRestored,
  toast,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapLoading, setSnapLoading] = useState(false);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function loadSnapshots() {
    setSnapLoading(true);
    setSnapError(null);
    try {
      const list = await api.snapshots(posteSource);
      setSnapshots(list);
    } catch (e) {
      // L'endpoint /api/snapshots n'existe peut-être pas encore côté backend -
      // on l'indique clairement plutôt que de planter ou de rester muet.
      setSnapError(
        "Historique indisponible (le backend ne répond pas encore sur /api/snapshots).",
      );
    } finally {
      setSnapLoading(false);
    }
  }

  useEffect(() => {
    loadSnapshots();
  }, [posteSource]);

  async function createSnapshotNow() {
    setCreating(true);
    try {
      await api.createSnapshot({
        poste_source: posteSource,
        label: `Instantané manuel - ${new Date().toLocaleString("fr-FR")}`,
      });
      toast("Instantané créé");
      await loadSnapshots();
    } catch (e) {
      toast(
        `Impossible de créer l'instantané : ${(e as Error).message}`,
        "err",
      );
    } finally {
      setCreating(false);
    }
  }

  async function restore(s: Snapshot) {
    if (
      !confirm(
        `Restaurer l'état du ${fmtDateTime(s.created_at)} ? Les modifications faites depuis seront écrasées.`,
      )
    )
      return;
    try {
      await api.restoreSnapshot(s.id);
      toast("Instantané restauré");
      onRestored?.();
    } catch (e) {
      toast(`Échec de la restauration : ${(e as Error).message}`, "err");
    }
  }

  function download(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportJSON() {
    download(
      `postes_${posteSource}.json`,
      JSON.stringify(postes, null, 2),
      "application/json",
    );
    toast("Export JSON téléchargé");
  }

  function exportCSV() {
    const headers = [
      "NUMERO",
      "NOM",
      "TYPE_BLOC",
      "DEPART",
      "PUISSANCE_KVA",
      "NB_CLIENTS",
      "COMMUNE",
      "ILD",
      "OMT",
      "ANTENNE_DE",
      "X",
      "Y",
    ];
    const lines = [headers.join(";")];
    postes.forEach((p) => {
      lines.push(
        [
          p.numero,
          p.nom,
          p.type_bloc,
          p.depart,
          p.puissance_kva,
          p.nb_clients ?? "",
          p.commune ?? "",
          p.ild ? "OUI" : "NON",
          p.omt ? "OUI" : "NON",
          p.antenne_de ?? "",
          p.x,
          p.y,
        ].join(";"),
      );
    });
    download(`postes_${posteSource}.csv`, lines.join("\n"), "text/csv");
    toast("Export CSV téléchargé");
  }

  function exportXLSX() {
    const ws = XLSX.utils.json_to_sheet(
      postes.map((p) => ({
        NUMERO: p.numero,
        NOM: p.nom,
        TYPE_BLOC: p.type_bloc,
        DEPART: p.depart,
        PUISSANCE_KVA: p.puissance_kva,
        NB_CLIENTS: p.nb_clients,
        COMMUNE: p.commune,
        ILD: p.ild ? "OUI" : "NON",
        OMT: p.omt ? "OUI" : "NON",
        ANTENNE_DE: p.antenne_de,
        X: p.x,
        Y: p.y,
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Postes");
    XLSX.writeFile(wb, `postes_${posteSource}.xlsx`);
    toast("Export XLSX téléchargé");
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target!.result, { type: "binary" });
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
          wb.Sheets[wb.SheetNames[0]],
        );
        const imported: Partial<Poste>[] = rows
          .map((r) => ({
            poste_source: posteSource,
            numero: String(r.NUMERO ?? r.numero ?? ""),
            nom: String(r.NOM ?? r.nom ?? ""),
            type_bloc: String(r.TYPE_BLOC ?? r.type_bloc ?? "POSTECAB_DP"),
            depart: String(r.DEPART ?? r.depart ?? "")
              .toUpperCase()
              .replace(/\s/g, ""),
            puissance_txt: String(r.PUISSANCE_KVA ?? r.puissance_kva ?? ""),
            autre: String(r.AUTRE ?? r.autre ?? ""),
            commune:
              r.COMMUNE || r.commune ? String(r.COMMUNE ?? r.commune) : null,
            x: Number(r.X ?? r.x ?? 0),
            y: Number(r.Y ?? r.y ?? 0),
          }))
          .filter((p) => p.numero);
        onImport(imported);
        toast(`${imported.length} poste(s) importé(s)`);
      } catch (err) {
        toast(`Erreur d'import : ${(err as Error).message}`, "err");
      }
    };
    reader.readAsBinaryString(f);
    e.target.value = "";
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span>Import / Export</span>
      </div>
      <div
        style={{
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
            Exporter ce poste source
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn" onClick={exportXLSX}>
              ↓ XLSX
            </button>
            <button className="btn" onClick={exportCSV}>
              ↓ CSV
            </button>
            <button className="btn" onClick={exportJSON}>
              ↓ JSON
            </button>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
            Importer un fichier XLSX/CSV
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
            Colonnes attendues : NUMERO, NOM, TYPE_BLOC, DEPART, PUISSANCE_KVA,
            NB_CLIENTS, COMMUNE, X, Y (cf. modele_import_postes_sada.xlsx). Les
            postes seront ajoutés à <strong>{posteSource}</strong>.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFile}
            style={{ display: "none" }}
          />
          <button
            className="btn primary"
            onClick={() => fileRef.current?.click()}
          >
            Choisir un fichier
          </button>
        </div>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
            Historique &amp; sauvegarde
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
            Un instantané enregistre l'état complet de ce poste source à un
            instant donné, pour pouvoir revenir en arrière en cas de problème.
            Un instantané automatique est aussi prévu chaque trimestre (tâche
            planifiée côté serveur) pour garder une photo régulière du réseau
            HTA.
          </p>
          <button
            className="btn"
            onClick={createSnapshotNow}
            disabled={creating}
          >
            {creating ? "Création…" : "📷 Créer un instantané maintenant"}
          </button>

          <div style={{ marginTop: 10 }}>
            {snapLoading && (
              <div className="muted" style={{ fontSize: 11.5 }}>
                Chargement de l'historique…
              </div>
            )}
            {snapError && (
              <div className="field-hint" style={{ marginTop: 0 }}>
                {snapError}
              </div>
            )}
            {!snapLoading && !snapError && snapshots.length === 0 && (
              <div className="muted" style={{ fontSize: 11.5 }}>
                Aucun instantané pour ce poste source pour l'instant.
              </div>
            )}
            {!snapLoading && snapshots.length > 0 && (
              <div className="side-list">
                {snapshots.map((s) => (
                  <div
                    key={s.id}
                    className="side-item"
                    style={{ cursor: "default" }}
                  >
                    <span>
                      {fmtDateTime(s.created_at)}
                      {s.trigger === "scheduled"
                        ? " · trimestriel"
                        : " · manuel"}
                    </span>
                    <button
                      className="btn"
                      style={{ padding: "4px 9px", fontSize: 11 }}
                      onClick={() => restore(s)}
                    >
                      Restaurer
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
