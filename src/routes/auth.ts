import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { createError } from '../middleware/errorHandler';
import { authenticate, AuthRequest } from '../middleware/auth';

export const authRouter = Router();

authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw createError('Email e senha são obrigatórios');

    const user = await prisma.user.findUnique({ where: { email }, include: { company: true } });
    if (!user || !user.active) throw createError('Credenciais inválidas', 401);

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw createError('Credenciais inválidas', 401);

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, companyId: user.companyId },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    await prisma.auditLog.create({
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
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { company: true },
    });
    if (!user) throw createError('Usuário não encontrado', 404);
    const { password: _p, ...userData } = user;
    res.json({ success: true, user: userData });
  } catch (err) {
    next(err);
  }
});

authRouter.put('/change-password', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw createError('Usuário não encontrado', 404);

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw createError('Senha atual incorreta');

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });

    res.json({ success: true, message: 'Senha alterada com sucesso' });
  } catch (err) {
    next(err);
  }
});
