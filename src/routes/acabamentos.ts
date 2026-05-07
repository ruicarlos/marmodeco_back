import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

export const acabamentosRouter = Router();
acabamentosRouter.use(authenticate);

// List
acabamentosRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const isAdmin = req.user!.role === 'ADMIN';
    const where = isAdmin ? {} : { userId: req.user!.id };
    const items = await prisma.acabamento.findMany({ where, orderBy: { descricao: 'asc' } });
    res.json({ success: true, data: items });
  } catch (err) { next(err); }
});

// Create
acabamentosRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { descricao, percentual } = req.body;
    if (!descricao) throw createError('Descrição é obrigatória');
    const item = await prisma.acabamento.create({
      data: {
        descricao,
        percentual: parseFloat(percentual) || 0,
        userId: req.user!.id,
        companyId: req.user!.companyId ?? undefined,
      },
    });
    res.status(201).json({ success: true, data: item });
  } catch (err) { next(err); }
});

// Update
acabamentosRouter.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.acabamento.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!existing) throw createError('Acabamento não encontrado', 404);
    const { descricao, percentual, active } = req.body;
    const item = await prisma.acabamento.update({
      where: { id: req.params.id },
      data: {
        ...(descricao   !== undefined && { descricao }),
        ...(percentual  !== undefined && { percentual: parseFloat(percentual) }),
        ...(active      !== undefined && { active }),
      },
    });
    res.json({ success: true, data: item });
  } catch (err) { next(err); }
});

// Delete
acabamentosRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.acabamento.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!existing) throw createError('Acabamento não encontrado', 404);
    await prisma.acabamento.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Acabamento excluído' });
  } catch (err) { next(err); }
});
