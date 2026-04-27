import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

export const materialsRouter = Router();
materialsRouter.use(authenticate);

materialsRouter.get('/', async (_req, res: Response, next: NextFunction) => {
  try {
    const materials = await prisma.material.findMany({
      where: { active: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    res.json({ success: true, data: materials });
  } catch (err) { next(err); }
});

materialsRouter.get('/all', async (_req, res: Response, next: NextFunction) => {
  try {
    const materials = await prisma.material.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] });
    res.json({ success: true, data: materials });
  } catch (err) { next(err); }
});

materialsRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, type, color, finish, thickness, pricePerM2, stock, description, supplier } = req.body;
    if (!name || !type) throw createError('Nome e tipo do material são obrigatórios');

    const material = await prisma.material.create({
      data: {
        name, type, color, finish,
        thickness:  thickness  ? parseFloat(thickness)  : null,
        pricePerM2: parseFloat(pricePerM2) || 0,
        stock:      parseFloat(stock)      || 0,
        description, supplier,
      },
    });
    res.status(201).json({ success: true, data: material });
  } catch (err) { next(err); }
});

materialsRouter.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = { ...req.body };
    if (data.pricePerM2 !== undefined) data.pricePerM2 = parseFloat(data.pricePerM2) || 0;
    if (data.thickness  !== undefined) data.thickness  = data.thickness ? parseFloat(data.thickness) : null;
    if (data.stock      !== undefined) data.stock      = parseFloat(data.stock) || 0;
    const material = await prisma.material.update({ where: { id: req.params.id }, data });
    res.json({ success: true, data: material });
  } catch (err) { next(err); }
});

materialsRouter.delete('/:id', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.material.update({ where: { id: _req.params.id }, data: { active: false } });
    res.json({ success: true, message: 'Material desativado' });
  } catch (err) { next(err); }
});
