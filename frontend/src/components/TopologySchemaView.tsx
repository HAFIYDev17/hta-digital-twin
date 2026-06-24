import { useMemo, useRef, useState } from "react";
import type { DepartCumul, Poste, TopologieNode } from "../lib/types";

type ToolMode = "pan" | "select";

interface Props {
  topologie: TopologieNode[];
  postes: Poste[];
  departs: DepartCumul[];
  posteSourceLabel: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (poste: Poste) => void;
}

export function TopologySchemaView({
  topologie,
  postes,
  departs,
  posteSourceLabel,
  selectedId,
  onSelect,
  onEdit,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [tool, setTool] = useState<ToolMode>("pan");
  const [tf, setTf] = useState({ x: 0, y: 0, s: 1 });

  const posteById = useMemo(
    () => new Map(postes.map((p) => [p.id, p])),
    [postes],
  );

  const selectedPoste = selectedId ? (posteById.get(selectedId) ?? null) : null;

  return (
    <div ref={wrapRef}>
      <h3>{posteSourceLabel}</h3>
      <div>Mode: {tool}</div>
      <div>Zoom: {Math.round(tf.s * 100)}%</div>
      <div>Topologie: {topologie.length} nœuds</div>
      <div>Postes: {posteById.size}</div>
      <div>Départs: {departs.length}</div>

      <button onClick={() => setTool("pan")}>Pan</button>
      <button onClick={() => setTool("select")}>Select</button>
      <button
        onClick={() => setTf((t) => ({ ...t, s: Math.min(2, t.s * 1.1) }))}
      >
        Zoom +
      </button>
      <button
        onClick={() => setTf((t) => ({ ...t, s: Math.max(0.5, t.s * 0.9) }))}
      >
        Zoom -
      </button>
      <button onClick={() => onSelect(null)}>Clear</button>

      {selectedId && <div>Sélection: {selectedId}</div>}

      {selectedPoste && (
        <button onClick={() => onEdit(selectedPoste)}>
          Modifier le poste sélectionné
        </button>
      )}
    </div>
  );
}
