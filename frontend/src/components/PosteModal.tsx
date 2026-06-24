import { useEffect, useMemo, useState } from "react";
import type { DepartCumul, Poste } from "../lib/types";
// Poste type used for ild_etat narrowing - imported above
import {
  MAYOTTE_COMMUNES,
  TYPE_BLOC_OPTIONS,
  zoneOfCommune,
} from "../lib/types";

interface Props {
  poste: Partial<Poste> | null;
  departs: DepartCumul[];
  postes: Poste[];
  existingNumeros: string[];
  onClose: () => void;
  onSave: (payload: Partial<Poste>) => void;
}

type Slot = { key: string; label: string; x: number };

function posteLabel(p: Poste) {
  return p.nom || p.numero || "poste sans nom";
}

/** Écart "naturel" entre deux postes consécutifs sur ce départ, pour situer
 *  un nouveau poste avant le premier ou après le dernier de façon cohérente
 *  avec l'échelle des coordonnées déjà utilisées. */
function estimateGap(laneOrder: Poste[], allPostes: Poste[]) {
  if (laneOrder.length >= 2) {
    const deltas: number[] = [];
    for (let i = 0; i < laneOrder.length - 1; i++) {
      deltas.push(Math.abs(laneOrder[i + 1].x - laneOrder[i].x));
    }
    deltas.sort((a, b) => a - b);
    const mid = deltas[Math.floor(deltas.length / 2)];
    if (mid > 0) return mid;
  }
  const xs = allPostes.map((p) => p.x);
  if (xs.length >= 2) {
    const span = Math.max(...xs) - Math.min(...xs);
    if (span > 0) return span / Math.max(allPostes.length, 1);
  }
  return 10;
}

function buildSlots(laneOrder: Poste[], allPostes: Poste[]): Slot[] {
  if (laneOrder.length === 0) {
    return [{ key: "only", label: "Seul poste sur ce départ", x: 0 }];
  }
  const gap = estimateGap(laneOrder, allPostes);
  const slots: Slot[] = [];
  slots.push({
    key: "before-0",
    label: `Avant « ${posteLabel(laneOrder[0])} »`,
    x: laneOrder[0].x - gap,
  });
  for (let i = 0; i < laneOrder.length - 1; i++) {
    const a = laneOrder[i];
    const b = laneOrder[i + 1];
    slots.push({
      key: `between-${i}`,
      label: `Entre « ${posteLabel(a)} » et « ${posteLabel(b)} »`,
      x: (a.x + b.x) / 2,
    });
  }
  const last = laneOrder[laneOrder.length - 1];
  slots.push({
    key: "after-last",
    label: `Après « ${posteLabel(last)} »`,
    x: last.x + gap,
  });
  return slots;
}

/** Retrouve, pour un x existant, dans quel "créneau" il tombe déjà - utile
 *  pour pré-sélectionner le bon choix quand on modifie un poste existant. */
function findEnclosingSlotKey(x: number | undefined, laneOrder: Poste[]) {
  if (laneOrder.length === 0) return "only";
  if (x === undefined) return "after-last";
  if (x <= laneOrder[0].x) return "before-0";
  if (x >= laneOrder[laneOrder.length - 1].x) return "after-last";
  for (let i = 0; i < laneOrder.length - 1; i++) {
    if (x >= laneOrder[i].x && x <= laneOrder[i + 1].x) return `between-${i}`;
  }
  return "after-last";
}

/** Tous les postes qui dépendent (directement ou via une chaîne d'antennes) de `rootId`.
 *  Sert à empêcher de créer une boucle en choisissant un parent d'antenne. */
function collectDescendants(rootId: string, all: Poste[]): Set<string> {
  const children = new Map<string, string[]>();
  all.forEach((p) => {
    if (p.antenne_de) {
      if (!children.has(p.antenne_de)) children.set(p.antenne_de, []);
      children.get(p.antenne_de)!.push(p.id);
    }
  });
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    (children.get(id) || []).forEach((cid) => {
      if (!out.has(cid)) {
        out.add(cid);
        stack.push(cid);
      }
    });
  }
  return out;
}

