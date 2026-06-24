-- ============================================================================
-- HTA Digital Twin - Schema Postgres (Neon)
-- Couvre les 3 postes source : SADA, LONGONI, KAWENI_BADAMIER
-- Migration 001 : structure complete (referentiels, actifs reseau, qualite de
-- donnees, historiques, propagation). Idempotent (IF NOT EXISTS partout).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- 1. REFERENTIELS
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS poste_source (
    code        VARCHAR(30) PRIMARY KEY,        -- SADA | LONGONI | KAWENI_BADAMIER
    nom         VARCHAR(120) NOT NULL,
    tension_kv  NUMERIC NOT NULL DEFAULT 20,
    commune     VARCHAR(100),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS referentiel_type_bloc (
    code     VARCHAR(50) PRIMARY KEY,           -- POSTECAB_DP, POSTEPVCR_AB, ...
    regime   VARCHAR(10) NOT NULL,              -- DP | AB
    famille  VARCHAR(50) NOT NULL               -- CAB | CBS | H61 | LOCAL | PVCR | SOCLE
);

CREATE TABLE IF NOT EXISTS referentiel_depart (
    code                 VARCHAR(50) PRIMARY KEY,
    libelle              VARCHAR(100) NOT NULL,
    couleur              VARCHAR(20)  NOT NULL,
    poste_source         VARCHAR(30)  NOT NULL REFERENCES poste_source(code),
    couleur_a_confirmer  BOOLEAN NOT NULL DEFAULT FALSE,
    actif                BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_referentiel_depart_source ON referentiel_depart(poste_source);

-- ----------------------------------------------------------------------------
-- 2. ACTIFS RESEAU
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS poste (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poste_source    VARCHAR(30) NOT NULL REFERENCES poste_source(code),

    numero          VARCHAR(50),                -- identifiant metier EDM (pas garanti unique seul, cf vue qualite)
    nom             VARCHAR(150),
    type_bloc       VARCHAR(50) REFERENCES referentiel_type_bloc(code),
    regime          VARCHAR(5),                 -- DP | AB (redondant avec type_bloc, garde pour requetes rapides)

    depart          VARCHAR(50) REFERENCES referentiel_depart(code),
    depart_brut     TEXT,                       -- valeur SOURCE telle que saisie/extraite (avant normalisation)

    puissance_txt   VARCHAR(100),                -- valeur brute ("630 kVA", "400kva"...)
    puissance_kva   NUMERIC,                     -- cache de val_like(puissance_txt), maintenu par trigger
    nb_clients      INTEGER,                      -- cache de extract_clients(autre), maintenu par trigger
    autre           TEXT,

    x               NUMERIC,                      -- coordonnees plan DXF (unite dessin, PAS du GPS)
    y               NUMERIC,
    rotation_deg    NUMERIC,
    lat             NUMERIC,                      -- GPS reel, a renseigner au releve terrain (NULL au depart)
    lng             NUMERIC,

    producteur      BOOLEAN NOT NULL DEFAULT FALSE,
    injection_kva   NUMERIC DEFAULT 0,
    client_mhrv     BOOLEAN NOT NULL DEFAULT FALSE,  -- "poste qui alimente un/des clients MHRV" (legende DWG)

    layer_dxf       VARCHAR(80),                  -- tracabilite : calque d'origine dans le DXF
    commentaire     TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_poste_source   ON poste(poste_source);
CREATE INDEX IF NOT EXISTS idx_poste_depart   ON poste(depart);
CREATE INDEX IF NOT EXISTS idx_poste_numero   ON poste(numero);
CREATE INDEX IF NOT EXISTS idx_poste_numsrc   ON poste(numero, poste_source);

CREATE TABLE IF NOT EXISTS cable (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poste_source  VARCHAR(30) NOT NULL REFERENCES poste_source(code),
    depart        VARCHAR(50) REFERENCES referentiel_depart(code),

    poste_amont   UUID REFERENCES poste(id),
    poste_aval    UUID REFERENCES poste(id),

    longueur_m    NUMERIC,
    section_mm2   INTEGER,
    nature        VARCHAR(30),                   -- aerien / souterrain isole / souterrain nu...
    courant_a     NUMERIC,
    etat          VARCHAR(20) DEFAULT 'EN_SERVICE'
);
CREATE INDEX IF NOT EXISTS idx_cable_amont ON cable(poste_amont);
CREATE INDEX IF NOT EXISTS idx_cable_aval  ON cable(poste_aval);

CREATE TABLE IF NOT EXISTS point_ouverture (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poste_source  VARCHAR(30) NOT NULL REFERENCES poste_source(code),
    poste_id      UUID REFERENCES poste(id),     -- NULL si pas encore rattache a un poste precis
    nom           VARCHAR(100),
    x             NUMERIC,
    y             NUMERIC,
    etat          VARCHAR(20) NOT NULL DEFAULT 'FERME',   -- OUVERT | FERME
    remarque      TEXT
);
CREATE INDEX IF NOT EXISTS idx_po_source ON point_ouverture(poste_source);

CREATE TABLE IF NOT EXISTS rm6 (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poste_source    VARCHAR(30) NOT NULL REFERENCES poste_source(code),
    poste_id        UUID REFERENCES poste(id),
    depart          VARCHAR(50) REFERENCES referentiel_depart(code),
    nom             VARCHAR(100),
    x               NUMERIC,
    y               NUMERIC,
    etat            VARCHAR(20) NOT NULL DEFAULT 'FERME',
    nb_cellules     INTEGER,
    commande        VARCHAR(30),                  -- MANUEL | RADIO_COMMANDE | TELECOMMANDE_RTC
    label_detecte   VARCHAR(60),                   -- texte DXF le plus proche au moment de l'extraction
    a_verifier      BOOLEAN NOT NULL DEFAULT TRUE   -- positions/labels RM6 = heuristique geometrique, a valider visuellement
);
CREATE INDEX IF NOT EXISTS idx_rm6_source ON rm6(poste_source);

CREATE TABLE IF NOT EXISTS manoeuvre (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poste_id      UUID REFERENCES poste(id),
    rm6_id        UUID REFERENCES rm6(id),
    type          VARCHAR(50),
    commande      VARCHAR(50),                    -- MANUEL | RADIO_COMMANDE | TELECOMMANDE_RTC
    etat          VARCHAR(20) NOT NULL DEFAULT 'FERME'
);

CREATE TABLE IF NOT EXISTS ild (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poste_source          VARCHAR(30) NOT NULL REFERENCES poste_source(code),
    poste_id              UUID REFERENCES poste(id),
    x                     NUMERIC,
    y                     NUMERIC,
    type                  VARCHAR(50) DEFAULT 'SOUTERRAIN',  -- SOUTERRAIN | AMPEREMETRIQUE
    etat                  VARCHAR(20) NOT NULL DEFAULT 'A_VERIFIER', -- OK | DEFAUT | A_VERIFIER | DEFAUT_SUSPECTE
    derniere_maintenance  DATE
);
CREATE INDEX IF NOT EXISTS idx_ild_source ON ild(poste_source);

CREATE TABLE IF NOT EXISTS producteur (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poste_source  VARCHAR(30) NOT NULL REFERENCES poste_source(code),
    poste_id      UUID REFERENCES poste(id),
    x             NUMERIC,
    y             NUMERIC,
    type          VARCHAR(50),                     -- PHOTOVOLTAIQUE | ...
    puissance_injection NUMERIC,
    actif         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS bouclage (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    depart_a       VARCHAR(50) REFERENCES referentiel_depart(code),
    depart_b       VARCHAR(50) REFERENCES referentiel_depart(code),
    poste_a_id     UUID REFERENCES poste(id),
    poste_b_id     UUID REFERENCES poste(id),
    point_contact  VARCHAR(100),
    actif          BOOLEAN NOT NULL DEFAULT FALSE,   -- ouvert par defaut (bouclage = secours, normalement ouvert)
    remarque       TEXT
);

-- ----------------------------------------------------------------------------
-- 3. QUALITE DE DONNEES / HISTORIQUE / GOUVERNANCE
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS anomalie (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poste_id        UUID REFERENCES poste(id),
    type_anomalie   VARCHAR(50) NOT NULL,
    valeur_source   TEXT,
    valeur_attendue TEXT,
    niveau          VARCHAR(20) NOT NULL DEFAULT 'WARNING',  -- INFO | WARNING | BLOQUANT
    date_detection  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolue         BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS cumul_depart (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    depart         VARCHAR(50) REFERENCES referentiel_depart(code),
    date_calcul    TIMESTAMPTZ NOT NULL DEFAULT now(),
    puissance_kva  NUMERIC,
    nb_postes      INTEGER,
    nb_clients     INTEGER
);

-- Valeur du bloc "INFODEPART / BILAN DES PUISSANCES INSTALLEES" lue telle
-- quelle dans le DWG au moment de l'extraction (30/07/2025). Sert de temoin
-- pour detecter une derive entre le schema et la realite terrain (cf. l'ancien
-- KPI "delta vs dernier export du schema" du prototype JS).
CREATE TABLE IF NOT EXISTS infodepart_enregistre (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poste_source              VARCHAR(30) NOT NULL REFERENCES poste_source(code),
    depart_brut               VARCHAR(50) NOT NULL,
    puissance_enregistree_kva NUMERIC,
    source                    VARCHAR(50) DEFAULT 'DWG_30072025'
);

CREATE TABLE IF NOT EXISTS incident (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date_incident  TIMESTAMPTZ,
    type_incident  VARCHAR(100),
    poste_id       UUID REFERENCES poste(id),
    commentaire    TEXT,
    statut         VARCHAR(50) DEFAULT 'OUVERT'
);

CREATE TABLE IF NOT EXISTS manoeuvre_historique (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manoeuvre_id   UUID REFERENCES manoeuvre(id),
    date_action    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ancien_etat    VARCHAR(20),
    nouvel_etat    VARCHAR(20),
    utilisateur    VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS ild_historique (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ild_id         UUID REFERENCES ild(id),
    date_evenement TIMESTAMPTZ NOT NULL DEFAULT now(),
    ancien_etat    VARCHAR(20),
    nouvel_etat    VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS utilisateur (
    id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom    VARCHAR(100),
    role   VARCHAR(50),
    email  VARCHAR(150) UNIQUE
);

CREATE TABLE IF NOT EXISTS document (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poste_id  UUID REFERENCES poste(id),
    nom       VARCHAR(255),
    type      VARCHAR(50),
    chemin    TEXT
);

-- ----------------------------------------------------------------------------
-- 4. FONCTIONS METIER (portage exact des regles VBA)
-- ----------------------------------------------------------------------------

-- Reproduit Val() de VBA : lit le nombre en tete de chaine ("630 kVA" -> 630).
CREATE OR REPLACE FUNCTION val_like(txt TEXT)
RETURNS NUMERIC AS $$
    SELECT COALESCE(
        (regexp_match(trim(txt), '^([-+]?[0-9]+(\.[0-9]+)?)'))[1]::numeric,
        0
    );
$$ LANGUAGE sql IMMUTABLE;

-- Extrait le nombre de clients depuis le champ libre "Nbr Client : 56".
CREATE OR REPLACE FUNCTION extract_clients(txt TEXT)
RETURNS INTEGER AS $$
    SELECT COALESCE(
        (regexp_match(txt, 'Nbr\s*Client\s*:\s*([0-9]+)', 'i'))[1]::integer,
        NULL
    );
$$ LANGUAGE sql IMMUTABLE;

-- Normalise un code depart saisi a la main ("Kani Keli", "kanikeli ") -> "KANIKELI".
CREATE OR REPLACE FUNCTION normalize_depart(txt TEXT)
RETURNS VARCHAR AS $$
    SELECT upper(regexp_replace(coalesce(txt, ''), '\s+', '', 'g'));
$$ LANGUAGE sql IMMUTABLE;

-- Maintient puissance_kva / nb_clients a jour automatiquement (equivalent de
-- la vue v_postes_metier mais materialise sur la ligne, pour des requetes/index rapides).
CREATE OR REPLACE FUNCTION trg_poste_cache_fields() RETURNS TRIGGER AS $$
BEGIN
    NEW.puissance_kva := val_like(NEW.puissance_txt);
    NEW.nb_clients    := extract_clients(NEW.autre);
    NEW.updated_at    := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS poste_cache_fields ON poste;
CREATE TRIGGER poste_cache_fields
    BEFORE INSERT OR UPDATE ON poste
    FOR EACH ROW EXECUTE FUNCTION trg_poste_cache_fields();

-- ----------------------------------------------------------------------------
-- 5. VUES METIER (controle qualite + cumuls, equivalent direct du VBA)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_postes_metier AS
SELECT
    p.*,
    rd.libelle      AS depart_libelle,
    rd.couleur      AS depart_couleur,
    rd.poste_source AS depart_poste_source_attendu,
    rtb.regime      AS regime_referentiel,
    rtb.famille     AS famille_bloc
FROM poste p
LEFT JOIN referentiel_depart rd ON rd.code = p.depart
LEFT JOIN referentiel_type_bloc rtb ON rtb.code = p.type_bloc;

-- Cumuls par depart (puissance installee, nb postes, nb clients) - equivalent
-- de computeDepartTotals() du VBA/JS, mais calcule en base pour tous les postes source.
CREATE OR REPLACE VIEW v_cumul_depart AS
SELECT
    rd.poste_source,
    rd.code AS depart,
    rd.libelle,
    rd.couleur,
    COUNT(p.id)                              AS nb_postes,
    COALESCE(SUM(p.puissance_kva), 0)        AS puissance_kva,
    COALESCE(SUM(p.nb_clients), 0)           AS nb_clients
FROM referentiel_depart rd
LEFT JOIN poste p ON p.depart = rd.code
GROUP BY rd.poste_source, rd.code, rd.libelle, rd.couleur;

CREATE OR REPLACE VIEW v_kpi_poste_source AS
SELECT
    ps.code AS poste_source,
    ps.nom,
    COUNT(p.id)                                              AS nb_postes,
    COALESCE(SUM(p.puissance_kva), 0)                        AS puissance_kva,
    COALESCE(SUM(p.nb_clients), 0)                           AS nb_clients,
    COUNT(*) FILTER (WHERE p.regime = 'DP')                  AS nb_dp,
    COUNT(*) FILTER (WHERE p.regime = 'AB')                  AS nb_ab,
    COUNT(*) FILTER (WHERE p.producteur)                     AS nb_producteurs
FROM poste_source ps
LEFT JOIN poste p ON p.poste_source = ps.code
GROUP BY ps.code, ps.nom;

-- Anomalies "departs" : vide / inconnu (equivalent exact du VBA).
CREATE OR REPLACE VIEW v_anomalie_depart_vide AS
SELECT * FROM poste WHERE depart_brut IS NULL OR trim(depart_brut) = '';

CREATE OR REPLACE VIEW v_anomalie_depart_inconnu AS
SELECT p.*
FROM poste p
LEFT JOIN referentiel_depart d ON normalize_depart(p.depart_brut) = d.code
WHERE trim(coalesce(p.depart_brut,'')) <> '' AND d.code IS NULL;

-- Anomalie decouverte sur les DXF reels : le calque d'origine ne correspond pas
-- au depart declare (cf docs/ANOMALIES_DECOUVERTES.md - 10 cas trouves sur SADA/LONGONI/KAWENI).
CREATE OR REPLACE VIEW v_anomalie_depart_layer_mismatch AS
SELECT *
FROM poste
WHERE layer_dxf IS NOT NULL
  AND depart IS NOT NULL
  AND layer_dxf NOT ILIKE '%' || depart || '%'
  AND replace(layer_dxf, '_', '') NOT ILIKE '%' || replace(depart, '_', '') || '%';

-- Doublons de numero AU SEIN du meme poste source (vraie erreur de saisie).
CREATE OR REPLACE VIEW v_anomalie_numero_duplique AS
SELECT numero, poste_source, COUNT(*) AS nb, array_agg(nom) AS noms, array_agg(id) AS poste_ids
FROM poste
WHERE numero IS NOT NULL AND trim(numero) <> ''
GROUP BY numero, poste_source
HAVING COUNT(*) > 1;

-- Meme numero present dans 2 postes source differents : probable point de
-- jonction / bouclage entre departs voisins (PAS forcement une erreur - a confirmer).
CREATE OR REPLACE VIEW v_jonction_inter_source_candidate AS
SELECT numero, array_agg(DISTINCT poste_source) AS postes_source, array_agg(DISTINCT depart) AS departs,
       array_agg(nom) AS noms, array_agg(id) AS poste_ids, COUNT(DISTINCT poste_source) AS nb_sources
FROM poste
WHERE numero IS NOT NULL AND trim(numero) <> ''
GROUP BY numero
HAVING COUNT(DISTINCT poste_source) > 1;

CREATE OR REPLACE VIEW v_anomalie_numero_vide AS
SELECT * FROM poste WHERE numero IS NULL OR trim(numero) = '';

CREATE OR REPLACE VIEW v_anomalie_puissance_invalide AS
SELECT * FROM poste WHERE val_like(puissance_txt) = 0;

-- Vue agregee "tableau de bord anomalies" consommee directement par l'API/le front.
CREATE OR REPLACE VIEW v_anomalies AS
SELECT id AS poste_id, poste_source, numero, nom, 'depart_vide' AS type_anomalie, 'WARNING' AS niveau
FROM v_anomalie_depart_vide
UNION ALL
SELECT id, poste_source, numero, nom, 'depart_inconnu', 'WARNING' FROM v_anomalie_depart_inconnu
UNION ALL
SELECT id, poste_source, numero, nom, 'depart_layer_mismatch', 'WARNING' FROM v_anomalie_depart_layer_mismatch
UNION ALL
SELECT id, poste_source, numero, nom, 'numero_vide', 'INFO' FROM v_anomalie_numero_vide
UNION ALL
SELECT id, poste_source, numero, nom, 'puissance_invalide', 'BLOQUANT' FROM v_anomalie_puissance_invalide;

COMMENT ON VIEW v_anomalies IS
'Flux unique consomme par GET /api/anomalies. Les doublons (v_anomalie_numero_duplique)
et les jonctions inter-postes-source (v_jonction_inter_source_candidate) sont exposes
a part car ils necessitent une decision humaine (fusion vs bouclage legitime) plutot
quun simple champ a corriger.';

-- Compare le cumul recalcule en base au bloc "BILAN DES PUISSANCES" enregistre
-- dans le DWG. Un ecart important = le schema source a derive depuis la derniere
-- mise a jour manuelle du bilan (ou le bilan n'a jamais ete tenu a jour, cf. LONGONI).
CREATE OR REPLACE VIEW v_depart_drift AS
SELECT
    cd.poste_source,
    cd.depart,
    cd.libelle,
    cd.nb_postes,
    cd.puissance_kva                                   AS puissance_recalculee_kva,
    ie.puissance_enregistree_kva,
    (cd.puissance_kva - COALESCE(ie.puissance_enregistree_kva, 0))            AS delta_kva,
    CASE WHEN COALESCE(ie.puissance_enregistree_kva, 0) > 0
         THEN round(100.0 * (cd.puissance_kva - ie.puissance_enregistree_kva)
                    / ie.puissance_enregistree_kva, 1)
         ELSE NULL END                                  AS delta_pct
FROM v_cumul_depart cd
LEFT JOIN infodepart_enregistre ie
    ON ie.poste_source = cd.poste_source
   AND replace(normalize_depart(ie.depart_brut), '_', '') = replace(cd.depart, '_', '')
WHERE cd.nb_postes > 0
ORDER BY abs(cd.puissance_kva - COALESCE(ie.puissance_enregistree_kva, 0)) DESC;
