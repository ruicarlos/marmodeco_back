import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { processDXFFile } from '../services/dxfProcessor';

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.dwg', '.dxf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Formato não suportado. Use PDF, DWG ou DXF'));
  },
});

export const projectsRouter = Router();
projectsRouter.use(authenticate);

projectsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const where = req.user!.role === 'ADMIN' ? {} : { userId: req.user!.id };
    const projects = await prisma.project.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { files: true, rooms: true, budgets: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: projects });
  } catch (err) { next(err); }
});

projectsRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, description, clientName, clientEmail, clientPhone } = req.body;
    if (!name) throw createError('Nome do projeto é obrigatório');

    const project = await prisma.project.create({
      data: {
        name, description, clientName, clientEmail, clientPhone,
        userId: req.user!.id,
        companyId: req.user!.companyId,
      },
    });
    res.status(201).json({ success: true, data: project });
  } catch (err) { next(err); }
});

projectsRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findFirst({
      where: {
        id: req.params.id,
        ...(req.user!.role !== 'ADMIN' && { userId: req.user!.id }),
      },
      include: {
        files: true,
        rooms: { include: { budgetItems: { include: { material: true } } } },
        budgets: { include: { items: { include: { room: true, material: true } } } },
        user: { select: { id: true, name: true, email: true } },
      },
    });
    if (!project) throw createError('Projeto não encontrado', 404);
    res.json({ success: true, data: project });
  } catch (err) { next(err); }
});

projectsRouter.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, ...(req.user!.role !== 'ADMIN' && { userId: req.user!.id }) },
    });
    if (!project) throw createError('Projeto não encontrado', 404);

    const updated = await prisma.project.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

projectsRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, ...(req.user!.role !== 'ADMIN' && { userId: req.user!.id }) },
    });
    if (!project) throw createError('Projeto não encontrado', 404);
    await prisma.project.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Projeto excluído' });
  } catch (err) { next(err); }
});

// Upload CAD/PDF file
projectsRouter.post('/:id/files', upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw createError('Nenhum arquivo enviado');

    const project = await prisma.project.findFirst({
      where: { id: req.params.id, ...(req.user!.role !== 'ADMIN' && { userId: req.user!.id }) },
    });
    if (!project) throw createError('Projeto não encontrado', 404);

    const file = await prisma.projectFile.create({
      data: {
        projectId: req.params.id,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path,
      },
    });

    // Auto-process DXF files
    const ext = path.extname(req.file.originalname).toLowerCase();
    let roomsCreated = 0;

    if (ext === '.dxf') {
      try {
        const extracted = processDXFFile(req.file.path);

        if (extracted.length > 0) {
          await prisma.room.createMany({
            data: extracted.map(r => ({
              projectId: req.params.id,
              fileId: file.id,
              name: r.name,
              area: r.area,
              perimeter: r.perimeter,
              notes: `Camada: ${r.layer}`,
              isManual: false,
            })),
          });
          roomsCreated = extracted.length;
        }

        await prisma.projectFile.update({
          where: { id: file.id },
          data: { processed: true, processedAt: new Date() },
        });
      } catch (processingError) {
        console.error('DXF processing error:', processingError);
        // Don't fail the upload — just mark as unprocessed
      }
    }

    const message = roomsCreated > 0
      ? `Arquivo processado: ${roomsCreated} ambiente(s) identificado(s) automaticamente`
      : 'Arquivo enviado com sucesso';

    res.status(201).json({ success: true, data: { ...file, roomsCreated }, message });
  } catch (err) { next(err); }
});

// Get rooms for a project
projectsRouter.get('/:id/rooms', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rooms = await prisma.room.findMany({
      where: { projectId: req.params.id },
      include: { budgetItems: { include: { material: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: rooms });
  } catch (err) { next(err); }
});

// Create/update rooms
projectsRouter.post('/:id/rooms', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, area, perimeter, notes, fileId } = req.body;
    if (!name) throw createError('Nome do ambiente é obrigatório');

    const room = await prisma.room.create({
      data: { projectId: req.params.id, name, area: area || 0, perimeter: perimeter || 0, notes, fileId, isManual: true },
    });
    res.status(201).json({ success: true, data: room });
  } catch (err) { next(err); }
});

projectsRouter.put('/:id/rooms/:roomId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const room = await prisma.room.update({
      where: { id: req.params.roomId },
      data: req.body,
    });
    res.json({ success: true, data: room });
  } catch (err) { next(err); }
});

projectsRouter.delete('/:id/rooms/:roomId', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.room.delete({ where: { id: _req.params.roomId } });
    res.json({ success: true, message: 'Ambiente excluído' });
  } catch (err) { next(err); }
});
