import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

// ─── DXF R12 generator ───────────────────────────────────────────────────────

type DXFRoom = { name: string; area: number; perimeter: number; notes: string | null };

function buildProjectDXF(project: { name: string; clientName: string | null; rooms: DXFRoom[] }): string {
  const lines: string[] = [];

  const emit = (code: number, value: string | number) => {
    lines.push(String(code), String(value));
  };

  const emitLine = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
    emit(0, 'LINE');
    emit(8, layer);
    emit(10, x1.toFixed(6)); emit(20, y1.toFixed(6)); emit(30, '0.000000');
    emit(11, x2.toFixed(6)); emit(21, y2.toFixed(6)); emit(31, '0.000000');
  };

  const emitText = (layer: string, x: number, y: number, height: number, text: string) => {
    emit(0, 'TEXT');
    emit(8, layer);
    emit(10, x.toFixed(6)); emit(20, y.toFixed(6)); emit(30, '0.000000');
    emit(40, height.toFixed(6));
    emit(1, text);
  };

  // HEADER
  emit(0, 'SECTION'); emit(2, 'HEADER');
  emit(9, '$ACADVER'); emit(1, 'AC1009');
  emit(9, '$INSUNITS'); emit(70, 6);   // Meters
  emit(9, '$MEASUREMENT'); emit(70, 1); // Metric
  emit(0, 'ENDSEC');

  // TABLES — layer definitions
  emit(0, 'SECTION'); emit(2, 'TABLES');
  emit(0, 'TABLE'); emit(2, 'LAYER'); emit(70, 3);
  for (const [name, color] of [['0', 7], ['ROOMS', 5], ['LABELS', 3]] as [string, number][]) {
    emit(0, 'LAYER'); emit(2, name); emit(70, 0); emit(62, color); emit(6, 'CONTINUOUS');
  }
  emit(0, 'ENDTAB');
  emit(0, 'ENDSEC');

  // ENTITIES
  emit(0, 'SECTION'); emit(2, 'ENTITIES');

  // Title block
  emitText('0', 0, 3.0, 0.5, 'MARMODECOR');
  emitText('0', 0, 2.3, 0.28, `Projeto: ${project.name}`);
  if (project.clientName) emitText('0', 0, 1.9, 0.22, `Cliente: ${project.clientName}`);
  emitText('0', 0, 1.5, 0.18, `Exportado em: ${new Date().toLocaleDateString('pt-BR')}`);
  emitLine('0', 0, 1.1, 30, 1.1); // separator

  // Room layout
  const { rooms } = project;
  if (rooms.length > 0) {
    const COLS = Math.max(1, Math.ceil(Math.sqrt(rooms.length)));
    const GAP = 1.0;
    const TITLE_BOTTOM = 0.8; // Y start (below separator)

    // Derive rectangle dimensions from area + perimeter
    const dims = rooms.map(r => {
      const area = Math.max(r.area, 0.01);
      const half = r.perimeter / 2;
      let w: number, h: number;
      if (r.perimeter > 0) {
        const disc = half * half - 4 * area;
        if (disc >= 0) {
          w = (half + Math.sqrt(disc)) / 2;
          h = area / w;
        } else {
          w = h = Math.sqrt(area);
        }
      } else {
        w = h = Math.sqrt(area);
      }
      return { w: Math.max(w, 0.5), h: Math.max(h, 0.5) };
    });

    // Column widths and row heights
    const numRows = Math.ceil(rooms.length / COLS);
    const colWidths = Array.from({ length: COLS }, (_, c) =>
      Math.max(...Array.from({ length: numRows }, (_, r) => {
        const idx = r * COLS + c;
        return idx < rooms.length ? dims[idx].w : 0;
      }))
    );
    const rowHeights = Array.from({ length: numRows }, (_, r) =>
      Math.max(...Array.from({ length: COLS }, (_, c) => {
        const idx = r * COLS + c;
        return idx < rooms.length ? dims[idx].h : 0;
      }))
    );

    // Cumulative column/row offsets
    const colX = colWidths.reduce<number[]>((acc, w, i) => [...acc, (acc[i] ?? 0) + (i > 0 ? colWidths[i - 1] + GAP : 0)], [0]).slice(0, COLS);
    const rowY = rowHeights.reduce<number[]>((acc, h, i) => [...acc, (acc[i] ?? 0) + (i > 0 ? rowHeights[i - 1] + GAP + 0.7 : 0)], [0]).slice(0, numRows);

    rooms.forEach((room, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const { w, h } = dims[i];
      const x1 = colX[col];
      const y1 = -(TITLE_BOTTOM + rowY[row]);
      const x2 = x1 + w;
      const y2 = y1 - h;

      // Rectangle
      emitLine('ROOMS', x1, y1, x2, y1);
      emitLine('ROOMS', x2, y1, x2, y2);
      emitLine('ROOMS', x2, y2, x1, y2);
      emitLine('ROOMS', x1, y2, x1, y1);

      // Labels inside rectangle
      const lx = x1 + 0.1;
      emitText('LABELS', lx, y1 - 0.28, 0.2, room.name);
      emitText('LABELS', lx, y1 - 0.56, 0.14, `Área: ${room.area.toFixed(2)} m²`);
      if (room.perimeter > 0) emitText('LABELS', lx, y1 - 0.76, 0.12, `Perímetro: ${room.perimeter.toFixed(2)} m`);
      if (room.notes) emitText('LABELS', lx, y1 - 0.96, 0.11, room.notes);
    });
  }

  emit(0, 'ENDSEC');
  emit(0, 'EOF');

  return lines.join('\n');
}

