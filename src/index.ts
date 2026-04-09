import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { companiesRouter } from './routes/companies';
import { projectsRouter } from './routes/projects';
import { budgetsRouter } from './routes/budgets';
import { materialsRouter } from './routes/materials';
import { reportsRouter } from './routes/reports';
import { adminRouter } from './routes/admin';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(requestLogger);

// Static uploads
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Routes
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/companies', companiesRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/budgets', budgetsRouter);
app.use('/api/materials', materialsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/admin', adminRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'MarmoDecor API', version: '1.0.0' });
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`✅ MarmoDecor API running on http://localhost:${PORT}`);
});

export default app;
