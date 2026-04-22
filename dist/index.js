"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const auth_1 = require("./routes/auth");
const users_1 = require("./routes/users");
const companies_1 = require("./routes/companies");
const projects_1 = require("./routes/projects");
const budgets_1 = require("./routes/budgets");
const materials_1 = require("./routes/materials");
const reports_1 = require("./routes/reports");
const admin_1 = require("./routes/admin");
const errorHandler_1 = require("./middleware/errorHandler");
const requestLogger_1 = require("./middleware/requestLogger");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:5173'];
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin))
            return callback(null, true);
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
app.use(requestLogger_1.requestLogger);
// Static uploads
app.use('/uploads', express_1.default.static(path_1.default.join(process.cwd(), 'uploads')));
// Routes
app.use('/api/auth', auth_1.authRouter);
app.use('/api/users', users_1.usersRouter);
app.use('/api/companies', companies_1.companiesRouter);
app.use('/api/projects', projects_1.projectsRouter);
app.use('/api/budgets', budgets_1.budgetsRouter);
app.use('/api/materials', materials_1.materialsRouter);
app.use('/api/reports', reports_1.reportsRouter);
app.use('/api/admin', admin_1.adminRouter);
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'MarmoDecor API', version: '1.0.0' });
});
app.use(errorHandler_1.errorHandler);
app.listen(PORT, () => {
    console.log(`✅ MarmoDecor API running on http://localhost:${PORT}`);
});
exports.default = app;
//# sourceMappingURL=index.js.map