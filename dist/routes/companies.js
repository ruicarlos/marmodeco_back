"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.companiesRouter = void 0;
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
exports.companiesRouter = (0, express_1.Router)();
exports.companiesRouter.use(auth_1.authenticate);
exports.companiesRouter.get('/', auth_1.requireAdmin, async (_req, res, next) => {
    try {
        const companies = await prisma_1.prisma.company.findMany({
            include: { _count: { select: { users: true, projects: true } } },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: companies });
    }
    catch (err) {
        next(err);
    }
});
exports.companiesRouter.post('/', auth_1.requireAdmin, async (req, res, next) => {
    try {
        const { name, cnpj, email, phone, address, plan } = req.body;
        if (!name)
            throw (0, errorHandler_1.createError)('Nome da empresa é obrigatório');
        const company = await prisma_1.prisma.company.create({ data: { name, cnpj, email, phone, address, plan: plan || 'BASIC' } });
        res.status(201).json({ success: true, data: company });
    }
    catch (err) {
        next(err);
    }
});
exports.companiesRouter.put('/:id', auth_1.requireAdmin, async (req, res, next) => {
    try {
        const company = await prisma_1.prisma.company.update({
            where: { id: req.params.id },
            data: req.body,
        });
        res.json({ success: true, data: company });
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=companies.js.map