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
        user:    { select: { id: true, name: true, email: true } },
        seller:  { select: { id: true, name: true, email: true, phone: true, commission: true } },
        items:       { include: { room: true, material: true } },
        adjustments: { orderBy: { createdAt: 'asc' } },
        sale:        { select: { id: true, status: true, paymentMethod: true, totalAmount: true, createdAt: true } },
      },
    });
    if (!budget) throw createError('Orçamento não encontrado', 404);
    const realArea = (budget.items ?? []).reduce((s, i) => s + i.area, 0);
    res.json({ success: true, data: { ...budget, totalArea: realArea } });
  } catch (err) { next(err); }
});

budgetsRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { projectId, name, notes, validUntil, laborCost, extraCost, discount, sellerId, items, adjustments } = req.body;
    if (!projectId || !name) throw createError('Projeto e nome do orçamento são obrigatórios');

    const project = await prisma.project.findFirst({
      where: { id: projectId, ...(req.user!.role !== 'ADMIN' && { userId: req.user!.id }) },
    });
    if (!project) throw createError('Projeto não encontrado', 404);

    // Calculate totals
    let totalArea = 0;
    let materialCost = 0;

    if (items && Array.isArray(items)) {
      for (const item of items) {
        const area = parseFloat(item.area) || 0;
        const unitPrice = parseFloat(item.unitPrice) || 0;
        totalArea += area;
        materialCost += area * unitPrice;
      }
    }

    const labor = parseFloat(laborCost) || 0;
    const extra = parseFloat(extraCost) || 0;
    const disc  = parseFloat(discount)  || 0;

    // Compute adjustments
    let adjTotal = 0;
    const adjData: { description: string; type: string; valueType: string; value: number }[] = [];
    if (adjustments && Array.isArray(adjustments)) {
      for (const adj of adjustments) {
        const v = parseFloat(adj.value) || 0;
        const computed = adj.valueType === 'PERCENT' ? materialCost * v / 100 : v;
        adjTotal += adj.type === 'COST' ? computed : -computed;
        adjData.push({ description: adj.description, type: adj.type, valueType: adj.valueType, value: v });
      }
    }

    const finalCost = materialCost + labor + extra - disc + adjTotal;

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
        ...(sellerId && { sellerId }),
        items: items && Array.isArray(items) ? {
          create: items.map((item: { roomId: string; materialId: string; area: number; quantity: number; unitPrice: number; notes?: string }) => ({
            roomId:     item.roomId,
            materialId: item.materialId,
            area:       parseFloat(String(item.area))      || 0,
            quantity:   parseFloat(String(item.quantity))  || 1,
            unitPrice:  parseFloat(String(item.unitPrice)) || 0,
            subtotal:  (parseFloat(String(item.area)) || 0) * (parseFloat(String(item.unitPrice)) || 0),
            notes: item.notes,
          })),
        } : undefined,
        adjustments: adjData.length > 0 ? { create: adjData } : undefined,
      },
      include: {
        items:       { include: { room: true, material: true } },
        adjustments: true,
        seller:      true,
        project:     { select: { id: true, name: true } },
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

// ─── Helper: recalculate budget totals from items + adjustments ──────────────
async function recalcBudget(budgetId: string) {
  const budget = await prisma.budget.findUnique({ where: { id: budgetId } });
  if (!budget) return;
  const items       = await prisma.budgetItem.findMany({ where: { budgetId } });
  const adjustments = await prisma.budgetAdjustment.findMany({ where: { budgetId } });

  const totalArea    = items.reduce((s, i) => s + i.area,    0);
  const materialCost = items.reduce((s, i) => s + i.subtotal, 0);

  let adjTotal = 0;
  for (const adj of adjustments) {
    const computed = adj.valueType === 'PERCENT' ? materialCost * adj.value / 100 : adj.value;
    adjTotal += adj.type === 'COST' ? computed : -computed;
  }

  const totalCost = materialCost + budget.laborCost + budget.extraCost - budget.discount + adjTotal;
  await prisma.budget.update({ where: { id: budgetId }, data: { totalArea, totalCost } });
}

// ─── Add item to existing budget ─────────────────────────────────────────────
budgetsRouter.post('/:id/items', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const budget = await prisma.budget.findFirst({
      where: { id: req.params.id, ...(req.user!.role !== 'ADMIN' && { userId: req.user!.id }) },
    });
    if (!budget) throw createError('Orçamento não encontrado', 404);

    const { roomId, materialId, area, unitPrice, notes } = req.body;
    if (!roomId || !materialId) throw createError('Ambiente e material são obrigatórios');

    const a = parseFloat(area) || 0;
    const p = parseFloat(unitPrice) || 0;

    await prisma.budgetItem.create({
      data: { budgetId: req.params.id, roomId, materialId, area: a, quantity: 1, unitPrice: p, subtotal: a * p, notes: notes || null },
    });
    await recalcBudget(req.params.id);

    const updated = await prisma.budget.findUnique({
      where: { id: req.params.id },
      include: { items: { include: { room: true, material: true } }, project: { select: { id: true, name: true } } },
    });
    res.status(201).json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// ─── Update a budget item ─────────────────────────────────────────────────────
budgetsRouter.put('/:id/items/:itemId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const budget = await prisma.budget.findFirst({
      where: { id: req.params.id, ...(req.user!.role !== 'ADMIN' && { userId: req.user!.id }) },
    });
    if (!budget) throw createError('Orçamento não encontrado', 404);

    const item = await prisma.budgetItem.findFirst({ where: { id: req.params.itemId, budgetId: req.params.id } });
    if (!item) throw createError('Item não encontrado', 404);

    const { materialId, area, unitPrice, notes } = req.body;
    const newArea  = area      !== undefined ? parseFloat(area)      : item.area;
    const newPrice = unitPrice !== undefined ? parseFloat(unitPrice) : item.unitPrice;
    const update: Record<string, unknown> = { area: newArea, unitPrice: newPrice, subtotal: newArea * newPrice };
    if (materialId !== undefined) update.materialId = materialId;
    if (notes      !== undefined) update.notes = notes;

    await prisma.budgetItem.update({ where: { id: req.params.itemId }, data: update });
    await recalcBudget(req.params.id);

    const updated = await prisma.budget.findUnique({
      where: { id: req.params.id },
      include: { items: { include: { room: true, material: true } }, project: { select: { id: true, name: true } } },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// ─── Delete a budget item ─────────────────────────────────────────────────────
budgetsRouter.delete('/:id/items/:itemId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const budget = await prisma.budget.findFirst({
      where: { id: req.params.id, ...(req.user!.role !== 'ADMIN' && { userId: req.user!.id }) },
    });
    if (!budget) throw createError('Orçamento não encontrado', 404);
    await prisma.budgetItem.delete({ where: { id: req.params.itemId } });
    await recalcBudget(req.params.id);
    res.json({ success: true, message: 'Item removido' });
  } catch (err) { next(err); }
});

