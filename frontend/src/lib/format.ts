export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return new Intl.NumberFormat("fr-FR").format(Math.round(n));
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

const REGIME_FALLBACK_COLOR = "#8AA0A6";

export function typeBlocLabel(code: string): string {
  return code.replace("POSTE", "").replace(/_/g, " ");
}

export function regimeOf(typeBloc: string): "DP" | "AB" {
  return typeBloc.endsWith("_AB") ? "AB" : "DP";
}

export function safeColor(c: string | null | undefined): string {
  return c || REGIME_FALLBACK_COLOR;
}

/** Couleur ILD selon l'état (valeurs DB ou legacy). */
export function ildColor(etat: string | null | undefined): string {
  const s = (etat || "").toUpperCase();
  if (s === "EN_SERVICE" || s === "FONCTIONNEL") return "#22c55e";
  if (s === "HORS_SERVICE" || s === "EN_PANNE") return "#ef4444";
  return "#f59e0b";
}

/** Label ILD lisible. */
export function ildLabel(etat: string | null | undefined): string {
  const s = (etat || "").toUpperCase();
  if (s === "EN_SERVICE" || s === "FONCTIONNEL") return "🟢 Fonctionnel";
  if (s === "HORS_SERVICE" || s === "EN_PANNE") return "🔴 En panne";
  return "🟠 À contrôler";
}
