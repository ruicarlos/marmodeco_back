import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

export const kpisRouter = Router();
kpisRouter.use(authenticate);

// List KPI records — admin can filter by companyId, gestor sees own records
kpisRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { companyId } = req.query as { companyId?: string };
    let where: Record<string, unknown>;

    if (req.user!.role === 'ADMIN' && companyId) {
      where = { companyId };
    } else {
      where = { userId: req.user!.id };
    }

    const records = await prisma.kPIRecord.findMany({
      where,
      orderBy: { period: 'desc' },
    });
    res.json({ success: true, data: records });
  } catch (err) { next(err); }
});

// Create a KPI record and calculate resultado
kpisRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      type, period, notes,
      unidadesProduzidas, horasTrabalhadas, numOperadores,
      disponibilidade, desempenho, qualidade,
    } = req.body;

    if (!type || !period) throw createError('Tipo e período são obrigatórios');
    if (!['PRODUTIVIDADE', 'OEE'].includes(type)) throw createError('Tipo inválido');

    let resultado = 0;

    if (type === 'PRODUTIVIDADE') {
      const u = parseFloat(unidadesProduzidas) || 0;
      const h = parseFloat(horasTrabalhadas) || 0;
      const n = parseInt(numOperadores, 10) || 1;
      resultado = h > 0 ? u / (h * n) : 0;
    } else {
      const d = parseFloat(disponibilidade) || 0;
      const p = parseFloat(desempenho) || 0;
      const q = parseFloat(qualidade) || 0;
      resultado = (d / 100) * (p / 100) * (q / 100) * 100; // result in %
    }

    // Admin can pass an explicit companyId to attach the record to a company
    const targetCompanyId = req.body.companyId
      ? req.body.companyId
      : (req.user!.companyId ?? null);

    const record = await prisma.kPIRecord.create({
      data: {
        userId: req.user!.id,
        companyId: targetCompanyId,
        type,
        period: new Date(period),
        notes: notes || null,
        unidadesProduzidas: unidadesProduzidas ? parseFloat(unidadesProduzidas) : null,
        horasTrabalhadas: horasTrabalhadas ? parseFloat(horasTrabalhadas) : null,
        numOperadores: numOperadores ? parseInt(numOperadores, 10) : null,
        disponibilidade: disponibilidade ? parseFloat(disponibilidade) : null,
        desempenho: desempenho ? parseFloat(desempenho) : null,
        qualidade: qualidade ? parseFloat(qualidade) : null,
        resultado: Math.round(resultado * 1000) / 1000,
      },
    });

    res.status(201).json({ success: true, data: record });
  } catch (err) { next(err); }
});

// Delete a KPI record
kpisRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const record = await prisma.kPIRecord.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!record) throw createError('Registro não encontrado', 404);
    await prisma.kPIRecord.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Registro excluído' });
  } catch (err) { next(err); }
});
