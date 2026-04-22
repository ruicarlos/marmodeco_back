"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectsRouter = void 0;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const uuid_1 = require("uuid");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
const uploadDir = path_1.default.join(process.cwd(), 'uploads');
if (!fs_1.default.existsSync(uploadDir))
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname);
        cb(null, `${(0, uuid_1.v4)()}${ext}`);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = ['.pdf', '.dwg', '.dxf'];
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext))
            cb(null, true);
        else
            cb(new Error('Formato não suportado. Use PDF, DWG ou DXF'));
    },
});
exports.projectsRouter = (0, express_1.Router)();
exports.projectsRouter.use(auth_1.authenticate);
exports.projectsRouter.get('/', async (req, res, next) => {
    try {
        const where = req.user.role === 'ADMIN' ? {} : { userId: req.user.id };
        const projects = await prisma_1.prisma.project.findMany({
            where,
            include: {
                user: { select: { id: true, name: true, email: true } },
                _count: { select: { files: true, rooms: true, budgets: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: projects });
    }
    catch (err) {
        next(err);
    }
});
exports.projectsRouter.post('/', async (req, res, next) => {
    try {
        const { name, description, clientName, clientEmail, clientPhone } = req.body;
        if (!name)
            throw (0, errorHandler_1.createError)('Nome do projeto é obrigatório');
        const project = await prisma_1.prisma.project.create({
            data: {
                name, description, clientName, clientEmail, clientPhone,
                userId: req.user.id,
                companyId: req.user.companyId,
            },
        });
        res.status(201).json({ success: true, data: project });
    }
    catch (err) {
        next(err);
    }
});
exports.projectsRouter.get('/:id', async (req, res, next) => {
    try {
        const project = await prisma_1.prisma.project.findFirst({
            where: {
                id: req.params.id,
                ...(req.user.role !== 'ADMIN' && { userId: req.user.id }),
            },
            include: {
                files: true,
                rooms: { include: { budgetItems: { include: { material: true } } } },
                budgets: { include: { items: { include: { room: true, material: true } } } },
                user: { select: { id: true, name: true, email: true } },
            },
        });
        if (!project)
            throw (0, errorHandler_1.createError)('Projeto não encontrado', 404);
        res.json({ success: true, data: project });
    }
    catch (err) {
        next(err);
    }
});
exports.projectsRouter.put('/:id', async (req, res, next) => {
    try {
        const project = await prisma_1.prisma.project.findFirst({
            where: { id: req.params.id, ...(req.user.role !== 'ADMIN' && { userId: req.user.id }) },
        });
        if (!project)
            throw (0, errorHandler_1.createError)('Projeto não encontrado', 404);
        const updated = await prisma_1.prisma.project.update({
            where: { id: req.params.id },
            data: req.body,
        });
        res.json({ success: true, data: updated });
    }
    catch (err) {
        next(err);
    }
});
exports.projectsRouter.delete('/:id', async (req, res, next) => {
    try {
        const project = await prisma_1.prisma.project.findFirst({
            where: { id: req.params.id, ...(req.user.role !== 'ADMIN' && { userId: req.user.id }) },
        });
        if (!project)
            throw (0, errorHandler_1.createError)('Projeto não encontrado', 404);
        await prisma_1.prisma.project.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: 'Projeto excluído' });
    }
    catch (err) {
        next(err);
    }
});
// Upload CAD/PDF file
exports.projectsRouter.post('/:id/files', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file)
            throw (0, errorHandler_1.createError)('Nenhum arquivo enviado');
        const project = await prisma_1.prisma.project.findFirst({
            where: { id: req.params.id, ...(req.user.role !== 'ADMIN' && { userId: req.user.id }) },
        });
        if (!project)
            throw (0, errorHandler_1.createError)('Projeto não encontrado', 404);
        const file = await prisma_1.prisma.projectFile.create({
            data: {
                projectId: req.params.id,
                filename: req.file.filename,
                originalName: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size,
                path: req.file.path,
            },
        });
        res.status(201).json({ success: true, data: file, message: 'Arquivo enviado com sucesso' });
    }
    catch (err) {
        next(err);
    }
});
// Get rooms for a project
exports.projectsRouter.get('/:id/rooms', async (req, res, next) => {
    try {
        const rooms = await prisma_1.prisma.room.findMany({
            where: { projectId: req.params.id },
            include: { budgetItems: { include: { material: true } } },
            orderBy: { createdAt: 'asc' },
        });
        res.json({ success: true, data: rooms });
    }
    catch (err) {
        next(err);
    }
});
// Create/update rooms
exports.projectsRouter.post('/:id/rooms', async (req, res, next) => {
    try {
        const { name, area, perimeter, notes, fileId } = req.body;
        if (!name)
            throw (0, errorHandler_1.createError)('Nome do ambiente é obrigatório');
        const room = await prisma_1.prisma.room.create({
            data: { projectId: req.params.id, name, area: area || 0, perimeter: perimeter || 0, notes, fileId, isManual: true },
        });
        res.status(201).json({ success: true, data: room });
    }
    catch (err) {
        next(err);
    }
});
exports.projectsRouter.put('/:id/rooms/:roomId', async (req, res, next) => {
    try {
        const room = await prisma_1.prisma.room.update({
            where: { id: req.params.roomId },
            data: req.body,
        });
        res.json({ success: true, data: room });
    }
    catch (err) {
        next(err);
    }
});
exports.projectsRouter.delete('/:id/rooms/:roomId', async (_req, res, next) => {
    try {
        await prisma_1.prisma.room.delete({ where: { id: _req.params.roomId } });
        res.json({ success: true, message: 'Ambiente excluído' });
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=projects.js.map