const DEFAULT_NEW_POSTE: Partial<Poste> = {
  type_bloc: TYPE_BLOC_OPTIONS[0],
  ild: false,
  omt: false,
  commune: null,
  antenne_de: null,
};

export function PosteModal({
  poste,
  departs,
  postes,
  existingNumeros,
  onClose,
  onSave,
}: Props) {
  const isNew = !poste?.id;
  const [form, setForm] = useState<Partial<Poste>>(
    poste ? { ...DEFAULT_NEW_POSTE, ...poste } : DEFAULT_NEW_POSTE,
  );
  const [slotKey, setSlotKey] = useState<string>("");
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    const next = poste ? { ...DEFAULT_NEW_POSTE, ...poste } : DEFAULT_NEW_POSTE;
    setForm(next);
    setAdvanced(false);
  }, [poste]);

  // Postes déjà présents sur le départ sélectionné (hors poste en cours d'édition), triés dans l'ordre du schéma.
  const laneOrder = useMemo(() => {
    if (!form.depart) return [];
    return postes
      .filter((p) => p.depart === form.depart && p.id !== form.id)
      .slice()
      .sort((a, b) => a.x - b.x);
  }, [postes, form.depart, form.id]);

  const slots = useMemo(
    () => buildSlots(laneOrder, postes),
    [laneOrder, postes],
  );

  // Postes qui ne peuvent pas être choisis comme parent d'antenne : soi-même,
  // et tout poste qui dépend déjà (même indirectement) de celui-ci - sinon on
  // créerait une boucle.
  const antennaForbidden = useMemo(() => {
    if (!form.id) return new Set<string>();
    return collectDescendants(form.id, postes);
  }, [postes, form.id]);

  const antennaOptions = useMemo(
    () =>
      postes
        .filter((p) => p.id !== form.id && !antennaForbidden.has(p.id))
        .slice()
        .sort((a, b) => posteLabel(a).localeCompare(posteLabel(b))),
    [postes, form.id, antennaForbidden],
  );

  // Quand le départ change (ou à l'ouverture), on choisit un créneau par défaut cohérent
  // et on calcule le X correspondant - sans que l'utilisateur ait à saisir de coordonnée.
  useEffect(() => {
    if (!form.depart) {
      setSlotKey("");
      return;
    }
    const key = findEnclosingSlotKey(isNew ? undefined : form.x, laneOrder);
    setSlotKey(key);
    const slot = slots.find((s) => s.key === key);
    if (slot) setForm((f) => ({ ...f, x: slot.x }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.depart]);

  if (!poste) return null;

  const dupNumero =
    !!form.numero &&
    existingNumeros.filter((n) => n === form.numero).length > (isNew ? 0 : 1);

  function set<K extends keyof Poste>(key: K, value: Poste[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function applySlot(key: string) {
    setSlotKey(key);
    const slot = slots.find((s) => s.key === key);
    if (slot) set("x", slot.x);
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal">
        <div className="modal-head">
          <h3>{isNew ? "Ajouter un poste" : "Modifier le poste"}</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="field-row">
            <div className="field">
              <label>Numéro</label>
              <input
                value={form.numero || ""}
                onChange={(e) => set("numero", e.target.value)}
              />
              {dupNumero && (
                <div className="field-hint">
                  Déjà utilisé par un autre poste de ce poste source.
                </div>
              )}
            </div>
            <div className="field">
              <label>Type de bloc</label>
              <select
                value={form.type_bloc}
                onChange={(e) =>
                  set("type_bloc", e.target.value as Poste["type_bloc"])
                }
              >
                {TYPE_BLOC_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Nom</label>
            <input
              value={form.nom || ""}
              onChange={(e) => set("nom", e.target.value)}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Commune</label>
              <select
                value={form.commune || ""}
                onChange={(e) => set("commune", e.target.value || null)}
              >
                <option value="">- sélectionner -</option>
                {MAYOTTE_COMMUNES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Zone</label>
              <input value={zoneOfCommune(form.commune) || "-"} disabled />
              <div className="field-hint">
                Urbaine seulement pour Mamoudzou, Pamandzi et Dzaoudzi - toutes
                les autres communes comptent en zone rurale.
              </div>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Départ</label>
              <select
                value={form.depart || ""}
                onChange={(e) => set("depart", e.target.value)}
              >
                <option value="">- sélectionner -</option>
                {departs.map((d) => (
                  <option key={d.depart} value={d.depart}>
                    {d.libelle}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Puissance</label>
              <input
                placeholder="ex: 630 kVA"
                value={form.puissance_txt || ""}
                onChange={(e) => set("puissance_txt", e.target.value)}
              />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>☀ ILD (indicateur lumineux de défaut)</label>
              <select
                value={form.ild ? form.ild_etat || "A_VERIFIER" : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) {
                    set("ild", false);
                    set("ild_etat", null);
                  } else {
                    set("ild", true);
                    set("ild_etat", v as Poste["ild_etat"]);
                  }
                }}
              >
                <option value="">- Absent -</option>
                <option value="EN_SERVICE">🟢 Fonctionnel</option>
                <option value="HORS_SERVICE">🔴 En panne</option>
                <option value="A_VERIFIER">🟠 À contrôler</option>
              </select>
            </div>
            <div className="field field-checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={!!form.omt}
                  onChange={(e) => set("omt", e.target.checked)}
                />
                T OMT (organe de manœuvre télécommandé)
              </label>
            </div>
          </div>

          <div className="field">
            <label>
              Poste en antenne de (dérivation de la branche principale)
            </label>
            <select
              value={form.antenne_de || ""}
              onChange={(e) => set("antenne_de", e.target.value || null)}
            >
              <option value="">
                - poste en ligne sur le départ (cas normal) -
              </option>
              {antennaOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {posteLabel(p)} {p.depart ? `(${p.depart})` : ""}
                </option>
              ))}
            </select>
            <div className="field-hint">
              {form.antenne_de
                ? "Ce poste sera dessiné en dérivation de son parent, hors de la ligne principale du départ."
                : "Laisser vide pour un poste classique, positionné en série sur la ligne du départ."}
            </div>
          </div>

          {!form.antenne_de && (
            <div className="field">
              <label>Position sur le départ</label>
              <select
                value={slotKey}
                disabled={!form.depart}
                onChange={(e) => applySlot(e.target.value)}
              >
                {!form.depart && (
                  <option value="">- choisir d'abord un départ -</option>
                )}
                {slots.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <div className="field-hint">
                La position sur le schéma se déduit automatiquement de ce choix.
              </div>
            </div>
          )}

          <div className="field">
            <label>Autre (champ libre - ex: "Nbr Client : 56")</label>
            <input
              value={form.autre || ""}
              onChange={(e) => set("autre", e.target.value)}
            />
          </div>

          <button
            type="button"
            className="icon-btn"
            style={{ width: "auto", padding: "4px 8px", fontSize: 11.5 }}
            onClick={() => setAdvanced((a) => !a)}
          >
            {advanced
              ? "▾ Masquer les coordonnées"
              : "▸ Réglage fin des coordonnées (X / Y)"}
          </button>

          {advanced && (
            <div className="field-row">
              <div className="field">
                <label>X (coordonnée plan)</label>
                <input
                  type="number"
                  value={form.x ?? 0}
                  onChange={(e) => {
                    set("x", Number(e.target.value));
                    setSlotKey("");
                  }}
                />
              </div>
              <div className="field">
                <label>Y (coordonnée plan)</label>
                <input
                  type="number"
                  value={form.y ?? 0}
                  onChange={(e) => set("y", Number(e.target.value))}
                />
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" onClick={() => onSave(form)}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
