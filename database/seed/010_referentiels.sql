-- Genere automatiquement par tools/dxf_extract/build_seed_sql.py
-- NE PAS EDITER A LA MAIN : relancer le generateur puis ajuster les
-- couleurs/poste_source via UPDATE si besoin (cf. docs/ANOMALIES_DECOUVERTES.md).

INSERT INTO poste_source (code, nom, tension_kv, commune) VALUES
  ('SADA', 'Poste Source SADA', 20, 'Sada'),
  ('LONGONI', 'Poste Source LONGONI', 20, 'Koungou'),
  ('KAWENI_BADAMIER', 'Poste Source KAWENI / BADAMIER', 20, 'Mamoudzou')
ON CONFLICT (code) DO NOTHING;

INSERT INTO referentiel_type_bloc (code, regime, famille) VALUES
  ('POSTECAB_AB', 'AB', 'CAB'),
  ('POSTECAB_DP', 'DP', 'CAB'),
  ('POSTECBS_AB', 'AB', 'CBS'),
  ('POSTECBS_DP', 'DP', 'CBS'),
  ('POSTEH61_DP', 'DP', 'H61'),
  ('POSTELOCAL_AB', 'AB', 'LOCAL'),
  ('POSTELOCAL_DP', 'DP', 'LOCAL'),
  ('POSTEPVCR_AB', 'AB', 'PVCR'),
  ('POSTESOCLE_DP', 'DP', 'SOCLE')
ON CONFLICT (code) DO NOTHING;

INSERT INTO referentiel_depart (code, libelle, couleur, poste_source, couleur_a_confirmer) VALUES
  ('KANIKELI', 'Kani Kéli', '#D4A017', 'SADA', FALSE),
  ('CHIRONGUI', 'Chirongui', '#E74C3C', 'SADA', FALSE),
  ('CHICONI', 'Chiconi', '#95A5A6', 'SADA', FALSE),
  ('OUANGANI', 'Ouangani', '#2ECC71', 'SADA', FALSE),
  ('MAKI', 'Maki', '#8E44AD', 'SADA', FALSE),
  ('BOUENI', 'Bouéni', '#FF66CC', 'SADA', FALSE),
  ('SOULOU', 'Soulou', '#3052a6', 'LONGONI', TRUE),
  ('KAHANI', 'Kahani', '#74a630', 'LONGONI', TRUE),
  ('KANGANI', 'Kangani', '#a63097', 'LONGONI', TRUE),
  ('BANDRABOUA', 'Bandraboua', '#30a692', 'LONGONI', TRUE),
  ('YLANG', 'Ylang', '#4d30a6', 'LONGONI', TRUE),
  ('VALLEE3', 'Vallée 3', '#35a630', 'LONGONI', TRUE),
  ('PORT', 'Port (Longoni)', '#a63057', 'LONGONI', TRUE),
  ('SOLAIRE', 'Solaire', '#3079a6', 'LONGONI', TRUE),
  ('SUD', 'Sud', '#9ca630', 'KAWENI_BADAMIER', TRUE),
  ('ZI', 'Zone Industrielle (ZI)', '#8d30a6', 'KAWENI_BADAMIER', TRUE),
  ('PASSAMAINTY', 'Passamainty', '#30a66a', 'KAWENI_BADAMIER', TRUE),
  ('CAVANI', 'Cavani', '#303aa6', 'KAWENI_BADAMIER', TRUE),
  ('PAMANDZI', 'Pamandzi', '#5ca630', 'KAWENI_BADAMIER', TRUE),
  ('LUKIDA', 'Lukida', '#a6307e', 'KAWENI_BADAMIER', TRUE),
  ('DZAOUDZI', 'Dzaoudzi', '#30a1a6', 'KAWENI_BADAMIER', TRUE),
  ('MAMOUDZOU', 'Mamoudzou', '#a68830', 'KAWENI_BADAMIER', TRUE),
  ('LAFERME', 'La Ferme', '#6530a6', 'KAWENI_BADAMIER', TRUE),
  ('MANGROVE', 'Mangrove', '#30a643', 'KAWENI_BADAMIER', TRUE),
  ('KAWENI_1', 'Kaweni 1', '#a6303f', 'KAWENI_BADAMIER', TRUE),
  ('TSA1KAW', 'TSA 1 Kaweni', '#3061a6', 'KAWENI_BADAMIER', TRUE),
  ('TSA2KAW', 'TSA 2 Kaweni', '#83a630', 'KAWENI_BADAMIER', TRUE),
  ('LONGONI1', 'Longoni 1', '#a530a6', 'LONGONI', TRUE),
  ('LONGONI2', 'Longoni 2', '#30a683', 'LONGONI', TRUE)
ON CONFLICT (code) DO NOTHING;