export const reportsRouter = Router();
reportsRouter.use(authenticate);

// Dashboard stats
reportsRouter.get('/dashboard', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const isAdmin = req.user!.role === 'ADMIN';
    const userFilter = isAdmin ? {} : { userId: req.user!.id };

    const [totalProjects, totalBudgets, totalMaterials, recentProjects, recentBudgets] = await Promise.all([
      prisma.project.count({ where: userFilter }),
      prisma.budget.count({ where: userFilter }),
      prisma.material.count({ where: { active: true } }),
      prisma.project.findMany({
        where: userFilter,
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, status: true, clientName: true, createdAt: true },
      }),
      prisma.budget.findMany({
        where: userFilter,
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { project: { select: { name: true } } },
      }),
    ]);

    const budgetStats = await prisma.budget.aggregate({
      where: userFilter,
      _sum: { totalCost: true, totalArea: true },
      _avg: { totalCost: true },
    });

    const statusCounts = await prisma.budget.groupBy({
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
  } catch (err) { next(err); }
});

// Export budget as PDF
reportsRouter.get('/budgets/:id/pdf', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const where = req.user!.role === 'ADMIN'
      ? { id: req.params.id }
      : { id: req.params.id, userId: req.user!.id };

    const budget = await prisma.budget.findFirst({
      where,
      include: {
        project: true,
        user: { select: { name: true, email: true } },
        items: { include: { room: true, material: true } },
      },
    });
    if (!budget) throw createError('Orçamento não encontrado', 404);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
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
    if (budget.validUntil) doc.text(`Validade: ${new Date(budget.validUntil).toLocaleDateString('pt-BR')}`);
    doc.moveDown();

    // Items table
    doc.fontSize(13).fillColor('#1a1a2e').text('Detalhamento por Ambiente');
    doc.moveDown(0.5);

    const roomGroups: Record<string, typeof budget.items> = {};
    for (const item of budget.items) {
      const key = item.room.name;
      if (!roomGroups[key]) roomGroups[key] = [];
      roomGroups[key].push(item);
    }

    for (const [roomName, items] of Object.entries(roomGroups)) {
      doc.fontSize(11).fillColor('#c8a96e').text(`Ambiente: ${roomName}`);
      doc.fontSize(9).fillColor('#333');

      let roomTotal = 0;
      for (const item of items) {
        const subtotal = item.area * item.unitPrice;
        roomTotal += subtotal;
        doc.text(
          `  ${item.material.name} (${item.material.type}) — ${item.area.toFixed(2)} m² × R$ ${item.unitPrice.toFixed(2)} = R$ ${subtotal.toFixed(2)}`
        );
      }
      doc.fontSize(10).fillColor('#1a1a2e').text(`  Subtotal ${roomName}: R$ ${roomTotal.toFixed(2)}`, { align: 'right' });
      doc.moveDown(0.5);
    }

    doc.strokeColor('#ddd').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    // Totals
    doc.fontSize(11).fillColor('#444');
    doc.text(`Materiais: R$ ${(budget.totalCost - budget.laborCost - budget.extraCost + budget.discount).toFixed(2)}`, { align: 'right' });
    if (budget.laborCost) doc.text(`Mão de obra: R$ ${budget.laborCost.toFixed(2)}`, { align: 'right' });
    if (budget.extraCost) doc.text(`Extras: R$ ${budget.extraCost.toFixed(2)}`, { align: 'right' });
    if (budget.discount) doc.text(`Desconto: -R$ ${budget.discount.toFixed(2)}`, { align: 'right' });
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
  } catch (err) { next(err); }
});

// Export budget as Excel
reportsRouter.get('/budgets/:id/excel', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const where = req.user!.role === 'ADMIN'
      ? { id: req.params.id }
      : { id: req.params.id, userId: req.user!.id };

    const budget = await prisma.budget.findFirst({
      where,
      include: {
        project: true,
        items: { include: { room: true, material: true } },
      },
    });
    if (!budget) throw createError('Orçamento não encontrado', 404);

    const workbook = new ExcelJS.Workbook();
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
  } catch (err) { next(err); }
});

// Export project rooms as DXF
reportsRouter.get('/projects/:id/dxf', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const where = req.user!.role === 'ADMIN'
      ? { id: req.params.id }
      : { id: req.params.id, userId: req.user!.id };

    const project = await prisma.project.findFirst({
      where,
      include: { rooms: { orderBy: { createdAt: 'asc' } } },
    });
    if (!project) throw createError('Projeto não encontrado', 404);

    const dxf = buildProjectDXF(project);
    const filename = `projeto-${project.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.dxf`;

    res.setHeader('Content-Type', 'application/dxf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(dxf);
  } catch (err) { next(err); }
});
