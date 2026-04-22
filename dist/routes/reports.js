"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportsRouter = void 0;
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
const exceljs_1 = __importDefault(require("exceljs"));
const pdfkit_1 = __importDefault(require("pdfkit"));
exports.reportsRouter = (0, express_1.Router)();
exports.reportsRouter.use(auth_1.authenticate);
// Dashboard stats
exports.reportsRouter.get('/dashboard', async (req, res, next) => {
    try {
        const isAdmin = req.user.role === 'ADMIN';
        const userFilter = isAdmin ? {} : { userId: req.user.id };
        const [totalProjects, totalBudgets, totalMaterials, recentProjects, recentBudgets] = await Promise.all([
            prisma_1.prisma.project.count({ where: userFilter }),
            prisma_1.prisma.budget.count({ where: userFilter }),
            prisma_1.prisma.material.count({ where: { active: true } }),
            prisma_1.prisma.project.findMany({
                where: userFilter,
                take: 5,
                orderBy: { createdAt: 'desc' },
                select: { id: true, name: true, status: true, clientName: true, createdAt: true },
            }),
            prisma_1.prisma.budget.findMany({
                where: userFilter,
                take: 5,
                orderBy: { createdAt: 'desc' },
                include: { project: { select: { name: true } } },
            }),
        ]);
        const budgetStats = await prisma_1.prisma.budget.aggregate({
            where: userFilter,
            _sum: { totalCost: true, totalArea: true },
            _avg: { totalCost: true },
        });
        const statusCounts = await prisma_1.prisma.budget.groupBy({
            by: ['status'],
            where: userFilter,
            _count: true,
        });
        res.json({
            success: true,
            data: {
                totalProjects,
                totalBudgets,
                totalMaterials,
                totalRevenue: budgetStats._sum.totalCost || 0,
                totalArea: budgetStats._sum.totalArea || 0,
                avgBudget: budgetStats._avg.totalCost || 0,
                recentProjects,
                recentBudgets,
                statusCounts,
            },
        });
    }
    catch (err) {
        next(err);
    }
});
// Export budget as PDF
exports.reportsRouter.get('/budgets/:id/pdf', async (req, res, next) => {
    try {
        const where = req.user.role === 'ADMIN'
            ? { id: req.params.id }
            : { id: req.params.id, userId: req.user.id };
        const budget = await prisma_1.prisma.budget.findFirst({
            where,
            include: {
                project: true,
                user: { select: { name: true, email: true } },
                items: { include: { room: true, material: true } },
            },
        });
        if (!budget)
            throw (0, errorHandler_1.createError)('Orçamento não encontrado', 404);
        const doc = new pdfkit_1.default({ margin: 50, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="orcamento-${budget.id}.pdf"`);
        doc.pipe(res);
        // Header
        doc.fontSize(20).fillColor('#1a1a2e').text('MARMODECOR', { align: 'center' });
        doc.fontSize(12).fillColor('#666').text('Sistema de Automação de Orçamentação', { align: 'center' });
        doc.moveDown();
        doc.strokeColor('#c8a96e').lineWidth(2).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown();
        // Budget info
        doc.fontSize(16).fillColor('#1a1a2e').text(`Orçamento: ${budget.name}`);
        doc.fontSize(10).fillColor('#444');
        doc.text(`Projeto: ${budget.project.name}`);
        doc.text(`Cliente: ${budget.project.clientName || 'Não informado'}`);
        doc.text(`Responsável: ${budget.user.name}`);
        doc.text(`Data: ${new Date(budget.createdAt).toLocaleDateString('pt-BR')}`);
        doc.text(`Status: ${budget.status}`);
        if (budget.validUntil)
            doc.text(`Validade: ${new Date(budget.validUntil).toLocaleDateString('pt-BR')}`);
        doc.moveDown();
        // Items table
        doc.fontSize(13).fillColor('#1a1a2e').text('Detalhamento por Ambiente');
        doc.moveDown(0.5);
        const roomGroups = {};
        for (const item of budget.items) {
            const key = item.room.name;
            if (!roomGroups[key])
                roomGroups[key] = [];
            roomGroups[key].push(item);
        }
        for (const [roomName, items] of Object.entries(roomGroups)) {
            doc.fontSize(11).fillColor('#c8a96e').text(`Ambiente: ${roomName}`);
            doc.fontSize(9).fillColor('#333');
            let roomTotal = 0;
            for (const item of items) {
                const subtotal = item.area * item.unitPrice;
                roomTotal += subtotal;
                doc.text(`  ${item.material.name} (${item.material.type}) — ${item.area.toFixed(2)} m² × R$ ${item.unitPrice.toFixed(2)} = R$ ${subtotal.toFixed(2)}`);
            }
            doc.fontSize(10).fillColor('#1a1a2e').text(`  Subtotal ${roomName}: R$ ${roomTotal.toFixed(2)}`, { align: 'right' });
            doc.moveDown(0.5);
        }
        doc.strokeColor('#ddd').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.5);
        // Totals
        doc.fontSize(11).fillColor('#444');
        doc.text(`Materiais: R$ ${(budget.totalCost - budget.laborCost - budget.extraCost + budget.discount).toFixed(2)}`, { align: 'right' });
        if (budget.laborCost)
            doc.text(`Mão de obra: R$ ${budget.laborCost.toFixed(2)}`, { align: 'right' });
        if (budget.extraCost)
            doc.text(`Extras: R$ ${budget.extraCost.toFixed(2)}`, { align: 'right' });
        if (budget.discount)
            doc.text(`Desconto: -R$ ${budget.discount.toFixed(2)}`, { align: 'right' });
        doc.moveDown(0.3);
        doc.strokeColor('#c8a96e').lineWidth(1.5).moveTo(400, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.3);
        doc.fontSize(14).fillColor('#1a1a2e').text(`TOTAL: R$ ${budget.totalCost.toFixed(2)}`, { align: 'right' });
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#444').text(`Área total: ${budget.totalArea.toFixed(2)} m²`, { align: 'right' });
        if (budget.notes) {
            doc.moveDown();
            doc.fontSize(10).fillColor('#666').text(`Observações: ${budget.notes}`);
        }
        doc.end();
    }
    catch (err) {
        next(err);
    }
});
// Export budget as Excel
exports.reportsRouter.get('/budgets/:id/excel', async (req, res, next) => {
    try {
        const where = req.user.role === 'ADMIN'
            ? { id: req.params.id }
            : { id: req.params.id, userId: req.user.id };
        const budget = await prisma_1.prisma.budget.findFirst({
            where,
            include: {
                project: true,
                items: { include: { room: true, material: true } },
            },
        });
        if (!budget)
            throw (0, errorHandler_1.createError)('Orçamento não encontrado', 404);
        const workbook = new exceljs_1.default.Workbook();
        workbook.creator = 'MarmoDecor';
        workbook.created = new Date();
        const sheet = workbook.addWorksheet('Orçamento');
        // Title
        sheet.mergeCells('A1:G1');
        sheet.getCell('A1').value = `ORÇAMENTO: ${budget.name}`;
        sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1a1a2e' } };
        sheet.getCell('A1').alignment = { horizontal: 'center' };
        sheet.mergeCells('A2:G2');
        sheet.getCell('A2').value = `Projeto: ${budget.project.name} | Cliente: ${budget.project.clientName || '-'} | Data: ${new Date(budget.createdAt).toLocaleDateString('pt-BR')}`;
        sheet.getCell('A2').font = { size: 10, color: { argb: 'FF666666' } };
        // Headers
        const headerRow = sheet.addRow(['Ambiente', 'Material', 'Tipo', 'Acabamento', 'Área (m²)', 'Preço/m²', 'Subtotal (R$)']);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a1a2e' } };
        headerRow.height = 20;
        sheet.columns = [
            { key: 'room', width: 20 },
            { key: 'material', width: 25 },
            { key: 'type', width: 15 },
            { key: 'finish', width: 15 },
            { key: 'area', width: 12 },
            { key: 'price', width: 14 },
            { key: 'subtotal', width: 16 },
        ];
        for (const item of budget.items) {
            const row = sheet.addRow([
                item.room.name,
                item.material.name,
                item.material.type,
                item.material.finish || '-',
                item.area,
                item.unitPrice,
                item.subtotal,
            ]);
            row.getCell(5).numFmt = '#,##0.00';
            row.getCell(6).numFmt = 'R$ #,##0.00';
            row.getCell(7).numFmt = 'R$ #,##0.00';
        }
        // Totals
        sheet.addRow([]);
        const totalRow = sheet.addRow(['', '', '', '', `Total Área: ${budget.totalArea.toFixed(2)} m²`, '', `R$ ${budget.totalCost.toFixed(2)}`]);
        totalRow.font = { bold: true };
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="orcamento-${budget.id}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=reports.js.map