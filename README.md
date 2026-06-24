# HTA Digital Twin — Mayotte (SADA · LONGONI · KAWENI_BADAMIER)

Outil métier pour exploiter et maintenir à jour les schémas unifilaires HTA
des 3 postes source. Remplace la maintenance manuelle sous AutoCAD/VBA par
une base de données interrogeable, une API, et un schéma interactif
imprimable en A3 — sans rien perdre des règles métier déjà en place côté VBA.

Ce dépôt n'est pas une maquette : la base contient les **629 vrais postes**
extraits des DXF officiels (30/07/2025), et le pipeline d'extraction a été
revalidé en conditions réelles (voir `docs/ANOMALIES_DECOUVERTES.md`).

```
tools/dxf_extract/   extraction DXF -> JSON -> SQL (à relancer à chaque nouveau DWG)
database/            schéma + seed SQL, prêts pour Neon (Postgres)
backend/             API FastAPI (SQL brut, pas d'ORM)
frontend/             app React/TS (schéma, tableau, anomalies, import/export)
docs/                constats et décisions
data/extracted/      JSON intermédiaires de l'extraction (traçabilité)
```

## 0. Pré-requis

- Node.js ≥ 18, Python ≥ 3.10
- Un compte [Neon](https://neon.tech) (gratuit) — ou un Postgres local pour tester
- VS Code avec les extensions : *Python*, *ESLint*, *SQLTools* (ou l'extension
  Neon officielle pour parcourir la base directement dans VS Code)

## 1. Créer la base sur Neon

1. Neon Console → **New Project** → région la plus proche (Europe).
2. Onglet **Connect** → copier la chaîne **Pooled connection** (avec `?sslmode=require`).
3. Exécuter le schéma puis le seed, dans cet ordre exact :

```bash
psql "$NEON_DATABASE_URL" -f database/migrations/001_schema.sql
psql "$NEON_DATABASE_URL" -f database/seed/010_referentiels.sql
psql "$NEON_DATABASE_URL" -f database/seed/020_postes.sql
psql "$NEON_DATABASE_URL" -f database/seed/030_assets.sql
psql "$NEON_DATABASE_URL" -f database/seed/040_infodepart_enregistre.sql
```

Vérification rapide :

```sql
select * from v_kpi_poste_source;
select count(*) from v_anomalies;
```

Vous devez voir 3 postes source (629 postes au total) et une douzaine
d'anomalies déjà détectées — ce sont de vraies anomalies du plan d'origine,
pas un bug (détail dans `docs/ANOMALIES_DECOUVERTES.md`).

## 2. Backend (FastAPI)

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate    # ou l'équivalent Windows
pip install -r requirements.txt
cp .env.example .env        # puis coller la chaîne Neon dans DATABASE_URL
uvicorn app.main:app --reload --port 8000
```

→ documentation interactive sur `http://localhost:8000/docs`.

## 3. Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

→ `http://localhost:5173`. Le serveur Vite proxy `/api/*` vers `localhost:8000`
(voir `vite.config.ts`) — pas besoin de gérer le CORS en dev.

## 4. Ouvrir le tout dans VS Code

```bash
code hta-digital-twin.code-workspace   # ou simplement `code .` à la racine
```

Lancer **backend** et **frontend** dans deux terminaux intégrés (`Ctrl+\``
puis `+` pour un second terminal). Avec l'extension Neon/SQLTools, vous
pouvez aussi brancher directement la base dans l'explorateur VS Code pour
écrire vos requêtes de contrôle qualité sans sortir de l'éditeur.

## 5. Workflow de mise à jour d'un schéma DWG

C'est la fonction première de l'outil : quand un poste source est mis à jour
dans AutoCAD, on ré-exporte en DXF et on relance l'extraction au lieu de
ressaisir à la main.

```bash
cd tools/dxf_extract
python3 extract.py --dxf-dir /chemin/vers/les/3/dxf --out ../../data/extracted
python3 build_seed_sql.py
```

Cela régénère `database/seed/020_postes.sql` etc. **Ne pas réexécuter
bêtement sur la base déjà en production** (les `id` seraient dupliqués) —
pour une V2, prévoir un script de diff/merge (cf. roadmap ci-dessous) qui
compare numéro par numéro et ne touche que ce qui a changé. En attendant, le
plus sûr est de relire le fichier généré et de faire les `UPDATE`/`INSERT`
à la main pour les postes qui ont vraiment changé — le fichier vous donne
déjà la liste exacte des champs.

## 6. Ce qui est déjà solide

- **Schéma SQL testé en réel** (Postgres 16) : fonctions `val_like()` /
  `extract_clients()` (portage exact des règles VBA), triggers de cache,
  vues d'anomalies, vue de dérive vs bilan DWG.
- **API testée en réel** : CRUD complet sur `/api/postes`, filtres par
  poste source / départ / recherche, anomalies, jonctions inter-source.
- **Frontend testé en réel** : build TypeScript + Vite propre, proxy API
  fonctionnel, CRUD bout-en-bout vérifié contre la base.
- **629 postes réels**, pas de données inventées — extraits des DXF
  officiels avec une fidélité vérifiée (cf. §7).

## 7. Limites connues (honnêtes, pas cachées)

- **Couleurs des départs hors SADA** (23 sur 29) : placeholders distincts,
  pas encore alignées sur la légende DWG officielle (`couleur_a_confirmer = true`).
  Une requête `UPDATE referentiel_depart SET couleur = '#...' WHERE code = '...'`
  suffit à corriger, département par département.
- **RM6** : positions et libellés détectés par heuristique géométrique
  (clustering + texte le plus proche), marqués `a_verifier = true`. Fiables
  pour une vue d'ensemble, pas encore pour piloter une manœuvre réelle.
- **Pas de vraie topologie de câbles** : la table `cable` existe mais n'est
  pas peuplée — le DXF ne contient que des positions de symboles, pas un
  graphe électrique. La propagation de départ (`propagate_depart()` dans
  `Projet_SU.txt`) suppose ce graphe : c'est la prochaine brique à construire
  (voir roadmap).
- **Coordonnées GPS** (`lat`/`lng` sur `poste`) : colonnes prêtes mais vides.
  Les `x`/`y` actuels sont les coordonnées du plan DXF, pas du GPS réel.

## 8. Roadmap suggérée

1. **Diff/merge d'import** : remplacer le seed "tout ou rien" par un import
   qui compare numéro par numéro et journalise les changements dans `anomalie`.
2. **Graphe de câbles** : si le DXF source a des polylignes de câble par
   calque de départ, les extraire et reconstruire `cable` automatiquement ;
   sinon, saisie assistée poste-à-poste dans l'UI (cliquer amont → aval).
3. **Propagation automatique** : porter `propagate_depart()` (déjà spécifié
   dans `Projet_SU.txt`) en fonction PL/pgSQL une fois le graphe de câbles posé.
4. **Relevé GPS terrain** : une fois `lat`/`lng` renseignées, réactiver une
   vue carte (Leaflet) fidèle plutôt qu'une approximation par commune.
5. **Authentification + table `utilisateur`** déjà prévue dans le schéma —
   à brancher si plusieurs agents modifient la base en parallèle.
