"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersRouter = void 0;
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
exports.usersRouter = (0, express_1.Router)();
exports.usersRouter.use(auth_1.authenticate);
exports.usersRouter.get('/', auth_1.requireAdmin, async (_req, res, next) => {
    try {
        const users = await prisma_1.prisma.user.findMany({
            include: { company: true },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: users.map(({ password: _p, ...u }) => u) });
    }
    catch (err) {
        next(err);
    }
});
exports.usersRouter.post('/', auth_1.requireAdmin, async (req, res, next) => {
    try {
        const { name, email, password, role, companyId } = req.body;
        if (!name || !email || !password)
            throw (0, errorHandler_1.createError)('Nome, email e senha são obrigatórios');
        const exists = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (exists)
            throw (0, errorHandler_1.createError)('Email já cadastrado');
        const hashed = await bcryptjs_1.default.hash(password, 12);
        const user = await prisma_1.prisma.user.create({
            data: { name, email, password: hashed, role: role || 'GESTOR', companyId },
        });
        await prisma_1.prisma.auditLog.create({
            data: { userId: req.user.id, action: 'CREATE_USER', entity: 'User', entityId: user.id },
        });
        const { password: _p, ...userData } = user;
        res.status(201).json({ success: true, data: userData });
    }
    catch (err) {
        next(err);
    }
});
exports.usersRouter.put('/:id', auth_1.requireAdmin, async (req, res, next) => {
    try {
        const { name, email, role, active, companyId } = req.body;
        const user = await prisma_1.prisma.user.update({
            where: { id: req.params.id },
            data: { name, email, role, active, companyId },
        });
        const { password: _p, ...userData } = user;
        res.json({ success: true, data: userData });
    }
    catch (err) {
        next(err);
    }
});
exports.usersRouter.delete('/:id', auth_1.requireAdmin, async (req, res, next) => {
    try {
        if (req.params.id === req.user.id)
            throw (0, errorHandler_1.createError)('Não é possível excluir seu próprio usuário');
        await prisma_1.prisma.user.update({ where: { id: req.params.id }, data: { active: false } });
        res.json({ success: true, message: 'Usuário desativado' });
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=users.js.map