"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../utils/prisma");
const errorHandler_1 = require("../middleware/errorHandler");
const auth_1 = require("../middleware/auth");
exports.authRouter = (0, express_1.Router)();
exports.authRouter.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            throw (0, errorHandler_1.createError)('Email e senha são obrigatórios');
        const user = await prisma_1.prisma.user.findUnique({ where: { email }, include: { company: true } });
        if (!user || !user.active)
            throw (0, errorHandler_1.createError)('Credenciais inválidas', 401);
        const valid = await bcryptjs_1.default.compare(password, user.password);
        if (!valid)
            throw (0, errorHandler_1.createError)('Credenciais inválidas', 401);
        const token = jsonwebtoken_1.default.sign({ id: user.id, email: user.email, role: user.role, companyId: user.companyId }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        await prisma_1.prisma.auditLog.create({
            data: { userId: user.id, action: 'LOGIN', entity: 'User', entityId: user.id },
        });
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                companyId: user.companyId,
                company: user.company,
            },
        });
    }
    catch (err) {
        next(err);
    }
});
exports.authRouter.get('/me', auth_1.authenticate, async (req, res, next) => {
    try {
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: req.user.id },
            include: { company: true },
        });
        if (!user)
            throw (0, errorHandler_1.createError)('Usuário não encontrado', 404);
        const { password: _p, ...userData } = user;
        res.json({ success: true, user: userData });
    }
    catch (err) {
        next(err);
    }
});
exports.authRouter.put('/change-password', auth_1.authenticate, async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await prisma_1.prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user)
            throw (0, errorHandler_1.createError)('Usuário não encontrado', 404);
        const valid = await bcryptjs_1.default.compare(currentPassword, user.password);
        if (!valid)
            throw (0, errorHandler_1.createError)('Senha atual incorreta');
        const hashed = await bcryptjs_1.default.hash(newPassword, 12);
        await prisma_1.prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
        res.json({ success: true, message: 'Senha alterada com sucesso' });
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=auth.js.map