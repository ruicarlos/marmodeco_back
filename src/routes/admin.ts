import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';

export const adminRouter = Router();
adminRouter.use(authenticate, requireAdmin);

adminRouter.get('/stats', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [users, companies, projects, budgets, materials] = await Promise.all([
      prisma.user.count(),
      prisma.company.count(),
      prisma.project.count(),
      prisma.budget.count(),
      prisma.material.count(),
    ]);
    res.json({ success: true, data: { users, companies, projects, budgets, materials } });
  } catch (err) { next(err); }
});

adminRouter.get('/audit-logs', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(String(req.query.page)) || 1;
    const limit = parseInt(String(req.query.limit)) || 50;
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        skip,
        take: limit,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count(),
    ]);

    res.json({ success: true, data: logs, meta: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

adminRouter.get('/plans', async (_req, res: Response, next: NextFunction) => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({ orderBy: { price: 'asc' } });
    res.json({ success: true, data: plans });
  } catch (err) { next(err); }
});

adminRouter.post('/plans', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, code, price, maxUsers, maxProjects, maxStorage, features } = req.body;
    const plan = await prisma.subscriptionPlan.create({
      data: {
        name, code, price: parseFloat(price),
        maxUsers: parseInt(maxUsers), maxProjects: parseInt(maxProjects),
        maxStorage: parseInt(maxStorage),
        features: typeof features === 'string' ? features : JSON.stringify(features),
      },
    });
    res.status(201).json({ success: true, data: plan });
  } catch (err) { next(err); }
});

adminRouter.put('/plans/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = { ...req.body };
    if (data.price) data.price = parseFloat(data.price);
    if (data.maxUsers) data.maxUsers = parseInt(data.maxUsers);
    if (data.maxProjects) data.maxProjects = parseInt(data.maxProjects);
    if (data.maxStorage) data.maxStorage = parseInt(data.maxStorage);
    if (data.features && typeof data.features !== 'string') data.features = JSON.stringify(data.features);
    const plan = await prisma.subscriptionPlan.update({ where: { id: req.params.id }, data });
    res.json({ success: true, data: plan });
  } catch (err) { next(err); }
});
