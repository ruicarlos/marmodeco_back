import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

export const sellersRouter = Router();
sellersRouter.use(authenticate);

// List sellers
sellersRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const where = req.user!.companyId ? { companyId: req.user!.companyId } : {};
    const sellers = await prisma.seller.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: sellers });
  } catch (err) { next(err); }
});

// Create seller
sellersRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, email, phone, commission } = req.body;
    if (!name) throw createError('Nome do vendedor é obrigatório');
    const seller = await prisma.seller.create({
      data: {
        name,
        email:      email      || null,
        phone:      phone      || null,
        commission: parseFloat(commission) || 0,
        companyId:  req.user!.companyId ?? null,
      },
    });
    res.status(201).json({ success: true, data: seller });
  } catch (err) { next(err); }
});

// Update seller
sellersRouter.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, email, phone, commission, active } = req.body;
    const seller = await prisma.seller.update({
      where: { id: req.params.id },
      data: {
        ...(name       !== undefined && { name }),
        ...(email      !== undefined && { email      }),
        ...(phone      !== undefined && { phone      }),
        ...(commission !== undefined && { commission: parseFloat(commission) }),
        ...(active     !== undefined && { active     }),
      },
    });
    res.json({ success: true, data: seller });
  } catch (err) { next(err); }
});

// Delete seller
sellersRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.seller.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Vendedor excluído' });
  } catch (err) { next(err); }
});
