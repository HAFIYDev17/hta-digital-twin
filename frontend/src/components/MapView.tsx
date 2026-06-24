/**
 * Onglet CARTE - carte interactive de Mayotte avec les postes géoréférencés.
 *
 * Layers disponibles :
 *   • OpenStreetMap (défaut)
 *   • Photo aérienne (Esri World Imagery)
 *
 * Postes affichés en cercles colorés selon leur départ.
 * Clic → popup avec infos du poste.
 * Seuls les postes ayant lat ET lng renseignés sont affichés.
 */

import { useEffect, useRef } from "react";
import type { DepartCumul, Poste } from "../lib/types";
import { safeColor, ildLabel } from "../lib/format";

// On charge Leaflet en side-effect - la lib est installée via npm.
// Les types sont dans @types/leaflet.
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Correction de l'icône par défaut de Leaflet cassée par Vite.
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Centre géographique de Mayotte (entre Grande-Terre et Petite-Terre)
const MAYOTTE_CENTER: [number, number] = [-12.8275, 45.1662];
const MAYOTTE_ZOOM = 11;

interface Props {
  postes: Poste[];
  departs: DepartCumul[];
}

/** Couleur hex d'un poste (depuis son départ). */
function posteColor(p: Poste, departs: DepartCumul[]): string {
  const d = departs.find((d) => d.depart === p.depart);
  return d ? safeColor(d.couleur) : "#5b7480";
}

/** Popup HTML d'un poste. */
function popupHtml(p: Poste): string {
  const ild = !p.ild ? "Non" : ildLabel(p.ild_etat);
  return `
    <div style="font-family:system-ui,sans-serif;min-width:160px">
      <div style="font-weight:700;font-size:13px;margin-bottom:4px">${p.nom || "(sans nom)"}</div>
      <div style="font-size:11px;color:#555;margin-bottom:6px">N° ${p.numero ?? "-"} · ${p.type_bloc}</div>
      <div style="font-size:11px"><b>Départ :</b> ${p.depart ?? "-"}</div>
      <div style="font-size:11px"><b>Puissance :</b> ${p.puissance_txt || "-"}</div>
      <div style="font-size:11px"><b>Commune :</b> ${p.commune ?? "-"}</div>
      <div style="font-size:11px"><b>ILD :</b> ${ild}</div>
      ${p.antenne_de ? '<div style="font-size:11px;color:#888;margin-top:4px">↳ En antenne</div>' : ""}
    </div>
  `;
}

export function MapView({ postes, departs }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // Initialisation de la carte (une seule fois)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: MAYOTTE_CENTER,
      zoom: MAYOTTE_ZOOM,
    });

    // Couche OSM (défaut)
    const osmLayer = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
        maxZoom: 19,
      },
    );

    // Couche photo aérienne (Esri World Imagery - open, sans clé)
    const aerialLayer = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution:
          "Tiles © Esri - Source: Esri, Maxar, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN",
        maxZoom: 19,
      },
    );

    osmLayer.addTo(map);

    // Contrôle de couches (OSM / Aérien)
    L.control
      .layers(
        {
          "Plan (OpenStreetMap)": osmLayer,
          "Photo aérienne (Esri)": aerialLayer,
        },
        {},
        { position: "topright", collapsed: false },
      )
      .addTo(map);

    // Groupe de marqueurs (mis à jour à chaque changement de postes)
    const group = L.layerGroup().addTo(map);

    mapRef.current = map;
    layerGroupRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // Mise à jour des marqueurs à chaque changement de postes/departs
  useEffect(() => {
    const group = layerGroupRef.current;
    if (!group) return;

    group.clearLayers();

    const geoPostes = postes.filter((p) => p.lat != null && p.lng != null);

    geoPostes.forEach((p) => {
      const color = posteColor(p, departs);
      const isAntenne = !!p.antenne_de;

      const marker = L.circleMarker([p.lat!, p.lng!], {
        radius: 7,
        color: isAntenne ? "#888" : color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: isAntenne ? 1.5 : 2.5,
        dashArray: isAntenne ? "4 3" : undefined,
      });

      marker.bindPopup(popupHtml(p), { maxWidth: 280 });
      group.addLayer(marker);
    });
  }, [postes, departs]);

  const geoCount = postes.filter((p) => p.lat != null && p.lng != null).length;
  const totalCount = postes.length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 520,
      }}
    >
      {/* Bandeau info */}
      <div
        style={{
          padding: "8px 14px",
          fontSize: 12,
          color: "#5b7480",
          borderBottom: "1px solid rgba(0,0,0,0.07)",
          display: "flex",
          gap: 16,
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <span>
          <strong style={{ color: "#0f6b74" }}>{geoCount}</strong> /{" "}
          {totalCount} postes géolocalisés
        </span>
        {geoCount < totalCount && (
          <span style={{ color: "#d97706" }}>
            ⚠ {totalCount - geoCount} postes sans coordonnées GPS (lat/lng non
            renseignées)
          </span>
        )}
        <span style={{ marginLeft: "auto", color: "#94a3b8" }}>
          Clic sur un cercle → détail • Double-clic carte → zoom
        </span>
      </div>

      {/* Carte Leaflet */}
      <div ref={containerRef} style={{ flex: 1 }} />
    </div>
  );
}
