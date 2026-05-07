import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

export const clientsRouter = Router();
clientsRouter.use(authenticate);

// List
clientsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const isAdmin = req.user!.role === 'ADMIN';
    const { search } = req.query as { search?: string };
    const where = {
      ...(isAdmin ? {} : { userId: req.user!.id }),
      ...(search ? {
        OR: [
          { name:    { contains: search, mode: 'insensitive' as const } },
          { email:   { contains: search, mode: 'insensitive' as const } },
          { phone:   { contains: search, mode: 'insensitive' as const } },
          { address: { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };
    const clients = await prisma.client.findMany({ where, orderBy: { name: 'asc' } });
    res.json({ success: true, data: clients });
  } catch (err) { next(err); }
});

// Create
clientsRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, phone, email, address, notes } = req.body;
    if (!name) throw createError('Nome é obrigatório');
    const client = await prisma.client.create({
      data: {
        name, phone: phone || null, email: email || null,
        address: address || null, notes: notes || null,
        userId: req.user!.id,
        companyId: req.user!.companyId ?? undefined,
      },
    });
    res.status(201).json({ success: true, data: client });
  } catch (err) { next(err); }
});

// Update
clientsRouter.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.client.findFirst({
      where: { id: req.params.id, ...(req.user!.role !== 'ADMIN' && { userId: req.user!.id }) },
    });
    if (!existing) throw createError('Cliente não encontrado', 404);
    const { name, phone, email, address, notes, active } = req.body;
    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: {
        ...(name    !== undefined && { name }),
        ...(phone   !== undefined && { phone:   phone   || null }),
        ...(email   !== undefined && { email:   email   || null }),
        ...(address !== undefined && { address: address || null }),
        ...(notes   !== undefined && { notes:   notes   || null }),
        ...(active  !== undefined && { active }),
      },
    });
    res.json({ success: true, data: client });
  } catch (err) { next(err); }
});

// Delete
clientsRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.client.findFirst({
      where: { id: req.params.id, ...(req.user!.role !== 'ADMIN' && { userId: req.user!.id }) },
    });
    if (!existing) throw createError('Cliente não encontrado', 404);
    await prisma.client.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Cliente excluído' });
  } catch (err) { next(err); }
});
