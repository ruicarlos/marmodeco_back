import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

export const budgetsRouter = Router();
budgetsRouter.use(authenticate);

budgetsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const where = req.user!.role === 'ADMIN' ? {} : { userId: req.user!.id };
    const budgets = await prisma.budget.findMany({
      where,
      include: {
        project: { select: { id: true, name: true, clientName: true } },
        user: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: budgets });
  } catch (err) { next(err); }
});

budgetsRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const where = req.user!.role === 'ADMIN'
      ? { id: req.params.id }
      : { id: req.params.id, userId: req.user!.id };

    const budget = await prisma.budget.findFirst({
      where,
      include: {
        project: { select: { id: true, name: true, clientName: true, clientEmail: true } },
        user: { select: { id: true, name: true, email: true } },
        items: {
          include: {
            room: true,
            material: true,
          },
        },
      },
    });
    if (!budget) throw createError('Orçamento não encontrado', 404);
    // Ensure totalArea reflects actual items (fixes legacy 0.00 m² entries)
    const realArea = (budget.items ?? []).reduce((s, i) => s + i.area, 0);
    res.json({ success: true, data: { ...budget, totalArea: realArea } });
  } catch (err) { next(err); }
});

budgetsRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { projectId, name, notes, validUntil, laborCost, extraCost, discount, items } = req.body;
    if (!projectId || !name) throw createError('Projeto e nome do orçamento são obrigatórios');

    const project = await prisma.project.findFirst({
      where: { id: projectId, ...(req.user!.role !== 'ADMIN' && { userId: req.user!.id }) },
    });
    if (!project) throw createError('Projeto não encontrado', 404);

    // Calculate totals
    let totalArea = 0;
    let totalCost = 0;

    if (items && Array.isArray(items)) {
      for (const item of items) {
        const area = parseFloat(item.area) || 0;
        const unitPrice = parseFloat(item.unitPrice) || 0;
        const subtotal = area * unitPrice;
        totalArea += area;
        totalCost += subtotal;
      }
    }

    const labor = parseFloat(laborCost) || 0;
    const extra = parseFloat(extraCost) || 0;
    const disc = parseFloat(discount) || 0;
    const finalCost = totalCost + labor + extra - disc;

    const budget = await prisma.budget.create({
      data: {
        projectId,
        userId: req.user!.id,
        name,
        notes,
        validUntil: validUntil ? new Date(validUntil) : null,
        laborCost: labor,
        extraCost: extra,
        discount: disc,
        totalArea,
        totalCost: finalCost,
        items: items && Array.isArray(items) ? {
          create: items.map((item: { roomId: string; materialId: string; area: number; quantity: number; unitPrice: number; notes?: string }) => ({
            roomId: item.roomId,
            materialId: item.materialId,
            area: parseFloat(String(item.area)) || 0,
            quantity: parseFloat(String(item.quantity)) || 1,
            unitPrice: parseFloat(String(item.unitPrice)) || 0,
            subtotal: (parseFloat(String(item.area)) || 0) * (parseFloat(String(item.unitPrice)) || 0),
            notes: item.notes,
          })),
        } : undefined,
      },
      include: {
        items: { include: { room: true, material: true } },
        project: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ success: true, data: budget });
  } catch (err) { next(err); }
});

budgetsRouter.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, notes, validUntil, laborCost, extraCost, discount } = req.body;
    const updates: Record<string, unknown> = {};
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    if (validUntil !== undefined) updates.validUntil = new Date(validUntil);
    if (laborCost !== undefined) updates.laborCost = parseFloat(laborCost);
    if (extraCost !== undefined) updates.extraCost = parseFloat(extraCost);
    if (discount !== undefined) updates.discount = parseFloat(discount);
    if (status === 'APPROVED') updates.approvedAt = new Date();

    // Recalculate totalArea and totalCost from current items + updated costs
    const current = await prisma.budget.findUnique({ where: { id: req.params.id } });
    if (current) {
      const items = await prisma.budgetItem.findMany({ where: { budgetId: req.params.id } });
      const area = items.reduce((s, i) => s + i.area, 0);
      const materialCost = items.reduce((s, i) => s + i.subtotal, 0);
      const labor = updates.laborCost !== undefined ? (updates.laborCost as number) : current.laborCost;
      const extra = updates.extraCost !== undefined ? (updates.extraCost as number) : current.extraCost;
      const disc  = updates.discount  !== undefined ? (updates.discount  as number) : current.discount;
      updates.totalArea = area;
      updates.totalCost = materialCost + labor + extra - disc;
    }

    const budget = await prisma.budget.update({ where: { id: req.params.id }, data: updates });
    res.json({ success: true, data: budget });
  } catch (err) { next(err); }
});

budgetsRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const where = req.user!.role === 'ADMIN'
      ? { id: req.params.id }
      : { id: req.params.id, userId: req.user!.id };
    const budget = await prisma.budget.findFirst({ where });
    if (!budget) throw createError('Orçamento não encontrado', 404);
    await prisma.budget.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Orçamento excluído' });
  } catch (err) { next(err); }
});
