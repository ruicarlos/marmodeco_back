"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.materialsRouter = void 0;
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
exports.materialsRouter = (0, express_1.Router)();
exports.materialsRouter.use(auth_1.authenticate);
exports.materialsRouter.get('/', async (_req, res, next) => {
    try {
        const materials = await prisma_1.prisma.material.findMany({
            where: { active: true },
            orderBy: [{ type: 'asc' }, { name: 'asc' }],
        });
        res.json({ success: true, data: materials });
    }
    catch (err) {
        next(err);
    }
});
exports.materialsRouter.get('/all', auth_1.requireAdmin, async (_req, res, next) => {
    try {
        const materials = await prisma_1.prisma.material.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] });
        res.json({ success: true, data: materials });
    }
    catch (err) {
        next(err);
    }
});
exports.materialsRouter.post('/', auth_1.requireAdmin, async (req, res, next) => {
    try {
        const { name, type, color, finish, thickness, pricePerM2, description, supplier } = req.body;
        if (!name || !type)
            throw (0, errorHandler_1.createError)('Nome e tipo do material são obrigatórios');
        const material = await prisma_1.prisma.material.create({
            data: { name, type, color, finish, thickness: thickness ? parseFloat(thickness) : null, pricePerM2: parseFloat(pricePerM2) || 0, description, supplier },
        });
        res.status(201).json({ success: true, data: material });
    }
    catch (err) {
        next(err);
    }
});
exports.materialsRouter.put('/:id', auth_1.requireAdmin, async (req, res, next) => {
    try {
        const data = { ...req.body };
        if (data.pricePerM2)
            data.pricePerM2 = parseFloat(data.pricePerM2);
        if (data.thickness)
            data.thickness = parseFloat(data.thickness);
        const material = await prisma_1.prisma.material.update({ where: { id: req.params.id }, data });
        res.json({ success: true, data: material });
    }
    catch (err) {
        next(err);
    }
});
exports.materialsRouter.delete('/:id', auth_1.requireAdmin, async (_req, res, next) => {
    try {
        await prisma_1.prisma.material.update({ where: { id: _req.params.id }, data: { active: false } });
        res.json({ success: true, message: 'Material desativado' });
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=materials.js.map