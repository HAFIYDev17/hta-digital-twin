import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DepartCumul, Poste } from "../lib/types";
import {
  fmtNum,
  ildLabel,
  regimeOf,
  safeColor,
  typeBlocLabel,
} from "../lib/format";
import { zoneOfCommune } from "../lib/types";

/* ================================================================
   Types
   ================================================================ */

interface RM6 {
  id: string;
  depart: string | null;
  x: number;
  y?: number;
  nom: string | null;
  label_detecte: string | null;
  commande: string | null;
  a_verifier?: boolean;
  etat?: string | null;
}

interface TopoNode {
  poste_id: string;
  depart: string;
  parent_poste_id: string | null;
  ordre_principal: number | null;
  niveau_branche: number;
  rang_branche: number | null;
  nature_lien: string;
  extremite_reseau: boolean;
  bout_bouclage: boolean;
}

interface Props {
  postes: Poste[];
  departs: DepartCumul[];
  rm6: RM6[];
  pointsOuverture: { id: string; x: number; y: number; etat: string }[];
  posteSourceLabel: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (poste: Poste) => void;
  onReorder?: (items: { id: string; x: number }[]) => void;
  onUpdateRm6?: (id: string, data: Record<string, unknown>) => void;
  topologie?: TopoNode[];
}

type ToolMode = "pan" | "select";

type LayoutNode = {
  id: string;
  kind: "poste" | "rm6";
  depart: string | null;
  x: number;
  y: number;
  label: string;
  sublabel: string;
  meta: string;
  color: string;
  isAntenna: boolean;
  isBouclage: boolean;
  parentId: string | null;
  parentX: number | null;
  parentY: number | null;
  data: Poste | RM6;
};

/* ================================================================
   Constants
   ================================================================ */

const BUS_X = 190;
const START_X = 360;
const X_STEP = 140; // min gap between trunk nodes
const BRANCH_STEP = 118; // horizontal step for branches
const BRANCH_DROP = 56; // vertical drop per fork level
const BASE_LANE_Y = 120;
const NODE_R = 16;

function truncate(value: string | null | undefined, max = 14) {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function isPoste(node: LayoutNode): node is LayoutNode & { data: Poste } {
  return node.kind === "poste";
}

/* ================================================================
   Detail sub-component
   ================================================================ */

function DetailCell({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: "#7f93a3",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2 }}>
        {value ?? "—"}
      </div>
    </div>
  );
}

/* ================================================================
   Tree Layout Engine
   ================================================================ */

