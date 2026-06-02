# Dashboard communication rules

## Valid e-mails

Monthly, daily, and per-creditor dashboard aggregates use the same rule. Records are excluded when the creditor has no usable group or company name, or when its company name contains `MODELO`, `SISTH`, or `CONNECTH`.

This intentionally changes small historical totals for company `401`:

| Month | Previous monthly total | Dashboard-valid total | Difference |
| --- | ---: | ---: | ---: |
| 2026-01 | 363836 | 363762 | -74 |
| 2026-02 | 429887 | 429625 | -262 |
| 2026-03 | 701706 | 701696 | -10 |

## E-mail clicks

Without `dataFim`, `/api/mailgrid/cliques` keeps its full-month behavior. When the dashboard limits business days, it sends the inclusive last visible business date as `dataFim`. Totals, per-creditor rows, and recent events are all filtered by `data_clique`.

## Wati limitation

The Wati store still keeps daily global totals in `dias[]` and global per-creditor totals in `por_credor`. It does not keep a date-and-creditor dimension. Correct per-period WhatsApp totals by creditor require a new `data + credor` structure and historical backfill. This implementation does not change Wati calculations.

## Monthly e-mail aggregate homologation

`database/portal_email_envios_mensal.homologacao.sql` must be applied only in the Portal do Acordo application PostgreSQL database configured by `EMAIL_MONTHLY_AGGREGATE_DATABASE_URL`. Never run it in either CRM database configured by `DATABASE_URL_401` or `DATABASE_URL_1007`.

The physical table stores every monthly e-mail aggregate without dashboard exclusions. It also stores creditor name snapshots so the application database view can apply the approved dashboard rule without a cross-database join. The refresh remains manual for now.

Review the target connection before applying DDL:

```powershell
$env:EMAIL_MONTHLY_AGGREGATE_DATABASE_URL='postgresql://...'
$env:ALLOW_EMAIL_MONTHLY_AGGREGATE_DDL='true'
npm run ddl:email-mensal -- --apply
```

Populate the complete 2026 history one month at a time:

```powershell
$env:ALLOW_EMAIL_MONTHLY_AGGREGATE_REFRESH='true'
npm run refresh:email-mensal -- --apply --empresa=all --inicio=2026-01 --fim=2026-06
```

Refresh only the current month:

```powershell
npm run refresh:email-mensal -- --apply --empresa=all --inicio=2026-06 --fim=2026-06
```

The DDL and refresh commands refuse to run when the application database connection is absent, read-only, or identical to a CRM connection. Validate the complete table, dashboard view, and API-equivalent payload:

```powershell
npm run validate:email-mensal -- --empresa=all --inicio=2026-01 --fim=2026-06
```

The application reads the auxiliary table only when `USE_EMAIL_MONTHLY_AGGREGATE=true` and `/api/comunicacao` receives `diario=0`. Requests with `diario=1` keep the current source-table queries.

Recommended manual schedule:

- Refresh the current month daily.
- Refresh previous months monthly or after a historical correction.
- Check `MAX(atualizado_em)` in `portal_email_envios_mensal` to identify stale data.
- Roll back immediately by setting `USE_EMAIL_MONTHLY_AGGREGATE=false`.
