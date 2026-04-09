import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

export const companiesRouter = Router();
companiesRouter.use(authenticate);

companiesRouter.get('/', requireAdmin, async (_req, res: Response, next: NextFunction) => {
  try {
    const companies = await prisma.company.findMany({
      include: { _count: { select: { users: true, projects: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: companies });
  } catch (err) { next(err); }
});

companiesRouter.post('/', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, cnpj, email, phone, address, plan } = req.body;
    if (!name) throw createError('Nome da empresa é obrigatório');
    const company = await prisma.company.create({ data: { name, cnpj, email, phone, address, plan: plan || 'BASIC' } });
    res.status(201).json({ success: true, data: company });
  } catch (err) { next(err); }
});

companiesRouter.put('/:id', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const company = await prisma.company.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json({ success: true, data: company });
  } catch (err) { next(err); }
});
