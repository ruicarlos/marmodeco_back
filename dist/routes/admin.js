"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
exports.adminRouter = (0, express_1.Router)();
exports.adminRouter.use(auth_1.authenticate, auth_1.requireAdmin);
exports.adminRouter.get('/stats', async (_req, res, next) => {
    try {
        const [users, companies, projects, budgets, materials] = await Promise.all([
            prisma_1.prisma.user.count(),
            prisma_1.prisma.company.count(),
            prisma_1.prisma.project.count(),
            prisma_1.prisma.budget.count(),
            prisma_1.prisma.material.count(),
        ]);
        res.json({ success: true, data: { users, companies, projects, budgets, materials } });
    }
    catch (err) {
        next(err);
    }
});
exports.adminRouter.get('/audit-logs', async (req, res, next) => {
    try {
        const page = parseInt(String(req.query.page)) || 1;
        const limit = parseInt(String(req.query.limit)) || 50;
        const skip = (page - 1) * limit;
        const [logs, total] = await Promise.all([
            prisma_1.prisma.auditLog.findMany({
                skip,
                take: limit,
                include: { user: { select: { id: true, name: true, email: true } } },
                orderBy: { createdAt: 'desc' },
            }),
            prisma_1.prisma.auditLog.count(),
        ]);
        res.json({ success: true, data: logs, meta: { total, page, limit, pages: Math.ceil(total / limit) } });
    }
    catch (err) {
        next(err);
    }
});
exports.adminRouter.get('/plans', async (_req, res, next) => {
    try {
        const plans = await prisma_1.prisma.subscriptionPlan.findMany({ orderBy: { price: 'asc' } });
        res.json({ success: true, data: plans });
    }
    catch (err) {
        next(err);
    }
});
exports.adminRouter.post('/plans', async (req, res, next) => {
    try {
        const { name, code, price, maxUsers, maxProjects, maxStorage, features } = req.body;
        const plan = await prisma_1.prisma.subscriptionPlan.create({
            data: {
                name, code, price: parseFloat(price),
                maxUsers: parseInt(maxUsers), maxProjects: parseInt(maxProjects),
                maxStorage: parseInt(maxStorage),
                features: typeof features === 'string' ? features : JSON.stringify(features),
            },
        });
        res.status(201).json({ success: true, data: plan });
    }
    catch (err) {
        next(err);
    }
});
exports.adminRouter.put('/plans/:id', async (req, res, next) => {
    try {
        const data = { ...req.body };
        if (data.price !== undefined)
            data.price = parseFloat(data.price);
        if (data.maxUsers !== undefined)
            data.maxUsers = parseInt(data.maxUsers);
        if (data.maxProjects !== undefined)
            data.maxProjects = parseInt(data.maxProjects);
        if (data.maxStorage !== undefined)
            data.maxStorage = parseInt(data.maxStorage);
        if (data.features && typeof data.features !== 'string')
            data.features = JSON.stringify(data.features);
        const plan = await prisma_1.prisma.subscriptionPlan.update({ where: { id: req.params.id }, data });
        res.json({ success: true, data: plan });
    }
    catch (err) {
        next(err);
    }
});
exports.adminRouter.delete('/plans/:id', async (req, res, next) => {
    try {
        // Soft-delete: set active = false
        const plan = await prisma_1.prisma.subscriptionPlan.update({
            where: { id: req.params.id },
            data: { active: false },
        });
        res.json({ success: true, data: plan });
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=admin.js.map