function buildTreeLayout(
  postes: Poste[],
  departs: DepartCumul[],
  rm6: RM6[],
  topologie: TopoNode[] | undefined,
): { nodes: LayoutNode[]; laneYs: Map<string, number> } {
  const posteById = new Map(postes.map((p) => [p.id, p]));
  const out: LayoutNode[] = [];
  const laneYs = new Map<string, number>();

  /* Helper: create a poste LayoutNode */
  const makePosteNode = (
    poste: Poste,
    dep: string | null,
    x: number,
    y: number,
    color: string,
    isAntenna: boolean,
    isBouclage: boolean,
    parentId: string | null,
    parentX: number | null,
    parentY: number | null,
  ): LayoutNode => ({
    id: poste.id,
    kind: "poste",
    depart: dep,
    x,
    y,
    label: truncate(poste.nom || poste.numero || poste.id, 16),
    sublabel: poste.numero || "",
    meta: poste.puissance_kva
      ? `${fmtNum(poste.puissance_kva)} kVA`
      : typeBlocLabel(poste.type_bloc),
    color,
    isAntenna,
    isBouclage,
    parentId,
    parentX,
    parentY,
    data: poste,
  });

  if (topologie && topologie.length > 0) {
    /* ── TOPOLOGY-DRIVEN LAYOUT ── */

    // Group topology nodes by depart
    const topoByDepart = new Map<string, TopoNode[]>();
    topologie.forEach((t) => {
      if (!topoByDepart.has(t.depart)) topoByDepart.set(t.depart, []);
      topoByDepart.get(t.depart)!.push(t);
    });

    /* Pass 1: compute dynamic lane Y positions
       Each lane height = max fork rows × BRANCH_DROP + padding */
    let currentLaneY = BASE_LANE_Y;

    for (const [dep, topoNodes] of topoByDepart) {
      laneYs.set(dep, currentLaneY);

      // Build children map
      const childrenMap = new Map<string, TopoNode[]>();
      topoNodes
        .filter((t) => t.parent_poste_id !== null)
        .forEach((b) => {
          if (!b.parent_poste_id) return;
          if (!childrenMap.has(b.parent_poste_id))
            childrenMap.set(b.parent_poste_id, []);
          childrenMap.get(b.parent_poste_id)!.push(b);
        });

      // Recursively count the deepest vertical stack in this subtree
      const maxForkRows = (nodeId: string): number => {
        const ch = childrenMap.get(nodeId) || [];
        if (ch.length === 0) return 0;
        if (ch.length === 1) return maxForkRows(ch[0].poste_id); // chain → same row
        // Fork → child i sits at row (i+1), plus its own sub-depth
        return Math.max(...ch.map((c, i) => i + 1 + maxForkRows(c.poste_id)));
      };

      const trunkNodes = topoNodes.filter((t) => t.parent_poste_id === null);
      const maxRows = trunkNodes.reduce(
        (m, t) => Math.max(m, maxForkRows(t.poste_id)),
        0,
      );

      // laneHeight = space consumed below the trunk line
      const laneHeight = Math.max(200, maxRows * BRANCH_DROP + 110);
      currentLaneY += laneHeight;
    }

    /* Pass 2: place nodes */
    for (const [dep, topoNodes] of topoByDepart) {
      const depInfo = departs.find((d) => d.depart === dep);
      const color = safeColor(depInfo?.couleur);
      const baseY = laneYs.get(dep)!;

      const trunkNodes = topoNodes
        .filter(
          (t) =>
            t.parent_poste_id === null &&
            (t.nature_lien === "TRONC" ||
              t.nature_lien === "BOUCLAGE" ||
              !t.nature_lien),
        )
        .sort(
          (a, b) => (a.ordre_principal ?? 999) - (b.ordre_principal ?? 999),
        );

      const branchNodes = topoNodes.filter((t) => t.parent_poste_id !== null);

      const childrenByParentId = new Map<string, TopoNode[]>();
      branchNodes.forEach((b) => {
        if (!b.parent_poste_id) return;
        if (!childrenByParentId.has(b.parent_poste_id))
          childrenByParentId.set(b.parent_poste_id, []);
        childrenByParentId.get(b.parent_poste_id)!.push(b);
      });

      /* Branch x-reach: minimum horizontal space consumed by a subtree.
         Chain (1 child): adds BRANCH_STEP + child reach.
         Fork (N children): all at same X → only 1 BRANCH_STEP + max sub-reach. */
      const xReachCache = new Map<string, number>();
      const branchXReach = (nodeId: string): number => {
        if (xReachCache.has(nodeId)) return xReachCache.get(nodeId)!;
        const ch = childrenByParentId.get(nodeId) || [];
        let reach = 0;
        if (ch.length === 1) {
          reach = BRANCH_STEP + branchXReach(ch[0].poste_id);
        } else if (ch.length > 1) {
          reach =
            BRANCH_STEP + Math.max(...ch.map((c) => branchXReach(c.poste_id)));
        }
        xReachCache.set(nodeId, reach);
        return reach;
      };

      const placedPositions = new Map<string, { x: number; y: number }>();
      let trunkX = START_X;

      /* Place trunk nodes, spacing them wide enough to fit their branch trees */
      trunkNodes.forEach((t) => {
        const poste = posteById.get(t.poste_id);
        if (!poste) return;
        placedPositions.set(t.poste_id, { x: trunkX, y: baseY });
        out.push(
          makePosteNode(
            poste,
            dep,
            trunkX,
            baseY,
            color,
            false,
            t.bout_bouclage,
            null,
            null,
            null,
          ),
        );
        const reach = branchXReach(t.poste_id);
        trunkX += Math.max(X_STEP, reach + 28);
      });

      /* Place branch nodes with strict rules:
         • Chain (1 child) → same Y, advance X
         • Fork  (N > 1)   → all at parentX + BRANCH_STEP,
                              stacked: child i at parentY + (i+1)×BRANCH_DROP  */
      const placeBranch = (parentId: string) => {
        const children = (childrenByParentId.get(parentId) || [])
          .slice()
          .sort((a, b) => (a.rang_branche ?? 999) - (b.rang_branche ?? 999));
        const parentPos = placedPositions.get(parentId);
        if (!parentPos || children.length === 0) return;

        if (children.length === 1) {
          /* ── CHAIN: go right, same Y ── */
          const child = children[0];
          const poste = posteById.get(child.poste_id);
          if (!poste) return;
          const cx = parentPos.x + BRANCH_STEP;
          const cy = parentPos.y;
          placedPositions.set(child.poste_id, { x: cx, y: cy });
          out.push(
            makePosteNode(
              poste,
              dep,
              cx,
              cy,
              color,
              true,
              child.bout_bouclage,
              parentId,
              parentPos.x,
              parentPos.y,
            ),
          );
          placeBranch(child.poste_id);
        } else {
          /* ── FORK: vertical stack, strict L ── */
          children.forEach((child, i) => {
            const poste = posteById.get(child.poste_id);
            if (!poste) return;
            const cx = parentPos.x + BRANCH_STEP;
            const cy = parentPos.y + (i + 1) * BRANCH_DROP;
            placedPositions.set(child.poste_id, { x: cx, y: cy });
            out.push(
              makePosteNode(
                poste,
                dep,
                cx,
                cy,
                color,
                true,
                child.bout_bouclage,
                parentId,
                parentPos.x,
                parentPos.y,
              ),
            );
            placeBranch(child.poste_id);
          });
        }
      };

      trunkNodes.forEach((t) => placeBranch(t.poste_id));

      /* Late-bound branches (parent placed after child in source data) */
      branchNodes.forEach((b) => {
        if (
          !placedPositions.has(b.poste_id) &&
          b.parent_poste_id &&
          placedPositions.has(b.parent_poste_id)
        ) {
          const poste = posteById.get(b.poste_id);
          if (!poste) return;
          const parentPos = placedPositions.get(b.parent_poste_id)!;
          const cx = parentPos.x + BRANCH_STEP;
          const cy = parentPos.y + BRANCH_DROP;
          placedPositions.set(b.poste_id, { x: cx, y: cy });
          out.push(
            makePosteNode(
              poste,
              dep,
              cx,
              cy,
              color,
              true,
              b.bout_bouclage,
              b.parent_poste_id,
              parentPos.x,
              parentPos.y,
            ),
          );
        }
      });

      /* RM6 for this depart: after all topology nodes */
      const maxNodeX = Math.max(
        START_X,
        ...Array.from(placedPositions.values()).map((p) => p.x),
      );
      rm6
        .filter((r) => r.depart === dep)
        .sort((a, b) => (a.x || 0) - (b.x || 0))
        .forEach((item, idx) => {
          out.push({
            id: item.id,
            kind: "rm6",
            depart: dep,
            x: maxNodeX + (idx + 1) * X_STEP,
            y: baseY - 28,
            label: truncate(item.nom || item.label_detecte || "RM6", 16),
            sublabel: item.commande || "RM6",
            meta: item.etat || "organe",
            color,
            isAntenna: false,
            isBouclage: false,
            parentId: null,
            parentX: null,
            parentY: null,
            data: item,
          });
        });
    }

    /* Orphan postes (have a depart, but not in topology) */
    const topoPosteIds = new Set(topologie.map((t) => t.poste_id));
    const orphans = postes.filter((p) => !topoPosteIds.has(p.id) && p.depart);
    if (orphans.length > 0) {
      const byDepart = new Map<string, Poste[]>();
      orphans.forEach((p) => {
        if (!p.depart) return;
        if (!byDepart.has(p.depart)) byDepart.set(p.depart, []);
        byDepart.get(p.depart)!.push(p);
      });
      for (const [dep, orphanPostes] of byDepart) {
        const depInfo = departs.find((d) => d.depart === dep);
        const color = safeColor(depInfo?.couleur);
        const baseY = laneYs.get(dep) ?? BASE_LANE_Y;
        const existingMaxX = Math.max(
          START_X,
          ...out.filter((n) => n.depart === dep).map((n) => n.x),
        );
        orphanPostes
          .sort((a, b) => (a.x || 0) - (b.x || 0))
          .forEach((poste, idx) => {
            out.push(
              makePosteNode(
                poste,
                dep,
                existingMaxX + (idx + 1) * X_STEP,
                baseY,
                safeColor((color || "#2bb3c0") + "80"),
                false,
                false,
                null,
                null,
                null,
              ),
            );
          });
      }
    }
  } else {
    /* ── FALLBACK: antenne_de-based layout ── */
    departs.forEach((d, i) => laneYs.set(d.depart, BASE_LANE_Y + i * 220));

    const childrenByParent = new Map<string, Poste[]>();
    postes.forEach((p) => {
      if (!p.antenne_de || p.antenne_de === p.id) return;
      if (!postes.some((x) => x.id === p.antenne_de)) return;
      if (!childrenByParent.has(p.antenne_de))
        childrenByParent.set(p.antenne_de, []);
      childrenByParent.get(p.antenne_de)!.push(p);
    });

    const rootPostes = postes.filter(
      (p) =>
        !p.antenne_de ||
        p.antenne_de === p.id ||
        !postes.some((x) => x.id === p.antenne_de),
    );

    const perDepartCounter = new Map<string, number>();

    const pushPosteTree = (
      poste: Poste,
      depth = 0,
      parentX?: number,
      parentY?: number,
      forcedDepart?: string | null,
    ) => {
      const dep = forcedDepart ?? poste.depart ?? null;
      const laneY = laneYs.get(dep || "") ?? BASE_LANE_Y;
      const count = perDepartCounter.get(dep || "__none") ?? 0;
      const x =
        typeof parentX === "number"
          ? parentX + X_STEP * 0.85
          : START_X + count * X_STEP;
      const y = laneY + depth * BRANCH_DROP;

      if (typeof parentX !== "number")
        perDepartCounter.set(dep || "__none", count + 1);

      out.push(
        makePosteNode(
          poste,
          dep,
          x,
          y,
          safeColor(
            departs.find((d) => d.depart === dep)?.couleur ||
              poste.depart_couleur ||
              "#2bb3c0",
          ),
          depth > 0,
          false,
          null,
          depth > 0 ? (parentX ?? null) : null,
          depth > 0 ? (parentY ?? null) : null,
        ),
      );

      [...(childrenByParent.get(poste.id) || [])]
        .sort((a, b) => (a.x || 0) - (b.x || 0))
        .forEach((child, idx) => {
          pushPosteTree(
            child,
            depth + 1,
            x + (idx + 1) * (X_STEP * 0.55),
            y,
            dep,
          );
        });
    };

    departs.forEach((d) => {
      rootPostes
        .filter((p) => p.depart === d.depart)
        .sort((a, b) => (a.x || 0) - (b.x || 0))
        .forEach((p) => pushPosteTree(p, 0, undefined, undefined, d.depart));

      rm6
        .filter((r) => r.depart === d.depart)
        .sort((a, b) => (a.x || 0) - (b.x || 0))
        .forEach((item) => {
          const index = perDepartCounter.get(d.depart || "__none") ?? 0;
          out.push({
            id: item.id,
            kind: "rm6",
            depart: d.depart,
            x: START_X + index * X_STEP,
            y: (laneYs.get(d.depart) ?? BASE_LANE_Y) - 28,
            label: truncate(item.nom || item.label_detecte || "RM6", 16),
            sublabel: item.commande || "RM6",
            meta: item.etat || "organe",
            color: safeColor(d.couleur),
            isAntenna: false,
            isBouclage: false,
            parentId: null,
            parentX: null,
            parentY: null,
            data: item,
          });
          perDepartCounter.set(d.depart || "__none", index + 1);
        });
    });
  }

  /* Dedup by id */
  const seen = new Set<string>();
  const deduped = out.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });

  return {
    nodes: deduped.sort((a, b) => a.y - b.y || a.x - b.x),
    laneYs,
  };
}

