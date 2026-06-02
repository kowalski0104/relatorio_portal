-- Run only in the Portal do Acordo application PostgreSQL database.
-- Never run this DDL in the CRM databases behind DATABASE_URL_401 and DATABASE_URL_1007.
-- The physical table stores complete monthly totals. Dashboard exclusions live in the view.

CREATE TABLE IF NOT EXISTS portal_email_envios_mensal (
  idempresa integer NOT NULL,
  mes date NOT NULL,
  idcredor integer NULL,
  grupo text NULL,
  razaosocial text NULL,
  qtde_emails bigint NOT NULL CHECK (qtde_emails >= 0),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_email_envios_mensal_empresa_mes_credor_uidx
ON portal_email_envios_mensal (idempresa, mes, idcredor) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS portal_email_envios_mensal_empresa_mes_idx
ON portal_email_envios_mensal (idempresa, mes);

CREATE INDEX IF NOT EXISTS portal_email_envios_mensal_empresa_mes_credor_idx
ON portal_email_envios_mensal (idempresa, mes, idcredor);

CREATE OR REPLACE VIEW portal_email_envios_dashboard AS
SELECT
  m.idempresa,
  m.mes,
  m.idcredor,
  COALESCE(NULLIF(TRIM(m.grupo), ''), TRIM(m.razaosocial), 'OUTROS') AS credor,
  m.qtde_emails,
  m.atualizado_em
FROM portal_email_envios_mensal m
WHERE COALESCE(NULLIF(TRIM(m.grupo), ''), NULLIF(TRIM(m.razaosocial), '')) IS NOT NULL
  AND COALESCE(m.razaosocial, '') NOT ILIKE '%MODELO%'
  AND COALESCE(m.razaosocial, '') NOT ILIKE '%SISTH%'
  AND COALESCE(m.razaosocial, '') NOT ILIKE '%CONNECTH%';
