import { Router } from 'express';
import { getDashboardCommunicationSummary } from '../services/dashboardCommunicationService';
import { getDashboardPerformanceGraphs, getDashboardPerformanceSummary } from '../services/dashboardPerformanceService';
import { getDashboardResultGraphs } from '../services/dashboardResultGraphsService';
import { getDashboardResultSummary } from '../services/dashboardSummaryService';
import { baseQuerySchema, dashboardResultGraphsQuerySchema } from './schemas';

const router = Router();

router.get('/resultados/resumo', async (req, res) => {
  const parseResult = baseQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
  }

  const result = await getDashboardResultSummary(parseResult.data);
  res.json(result);
});

router.get('/resultados/graficos', async (req, res) => {
  const parseResult = dashboardResultGraphsQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
  }

  const result = await getDashboardResultGraphs(parseResult.data);
  res.json(result);
});

router.get('/performance/resumo', async (req, res) => {
  const parseResult = dashboardResultGraphsQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
  }

  const result = await getDashboardPerformanceSummary(parseResult.data);
  res.json(result);
});

router.get('/performance/graficos', async (req, res) => {
  const parseResult = dashboardResultGraphsQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
  }

  const result = await getDashboardPerformanceGraphs(parseResult.data);
  res.json(result);
});

router.get('/comunicacao/resumo', async (req, res) => {
  const parseResult = dashboardResultGraphsQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
  }

  const result = await getDashboardCommunicationSummary(parseResult.data);
  res.json(result);
});

export default router;
