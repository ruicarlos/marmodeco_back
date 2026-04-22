"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.budgetsRouter = void 0;
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
exports.budgetsRouter = (0, express_1.Router)();
exports.budgetsRouter.use(auth_1.authenticate);
exports.budgetsRouter.get('/', async (req, res, next) => {
    try {
        const where = req.user.role === 'ADMIN' ? {} : { userId: req.user.id };
        const budgets = await prisma_1.prisma.budget.findMany({
            where,
            include: {
                project: { select: { id: true, name: true, clientName: true } },
                user: { select: { id: true, name: true } },
                _count: { select: { items: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: budgets });
    }
    catch (err) {
        next(err);
    }
});
exports.budgetsRouter.get('/:id', async (req, res, next) => {
    try {
        const where = req.user.role === 'ADMIN'
            ? { id: req.params.id }
            : { id: req.params.id, userId: req.user.id };
        const budget = await prisma_1.prisma.budget.findFirst({
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
        if (!budget)
            throw (0, errorHandler_1.createError)('Orçamento não encontrado', 404);
        res.json({ success: true, data: budget });
    }
    catch (err) {
        next(err);
    }
});
exports.budgetsRouter.post('/', async (req, res, next) => {
    try {
        const { projectId, name, notes, validUntil, laborCost, extraCost, discount, items } = req.body;
        if (!projectId || !name)
            throw (0, errorHandler_1.createError)('Projeto e nome do orçamento são obrigatórios');
        const project = await prisma_1.prisma.project.findFirst({
            where: { id: projectId, ...(req.user.role !== 'ADMIN' && { userId: req.user.id }) },
        });
        if (!project)
            throw (0, errorHandler_1.createError)('Projeto não encontrado', 404);
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
        const budget = await prisma_1.prisma.budget.create({
            data: {
                projectId,
                userId: req.user.id,
                name,
                notes,
                validUntil: validUntil ? new Date(validUntil) : null,
                laborCost: labor,
                extraCost: extra,
                discount: disc,
                totalArea,
                totalCost: finalCost,
                items: items && Array.isArray(items) ? {
                    create: items.map((item) => ({
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
    }
    catch (err) {
        next(err);
    }
});
exports.budgetsRouter.put('/:id', async (req, res, next) => {
    try {
        const { status, notes, validUntil, laborCost, extraCost, discount } = req.body;
        const updates = {};
        if (status !== undefined)
            updates.status = status;
        if (notes !== undefined)
            updates.notes = notes;
        if (validUntil !== undefined)
            updates.validUntil = new Date(validUntil);
        if (laborCost !== undefined)
            updates.laborCost = parseFloat(laborCost);
        if (extraCost !== undefined)
            updates.extraCost = parseFloat(extraCost);
        if (discount !== undefined)
            updates.discount = parseFloat(discount);
        if (status === 'APPROVED')
            updates.approvedAt = new Date();
        const budget = await prisma_1.prisma.budget.update({ where: { id: req.params.id }, data: updates });
        res.json({ success: true, data: budget });
    }
    catch (err) {
        next(err);
    }
});
exports.budgetsRouter.delete('/:id', async (req, res, next) => {
    try {
        const where = req.user.role === 'ADMIN'
            ? { id: req.params.id }
            : { id: req.params.id, userId: req.user.id };
        const budget = await prisma_1.prisma.budget.findFirst({ where });
        if (!budget)
            throw (0, errorHandler_1.createError)('Orçamento não encontrado', 404);
        await prisma_1.prisma.budget.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: 'Orçamento excluído' });
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=budgets.js.map