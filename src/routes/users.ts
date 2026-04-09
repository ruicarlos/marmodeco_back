import { Router, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

export const usersRouter = Router();
usersRouter.use(authenticate);

usersRouter.get('/', requireAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      include: { company: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: users.map(({ password: _p, ...u }) => u) });
  } catch (err) { next(err); }
});

usersRouter.post('/', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, email, password, role, companyId } = req.body;
    if (!name || !email || !password) throw createError('Nome, email e senha são obrigatórios');

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw createError('Email já cadastrado');

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, password: hashed, role: role || 'GESTOR', companyId },
    });

    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: 'CREATE_USER', entity: 'User', entityId: user.id },
    });

    const { password: _p, ...userData } = user;
    res.status(201).json({ success: true, data: userData });
  } catch (err) { next(err); }
});

usersRouter.put('/:id', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, email, role, active, companyId } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { name, email, role, active, companyId },
    });
    const { password: _p, ...userData } = user;
    res.json({ success: true, data: userData });
  } catch (err) { next(err); }
});

usersRouter.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.params.id === req.user!.id) throw createError('Não é possível excluir seu próprio usuário');
    await prisma.user.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ success: true, message: 'Usuário desativado' });
  } catch (err) { next(err); }
});
