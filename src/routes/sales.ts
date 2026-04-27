import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

export const salesRouter = Router();
salesRouter.use(authenticate);

// ─── List sales ───────────────────────────────────────────────────────────────
salesRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { startDate, endDate } = req.query as Record<string, string>;
    const dr: { gte?: Date; lte?: Date } | undefined = (startDate || endDate) ? {} : undefined;
    if (dr) {
      if (startDate) dr.gte = new Date(startDate + 'T00:00:00.000Z');
      if (endDate)   dr.lte = new Date(endDate   + 'T23:59:59.999Z');
    }
    const where = {
      ...(user.role !== 'ADMIN' && { userId: user.id }),
      ...(dr && { createdAt: dr }),
    };

    const sales = await prisma.sale.findMany({
      where,
      include: {
        budget: {
          include: {
            project: { select: { id: true, name: true, clientName: true } },
            seller:  { select: { id: true, name: true } },
          },
        },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: sales });
  } catch (err) { next(err); }
});

// ─── Get single sale ──────────────────────────────────────────────────────────
salesRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const sale = await prisma.sale.findFirst({
      where: {
        id: req.params.id,
        ...(user.role !== 'ADMIN' && { userId: user.id }),
      },
      include: {
        budget: {
          include: {
            project: true,
            seller:  true,
            items:   { include: { room: true, material: true } },
          },
        },
        payments: true,
        financialEntries: true,
      },
    });
    if (!sale) throw createError('Venda não encontrada', 404);
    res.json({ success: true, data: sale });
  } catch (err) { next(err); }
});

// ─── Create sale (called when budget is approved) ─────────────────────────────
salesRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const { budgetId, paymentMethod, payments, notes } = req.body;
    if (!budgetId) throw createError('budgetId é obrigatório');

    const budget = await prisma.budget.findFirst({
      where: {
        id: budgetId,
        ...(user.role !== 'ADMIN' && { userId: user.id }),
      },
      include: {
        project: { select: { clientName: true } },
      },
    });
    if (!budget) throw createError('Orçamento não encontrado', 404);

    // Check if sale already exists
    const existing = await prisma.sale.findUnique({ where: { budgetId } });
    if (existing) throw createError('Já existe uma venda para este orçamento', 409);

    const method = paymentMethod || 'PIX';
    const totalAmount = budget.totalCost;

    // Build payments array for MIXED
    const paymentsData: { method: string; amount: number }[] = [];
    if (method === 'MIXED' && Array.isArray(payments) && payments.length > 0) {
      for (const p of payments) {
        if (p.amount > 0) paymentsData.push({ method: p.method, amount: parseFloat(p.amount) });
      }
    } else {
      paymentsData.push({ method, amount: totalAmount });
    }

    // Create sale and update budget status atomically
    const [sale] = await prisma.$transaction([
      prisma.sale.create({
        data: {
          budgetId,
          userId:        user.id,
          companyId:     user.companyId ?? undefined,
          clientName:    budget.project?.clientName ?? null,
          totalAmount,
          paymentMethod: method,
          status:        'PENDING',
          notes:         notes || null,
          payments: {
            create: paymentsData,
          },
        },
        include: {
          budget: {
            include: {
              project: { select: { id: true, name: true, clientName: true } },
              seller:  { select: { id: true, name: true } },
            },
          },
          payments: true,
        },
      }),
      prisma.budget.update({
        where: { id: budgetId },
        data:  { status: 'APPROVED', approvedAt: new Date() },
      }),
    ]);

    // Auto-create a FinancialEntry (RECEIVABLE) for this sale
    await prisma.financialEntry.create({
      data: {
        userId:      user.id,
        companyId:   user.companyId ?? undefined,
        type:        'RECEIVABLE',
        description: `Venda – ${budget.name}`,
        amount:      totalAmount,
        status:      'PENDING',
        category:    'VENDAS',
        saleId:      sale.id,
      },
    });

    res.status(201).json({ success: true, data: sale });
  } catch (err) { next(err); }
});

// ─── Update sale status / payment ─────────────────────────────────────────────
salesRouter.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const sale = await prisma.sale.findFirst({
      where: {
        id: req.params.id,
        ...(user.role !== 'ADMIN' && { userId: user.id }),
      },
    });
    if (!sale) throw createError('Venda não encontrada', 404);

    const { status, notes, paidAt } = req.body;
    const data: Record<string, unknown> = {};
    if (status  !== undefined) data.status  = status;
    if (notes   !== undefined) data.notes   = notes;
    if (paidAt  !== undefined) data.paidAt  = paidAt ? new Date(paidAt) : null;
    if (status === 'PAID') data.paidAt = new Date();

    const updated = await prisma.sale.update({
      where: { id: req.params.id },
      data,
      include: { budget: { include: { project: { select: { id: true, name: true } } } }, payments: true },
    });

    // Sync FinancialEntry status
    if (status === 'PAID') {
      await prisma.financialEntry.updateMany({
        where: { saleId: sale.id },
        data:  { status: 'PAID', paidAt: new Date() },
      });
    }

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// ─── Delete sale ───────────────────────────────────────────────────────────────
salesRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const sale = await prisma.sale.findFirst({
      where: {
        id: req.params.id,
        ...(user.role !== 'ADMIN' && { userId: user.id }),
      },
    });
    if (!sale) throw createError('Venda não encontrada', 404);

    await prisma.$transaction([
      prisma.financialEntry.deleteMany({ where: { saleId: sale.id } }),
      prisma.sale.delete({ where: { id: sale.id } }),
      prisma.budget.update({ where: { id: sale.budgetId }, data: { status: 'PENDING', approvedAt: null } }),
    ]);

    res.json({ success: true, message: 'Venda excluída' });
  } catch (err) { next(err); }
});
