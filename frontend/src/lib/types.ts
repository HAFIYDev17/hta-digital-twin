export interface PosteSourceKpi {
  poste_source: string;
  nom: string;
  nb_postes: number;
  puissance_kva: number;
  nb_clients: number;
  nb_dp: number;
  nb_ab: number;
  nb_producteurs: number;
}

export interface DepartCumul {
  poste_source: string;
  depart: string;
  libelle: string;
  couleur: string;
  nb_postes: number;
  puissance_kva: number;
  nb_clients: number;
}

export interface DepartDrift extends DepartCumul {
  puissance_recalculee_kva: number;
  puissance_enregistree_kva: number | null;
  delta_kva: number | null;
  delta_pct: number | null;
}

export interface Poste {
  id: string;
  poste_source: string;
  numero: string | null;
  nom: string | null;
  type_bloc: string;
  regime: string | null;
  depart: string | null;
  depart_brut: string | null;
  depart_libelle?: string | null;
  depart_couleur?: string | null;
  puissance_txt: string | null;
  puissance_kva: number;
  nb_clients: number | null;
  autre: string | null;
  x: number;
  y: number;
  lat: number | null;
  lng: number | null;
  producteur: boolean;
  client_mhrv: boolean;
  layer_dxf: string | null;
  commentaire: string | null;
  /** Indicateur Lumineux de Défaut présent sur ce poste. */
  ild: boolean;
  /** État de l'ILD : fonctionnel (vert), en_panne (rouge), a_controler (orange). */
  /** État de l'ILD (EN_SERVICE / HORS_SERVICE / A_VERIFIER depuis la table ild). */
  ild_etat: string | null;
  /** Organe de Manœuvre Télécommandé présent sur ce poste. */
  omt: boolean;
  /** Commune d'implantation (liste des 17 communes de Mayotte). */
  commune: string | null;
  /** Si renseigné : id du poste "parent" dont celui-ci est une antenne/dérivation
   *  (poste raccordé en dérivation de la branche principale, pas en ligne). */
  antenne_de: string | null;
}

/** Les 17 communes de Mayotte. */
export const MAYOTTE_COMMUNES = [
  "Acoua",
  "Bandraboua",
  "Bandrélé",
  "Bouéni",
  "Chiconi",
  "Chirongui",
  "Dembéni",
  "Dzaoudzi",
  "Kani-Kéli",
  "Koungou",
  "Mamoudzou",
  "Mtsamboro",
  "M'Tsangamouji",
  "Ouangani",
  "Pamandzi",
  "Sada",
  "Tsingoni",
] as const;

/** Communes considérées comme zone urbaine - toutes les autres sont rurales. */
const URBAN_COMMUNES = new Set<string>(["Mamoudzou", "Pamandzi", "Dzaoudzi"]);

export function zoneOfCommune(
  commune: string | null | undefined,
): "Urbaine" | "Rurale" | null {
  if (!commune) return null;
  return URBAN_COMMUNES.has(commune) ? "Urbaine" : "Rurale";
}

/**
 * Étend un ensemble de postes "matchés" (par un filtre départ/recherche) à
 * toute leur famille de rattachement en antenne : ancêtres (le ou les postes
 * "parents" dont ils dérivent, même sur un autre départ ou sans départ
 * renseigné) et descendants (les antennes accrochées à un poste matché).
 *
 * Sans ça, filtrer par départ peut faire disparaître soit le poste parent,
 * soit son antenne, dès que leurs champs `depart` ne sont pas strictement
 * identiques - ce qui casse visuellement le rattachement alors que les
 * données elles-mêmes sont correctes.
 */
export function expandAntennaFamily(
  matchIds: Set<string>,
  all: Poste[],
): Set<string> {
  const byId = new Map(all.map((p) => [p.id, p]));
  const childrenOf = new Map<string, string[]>();
  all.forEach((p) => {
    if (p.antenne_de) {
      if (!childrenOf.has(p.antenne_de)) childrenOf.set(p.antenne_de, []);
      childrenOf.get(p.antenne_de)!.push(p.id);
    }
  });

  const out = new Set(matchIds);

  // Remonte la chaîne des parents (anti-boucle via `guard`).
  matchIds.forEach((id) => {
    let cur = byId.get(id);
    const guard = new Set<string>();
    while (
      cur?.antenne_de &&
      cur.antenne_de !== cur.id &&
      !guard.has(cur.antenne_de)
    ) {
      guard.add(cur.antenne_de);
      out.add(cur.antenne_de);
      cur = byId.get(cur.antenne_de);
    }
  });

  // Redescend vers tous les enfants (antennes accrochées), en plusieurs vagues.
  let frontier = Array.from(out);
  const visited = new Set<string>();
  while (frontier.length) {
    const next: string[] = [];
    frontier.forEach((id) => {
      if (visited.has(id)) return;
      visited.add(id);
      (childrenOf.get(id) || []).forEach((cid) => {
        if (!out.has(cid)) {
          out.add(cid);
          next.push(cid);
        }
      });
    });
    frontier = next;
  }

  return out;
}

export interface Anomalie {
  poste_id: string;
  poste_source: string;
  numero: string | null;
  nom: string | null;
  type_anomalie:
    | "depart_vide"
    | "depart_inconnu"
    | "depart_layer_mismatch"
    | "numero_vide"
    | "puissance_invalide";
  niveau: "INFO" | "WARNING" | "BLOQUANT";
}

export interface JonctionCandidate {
  numero: string;
  postes_source: string[];
  departs: string[];
  noms: string[];
  poste_ids: string[];
  nb_sources: number;
}

export const TYPE_BLOC_OPTIONS = [
  "POSTECAB_AB",
  "POSTECAB_DP",
  "POSTECBS_AB",
  "POSTECBS_DP",
  "POSTEH61_DP",
  "POSTELOCAL_AB",
  "POSTELOCAL_DP",
  "POSTEPVCR_AB",
  "POSTESOCLE_DP",
] as const;

export interface Snapshot {
  id: string;
  created_at: string;
  label: string | null;
  trigger: "manual" | "scheduled";
  poste_source: string | null;
}

export const ANOMALY_LABEL: Record<Anomalie["type_anomalie"], string> = {
  depart_vide: "Départ manquant",
  depart_inconnu: "Départ inconnu pour ce poste source",
  depart_layer_mismatch: "Départ déclaré ≠ calque du schéma d'origine",
  numero_vide: "Numéro de poste manquant",
  puissance_invalide: "Puissance illisible ou nulle",
};

export interface TopologieNode {
  poste_id: string;
  depart: string;
  depart_couleur: string | null;
  depart_libelle?: string | null;

  nom: string | null;
  numero: string | null;
  type_bloc: string;
  puissance_kva: number | null;

  parent_poste_id: string | null;
  ordre_principal: number | null;
  niveau_branche: number | null;
  rang_branche: number | null;
  nature_lien: "TRONC" | "DERIVATION" | "BOUCLAGE" | string | null;

  extremite_reseau: boolean | null;
  bout_bouclage: boolean | null;
  validation_statut: string | null;
  commentaire: string | null;
}
