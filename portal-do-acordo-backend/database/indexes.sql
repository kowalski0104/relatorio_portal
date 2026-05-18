-- Run this script in each Portal do Acordo database.
-- CONCURRENTLY keeps the tables available while PostgreSQL builds the indexes.
-- It cannot run inside an explicit transaction block.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_enviados_data_idcredor
ON tb_emails_enviados (data, idcredor);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_baixas_empresa_data_negociador
ON tb_baixas (idempresa, databaixa, negociador);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_baixas_processo_empresa
ON tb_baixas (processo, idempresa);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_acordo_empresa_data_negociador_status
ON tb_acordo (idempresa, data_acordo, negociador, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_acordo_processo_empresa_status
ON tb_acordo (processo, idempresa, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_portal_acessos_empresa_data
ON tb_portal_neg_acessos (idempresa, data_cad);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_devedor_empresa_credor_processo
ON tb_devedor (idempresa, idcredor, processo);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_titulos_processo_vencimento
ON tb_titulos (processo, vencimento);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_processo_processo_status
ON tb_processo (processo, status_desc);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credor_id_status_grupo
ON tb_credor (id, status, grupo);
