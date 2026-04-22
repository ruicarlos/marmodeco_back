"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.requireAdmin = requireAdmin;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const errorHandler_1 = require("./errorHandler");
function authenticate(req, _res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return next((0, errorHandler_1.createError)('Token de autenticação não fornecido', 401));
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET || 'secret');
        req.user = decoded;
        next();
    }
    catch {
        next((0, errorHandler_1.createError)('Token inválido ou expirado', 401));
    }
}
function requireAdmin(req, _res, next) {
    if (req.user?.role !== 'ADMIN') {
        return next((0, errorHandler_1.createError)('Acesso restrito ao administrador', 403));
    }
    next();
}
//# sourceMappingURL=auth.js.map