// ─── Adjustments (custos/descontos adicionais) ────────────────────────────────

budgetsRouter.post('/:id/adjustments', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const budget = await prisma.budget.findFirst({
      where: { id: req.params.id, ...(req.user!.role !== 'ADMIN' && { userId: req.user!.id }) },
    });
    if (!budget) throw createError('Orçamento não encontrado', 404);

    const { description, type, valueType, value } = req.body;
    if (!description) throw createError('Descrição é obrigatória');

    await prisma.budgetAdjustment.create({
      data: {
        budgetId: req.params.id,
        description,
        type:      type      || 'COST',
        valueType: valueType || 'FIXED',
        value:     parseFloat(value) || 0,
      },
    });
    await recalcBudget(req.params.id);

    const updated = await prisma.budget.findUnique({
      where: { id: req.params.id },
      include: {
        items:       { include: { room: true, material: true } },
        adjustments: { orderBy: { createdAt: 'asc' } },
        seller:      true,
        project:     { select: { id: true, name: true } },
      },
    });
    res.status(201).json({ success: true, data: updated });
  } catch (err) { next(err); }
});

budgetsRouter.put('/:id/adjustments/:adjId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const budget = await prisma.budget.findFirst({
      where: { id: req.params.id, ...(req.user!.role !== 'ADMIN' && { userId: req.user!.id }) },
    });
    if (!budget) throw createError('Orçamento não encontrado', 404);

    const { description, type, valueType, value } = req.body;
    await prisma.budgetAdjustment.update({
      where: { id: req.params.adjId },
      data: {
        ...(description !== undefined && { description }),
        ...(type        !== undefined && { type }),
        ...(valueType   !== undefined && { valueType }),
        ...(value       !== undefined && { value: parseFloat(value) }),
      },
    });
    await recalcBudget(req.params.id);

    const updated = await prisma.budget.findUnique({
      where: { id: req.params.id },
      include: {
        items:       { include: { room: true, material: true } },
        adjustments: { orderBy: { createdAt: 'asc' } },
        seller:      true,
        project:     { select: { id: true, name: true } },
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

budgetsRouter.delete('/:id/adjustments/:adjId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const budget = await prisma.budget.findFirst({
      where: { id: req.params.id, ...(req.user!.role !== 'ADMIN' && { userId: req.user!.id }) },
    });
    if (!budget) throw createError('Orçamento não encontrado', 404);
    await prisma.budgetAdjustment.delete({ where: { id: req.params.adjId } });
    await recalcBudget(req.params.id);
    res.json({ success: true, message: 'Ajuste removido' });
  } catch (err) { next(err); }
});