/* ================================================================
   Component
   ================================================================ */

export function SchemaView({
  postes,
  departs,
  rm6,
  pointsOuverture,
  posteSourceLabel,
  selectedId,
  onSelect,
  onEdit,
  onReorder,
  onUpdateRm6,
  topologie,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const [tool, setTool] = useState<ToolMode>("pan");

  /* Transform via ref — zero re-renders during pan/zoom */
  const tRef = useRef({ x: 0, y: 0, s: 1 });
  const rafRef = useRef(0);
  const applyT = () => {
    const g = gRef.current;
    if (!g) return;
    const { x, y, s } = tRef.current;
    g.setAttribute("transform", `translate(${x} ${y}) scale(${s})`);
  };

  const dragStart = useRef<{
    x: number;
    y: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);

  const { nodes, laneYs } = useMemo(
    () => buildTreeLayout(postes, departs, rm6, topologie),
    [postes, departs, rm6, topologie],
  );

  const bounds = useMemo(() => {
    const maxX = Math.max(1320, ...nodes.map((n) => n.x + 200));
    const maxY = Math.max(420, ...nodes.map((n) => n.y + 160));
    return { width: maxX, height: maxY };
  }, [nodes]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) || null,
    [nodes, selectedId],
  );

  /* Lane Y positions from layout engine → guaranteed consistent */
  const departureLines = useMemo(
    () =>
      departs.map((d) => ({ ...d, y: laneYs.get(d.depart) ?? BASE_LANE_Y })),
    [departs, laneYs],
  );

  const fitAll = useCallback(() => {
    const host = wrapRef.current;
    if (!host) return;
    const pad = 80;
    const sx = (host.clientWidth - pad) / bounds.width;
    const sy = (host.clientHeight - pad) / bounds.height;
    tRef.current = {
      x: 26,
      y: 22,
      s: Math.max(0.3, Math.min(1.2, Math.min(sx, sy))),
    };
    applyT();
  }, [bounds.width, bounds.height]);

  useEffect(() => {
    fitAll();
  }, [fitAll, posteSourceLabel]);

  /* Keyboard shortcuts */
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if (k === "h") setTool("pan");
      if (k === "s") setTool("select");
      if (k === "f") fitAll();
      if (e.key === "0") {
        tRef.current = { x: 0, y: 0, s: 1 };
        applyT();
      }
      if (e.key === "Escape") onSelect(null);
      // E → edit selected node
      if (k === "e" && selectedNode && isPoste(selectedNode)) {
        onEdit(selectedNode.data);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [fitAll, onSelect, selectedNode, onEdit]);

  /* Wheel zoom — no setState */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fn = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const t = tRef.current;
      const ns = Math.max(
        0.2,
        Math.min(2.5, t.s * (e.deltaY > 0 ? 0.92 : 1.08)),
      );
      const wx = (mx - t.x) / t.s;
      const wy = (my - t.y) / t.s;
      tRef.current = { s: ns, x: mx - wx * ns, y: my - wy * ns };
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(applyT);
    };
    el.addEventListener("wheel", fn, { passive: false });
    return () => el.removeEventListener("wheel", fn);
  }, []);

  /* IMPRESSION */

  useEffect(() => {
    const before = () => {
      fitAll();
    };

    const after = () => {
      fitAll();
    };

    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);

    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [fitAll]);

  /* Pan — native listeners, ref-only, rAF.
     KEY FIX: skip pointer capture if clicking on a schema-node.
     This ensures onClick / onDoubleClick on SVG nodes always fire. */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const down = (e: PointerEvent) => {
      if (tool !== "pan") return;
      // Let clicks on interactive nodes pass through unmolested
      if ((e.target as Element).closest?.(".schema-node")) return;
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        ox: tRef.current.x,
        oy: tRef.current.y,
        moved: false,
      };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
    };
    const move = (e: PointerEvent) => {
      const d = dragStart.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      // Only start moving after 3px threshold (avoids accidental micro-pans)
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      tRef.current.x = d.ox + dx;
      tRef.current.y = d.oy + dy;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(applyT);
    };
    const up = () => {
      dragStart.current = null;
      if (tool === "pan") el.style.cursor = "grab";
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointerleave", up);
    };
  }, [tool]);

  const hasTopology = Boolean(topologie && topologie.length > 0);

  return (
    <div
      ref={wrapRef}
      className="schema-stage"
      style={{ cursor: tool === "pan" ? "grab" : "default" }}
    >
      {/* ── Floating toolbar ── */}
      <div className="schema-floating-tools no-print">
        <button
          className={`schema-tool ${tool === "pan" ? "active" : ""}`}
          onClick={() => setTool("pan")}
          title="Déplacer [H]"
        >
          ✋
        </button>
        <button
          className={`schema-tool ${tool === "select" ? "active" : ""}`}
          onClick={() => setTool("select")}
          title="Sélectionner [S]"
        >
          ↗
        </button>
        <button
          className="schema-tool"
          onClick={() => {
            tRef.current.s = Math.min(2.5, tRef.current.s * 1.15);
            applyT();
          }}
          title="Zoom +"
        >
          +
        </button>
        <button
          className="schema-tool"
          onClick={() => {
            tRef.current.s = Math.max(0.2, tRef.current.s * 0.87);
            applyT();
          }}
          title="Zoom −"
        >
          −
        </button>
        <button className="schema-tool" onClick={fitAll} title="Ajuster [F]">
          F
        </button>
        {hasTopology && <div className="schema-tool-badge">SCADA</div>}
      </div>

      {/* ── Keyboard hint strip ── */}
      <div className="schema-kbd-hint no-print">
        <span>
          <kbd>H</kbd> pan
        </span>
        <span>
          <kbd>S</kbd> sélect
        </span>
        <span>
          <kbd>F</kbd> fit
        </span>
        <span>
          <kbd>E</kbd> modif
        </span>
        <span>
          <kbd>⎋</kbd> désélecter
        </span>
        <span className="schema-kbd-dbl">2× clic → modifier</span>
      </div>

      {/* ── SVG canvas ── */}
      <svg
        className="schema-svg dark"
        viewBox={`0 0 ${bounds.width} ${bounds.height}`}
      >
        <defs>
          <pattern
            id="grid-v4"
            width="32"
            height="32"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 32 0 L 0 0 0 32"
              fill="none"
              stroke="rgba(255,255,255,0.03)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <g ref={gRef}>
          {/* Background grid */}
          <rect
            x={0}
            y={0}
            width={bounds.width}
            height={bounds.height}
            fill="url(#grid-v4)"
          />

          {/* Source label */}
          <text
            x={BUS_X - 42}
            y={48}
            fill="#e6edf2"
            fontSize={18}
            fontWeight={800}
          >
            {posteSourceLabel}
          </text>
          <text x={BUS_X - 42} y={68} fill="#8294a1" fontSize={11}>
            {hasTopology ? "Topologie SCADA" : "Lecture exploitation"}
          </text>

          {/* Vertical bus bar */}
          <line
            x1={BUS_X}
            y1={88}
            x2={BUS_X}
            y2={bounds.height - 36}
            stroke="#7d8f98"
            strokeWidth={2.4}
          />

          {/* ── Depart lanes ── */}
          {departureLines.map((d) => (
            <g key={`lane-${d.depart}`}>
              {/* Horizontal lane line */}
              <line
                x1={BUS_X}
                y1={d.y}
                x2={bounds.width - 60}
                y2={d.y}
                stroke={safeColor(d.couleur)}
                strokeWidth={2}
                opacity={0.65}
              />
              {/* Depart label badge */}
              <rect
                x={18}
                y={d.y - 17}
                width={146}
                height={34}
                rx={8}
                fill="#0b1317"
                stroke={safeColor(d.couleur)}
                strokeWidth={1.2}
              />
              <rect
                x={18}
                y={d.y - 17}
                width={8}
                height={34}
                rx={4}
                fill={safeColor(d.couleur)}
              />
              <text
                x={34}
                y={d.y - 2}
                fill="#ecf3f8"
                fontSize={12}
                fontWeight={700}
              >
                {truncate(d.libelle || d.depart, 18)}
              </text>
              <text x={34} y={d.y + 12} fill="#7f93a3" fontSize={10}>
                {fmtNum(d.puissance_kva)} kVA · {d.nb_postes}p
              </text>
            </g>
          ))}

          {/* ── Branch connectors — strict L-shape ──
               Vertical drop first, then horizontal run to node.
               For chains (parentY == childY) only the horizontal line shows. */}
          {nodes
            .filter(
              (n) => n.isAntenna && n.parentX != null && n.parentY != null,
            )
            .map((n, i) => {
              const sameY = n.y === n.parentY!;
              return (
                <g key={`br-${n.id}-${i}`} opacity={0.52}>
                  {/* Vertical segment (only when child is below parent) */}
                  {!sameY && (
                    <line
                      x1={n.parentX!}
                      y1={n.parentY!}
                      x2={n.parentX!}
                      y2={n.y}
                      stroke="#617580"
                      strokeWidth={1.2}
                      strokeDasharray="4 5"
                    />
                  )}
                  {/* Horizontal run to node */}
                  <line
                    x1={n.parentX!}
                    y1={n.y}
                    x2={n.x - NODE_R - 4}
                    y2={n.y}
                    stroke="#617580"
                    strokeWidth={1.2}
                    strokeDasharray="4 5"
                  />
                </g>
              );
            })}

          {/* ── Bouclage ring ── */}
          {nodes
            .filter((n) => n.isBouclage)
            .map((n) => (
              <circle
                key={`bl-${n.id}`}
                cx={n.x}
                cy={n.y}
                r={NODE_R + 5}
                fill="none"
                stroke="#f7cb61"
                strokeWidth={1.4}
                strokeDasharray="3 3"
              />
            ))}

          {/* ── Nodes ──
               • onClick   → select only
               • onDoubleClick → select + open edit modal  (THE KEY FIX) */}
          {nodes.map((node) => {
            const sel = selectedId === node.id;
            const c = sel ? "#62d7ff" : node.color;
            const f =
              node.kind === "poste" &&
              regimeOf((node.data as Poste).type_bloc) === "AB"
                ? node.color
                : "#fff";
            const isCircle =
              node.kind === "poste" &&
              (((node.data as Poste).type_bloc || "").startsWith("POSTEH61") ||
                ((node.data as Poste).type_bloc || "").startsWith("POSTEPVCR"));

            return (
              <g
                key={node.id}
                className="schema-node"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(node.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onSelect(node.id);
                  if (isPoste(node)) onEdit(node.data);
                }}
                style={{ cursor: "pointer" }}
              >
                {/* Node shape */}
                {node.kind === "poste" ? (
                  isCircle ? (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={NODE_R}
                      fill={f}
                      stroke={c}
                      strokeWidth={sel ? 3 : 1.6}
                    />
                  ) : (
                    <rect
                      x={node.x - NODE_R}
                      y={node.y - NODE_R}
                      width={NODE_R * 2}
                      height={NODE_R * 2}
                      rx={4}
                      fill={f}
                      stroke={c}
                      strokeWidth={sel ? 3 : 1.6}
                    />
                  )
                ) : (
                  <rect
                    x={node.x - 14}
                    y={node.y - 12}
                    width={28}
                    height={24}
                    rx={5}
                    fill="#0d1418"
                    stroke={c}
                    strokeWidth={1.6}
                  />
                )}

                {/* OMT indicator dot */}
                {node.kind === "poste" && (node.data as Poste).omt && (
                  <circle
                    cx={node.x + NODE_R - 2}
                    cy={node.y - NODE_R + 2}
                    r={4.5}
                    fill="#0d1418"
                    stroke="#62d7ff"
                    strokeWidth={1}
                  />
                )}

                {/* Label */}
                <text
                  x={node.x + 22}
                  y={node.y - 3}
                  fill="#edf4f8"
                  fontSize={10.5}
                  fontWeight={700}
                >
                  {node.label}
                </text>
                <text
                  x={node.x + 22}
                  y={node.y + 9}
                  fill="#95a7b4"
                  fontSize={9.5}
                >
                  {node.sublabel}
                </text>
              </g>
            );
          })}

          {/* Points d'ouverture */}
          {pointsOuverture.map((p) => (
            <circle
              key={`po-${p.id}`}
              cx={p.x}
              cy={p.y}
              r={4}
              fill={p.etat === "OUVERT" ? "#f7cb61" : "#4ed59a"}
            />
          ))}
        </g>
      </svg>

      {/* ── Detail panel ── */}
      {selectedNode && (
        <div className="schema-detail-dark no-print">
          <div className="schema-detail-head">
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong
                style={{
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {selectedNode.label}
              </strong>
              <div style={{ color: "#90a4b4", marginTop: 4, fontSize: 11.5 }}>
                {selectedNode.sublabel}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 6,
                alignItems: "flex-start",
                flexShrink: 0,
              }}
            >
              {isPoste(selectedNode) && (
                <button
                  className="btn primary"
                  onClick={() => onEdit(selectedNode.data)}
                >
                  Modifier
                </button>
              )}
              <button
                className="schema-close-btn"
                onClick={() => onSelect(null)}
                title="Fermer [Échap]"
              >
                ×
              </button>
            </div>
          </div>

          {isPoste(selectedNode) && (
            <div className="schema-detail-grid">
              <DetailCell
                label="Type"
                value={typeBlocLabel(selectedNode.data.type_bloc)}
              />
              <DetailCell
                label="Régime"
                value={regimeOf(selectedNode.data.type_bloc)}
              />
              <DetailCell
                label="Puissance"
                value={
                  selectedNode.data.puissance_kva
                    ? `${fmtNum(selectedNode.data.puissance_kva)} kVA`
                    : "—"
                }
              />
              <DetailCell
                label="Départ"
                value={selectedNode.data.depart || "—"}
              />
              <DetailCell
                label="ILD"
                value={
                  selectedNode.data.ild
                    ? ildLabel(selectedNode.data.ild_etat)
                    : "Non"
                }
              />
              <DetailCell
                label="OMT"
                value={selectedNode.data.omt ? "Oui" : "Non"}
              />
              <DetailCell
                label="Commune"
                value={selectedNode.data.commune || "—"}
              />
              <DetailCell
                label="Zone"
                value={zoneOfCommune(selectedNode.data.commune || "") || "—"}
              />
            </div>
          )}

          <div className="schema-detail-hint">
            double-clic sur le nœud · ou <kbd>E</kbd> pour modifier
          </div>
        </div>
      )}
    </div>
  );
}
