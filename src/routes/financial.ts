import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

export const financialRouter = Router();
financialRouter.use(authenticate);

// ─── List entries ─────────────────────────────────────────────────────────────
financialRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user  = req.user!;
    const type  = req.query.type as string | undefined;   // RECEIVABLE | PAYABLE
    const status = req.query.status as string | undefined;

    const where: Record<string, unknown> = user.role === 'ADMIN' ? {} : { userId: user.id };
    if (type)   where.type   = type;
    if (status) where.status = status;

    const entries = await prisma.financialEntry.findMany({
      where,
      include: {
        sale: {
          include: {
            budget: { include: { project: { select: { id: true, name: true, clientName: true } } } },
          },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ success: true, data: entries });
  } catch (err) { next(err); }
});

// ─── Create manual entry ──────────────────────────────────────────────────────
financialRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { type, description, amount, dueDate, category } = req.body;
    if (!type || !description || !amount) throw createError('Tipo, descrição e valor são obrigatórios');

    const entry = await prisma.financialEntry.create({
      data: {
        userId:      user.id,
        companyId:   user.companyId ?? undefined,
        type,
        description,
        amount:      parseFloat(amount),
        dueDate:     dueDate   ? new Date(dueDate) : null,
        status:      'PENDING',
        category:    category  || null,
      },
    });
    res.status(201).json({ success: true, data: entry });
  } catch (err) { next(err); }
});

// ─── Update entry ─────────────────────────────────────────────────────────────
financialRouter.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const entry = await prisma.financialEntry.findFirst({
      where: { id: req.params.id, ...(user.role !== 'ADMIN' && { userId: user.id }) },
    });
    if (!entry) throw createError('Lançamento não encontrado', 404);

    const { type, description, amount, dueDate, paidAt, status, category } = req.body;
    const data: Record<string, unknown> = {};
    if (type        !== undefined) data.type        = type;
    if (description !== undefined) data.description = description;
    if (amount      !== undefined) data.amount      = parseFloat(amount);
    if (dueDate     !== undefined) data.dueDate     = dueDate ? new Date(dueDate) : null;
    if (paidAt      !== undefined) data.paidAt      = paidAt  ? new Date(paidAt)  : null;
    if (status      !== undefined) data.status      = status;
    if (category    !== undefined) data.category    = category;
    if (status === 'PAID' && !entry.paidAt) data.paidAt = new Date();

    const updated = await prisma.financialEntry.update({ where: { id: req.params.id }, data });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// ─── Delete entry ─────────────────────────────────────────────────────────────
financialRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const entry = await prisma.financialEntry.findFirst({
      where: {
        id: req.params.id,
        ...(user.role !== 'ADMIN' && { userId: user.id }),
        saleId: null, // don't allow deleting auto-generated entries via this endpoint
      },
    });
    if (!entry) throw createError('Lançamento não encontrado ou não pode ser excluído', 404);
    await prisma.financialEntry.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Lançamento excluído' });
  } catch (err) { next(err); }
});

// ─── Summary stats ────────────────────────────────────────────────────────────
financialRouter.get('/summary', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user  = req.user!;
    const where = user.role === 'ADMIN' ? {} : { userId: user.id };

    const [receivable, payable] = await Promise.all([
      prisma.financialEntry.aggregate({
        where: { ...where, type: 'RECEIVABLE' },
        _sum: { amount: true },
      }),
      prisma.financialEntry.aggregate({
        where: { ...where, type: 'PAYABLE' },
        _sum: { amount: true },
      }),
    ]);

    const [receivablePaid, payablePaid, overdue] = await Promise.all([
      prisma.financialEntry.aggregate({
        where: { ...where, type: 'RECEIVABLE', status: 'PAID' },
        _sum: { amount: true },
      }),
      prisma.financialEntry.aggregate({
        where: { ...where, type: 'PAYABLE', status: 'PAID' },
        _sum: { amount: true },
      }),
      prisma.financialEntry.aggregate({
        where: {
          ...where,
          status: 'PENDING',
          dueDate: { lt: new Date() },
        },
        _sum: { amount: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        totalReceivable:     receivable._sum.amount     || 0,
        totalPayable:        payable._sum.amount        || 0,
        receivedSoFar:       receivablePaid._sum.amount || 0,
        paidSoFar:           payablePaid._sum.amount    || 0,
        overdueAmount:       overdue._sum.amount        || 0,
        netBalance: (receivable._sum.amount || 0) - (payable._sum.amount || 0),
      },
    });
  } catch (err) { next(err); }
});
