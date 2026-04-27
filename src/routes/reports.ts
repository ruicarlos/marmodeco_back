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

// ─── Sales analytics ─────────────────────────────────────────────────────────

/** Build a Prisma `createdAt` filter from optional ISO date strings. */
function dateRange(startDate?: string, endDate?: string) {
  if (!startDate && !endDate) return undefined;
  const f: { gte?: Date; lte?: Date } = {};
  if (startDate) f.gte = new Date(startDate + 'T00:00:00.000Z');
  if (endDate)   f.lte = new Date(endDate   + 'T23:59:59.999Z');
  return f;
}

reportsRouter.get('/sales/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user  = req.user!;
    const { startDate, endDate } = req.query as Record<string, string>;
    const dr    = dateRange(startDate, endDate);
    const base  = { ...(user.role !== 'ADMIN' && { userId: user.id }), ...(dr && { createdAt: dr }) };
    const bBase = { ...(user.role !== 'ADMIN' && { userId: user.id }), ...(dr && { createdAt: dr }) };

    const [totalSales, paidSales, pendingSales, budgetPipeline] = await Promise.all([
      prisma.sale.aggregate({ where: base, _sum: { totalAmount: true }, _count: true }),
      prisma.sale.aggregate({ where: { ...base, status: 'PAID' },    _sum: { totalAmount: true }, _count: true }),
      prisma.sale.aggregate({ where: { ...base, status: 'PENDING' }, _sum: { totalAmount: true }, _count: true }),
      prisma.budget.groupBy({ by: ['status'], where: bBase, _count: true, _sum: { totalCost: true } }),
    ]);

    res.json({
      success: true,
      data: {
        totalSalesAmount: totalSales._sum.totalAmount   || 0,
        totalSalesCount:  totalSales._count             || 0,
        paidAmount:       paidSales._sum.totalAmount    || 0,
        paidCount:        paidSales._count              || 0,
        pendingAmount:    pendingSales._sum.totalAmount || 0,
        pendingCount:     pendingSales._count           || 0,
        budgetPipeline,
      },
    });
  } catch (err) { next(err); }
});

reportsRouter.get('/sales/by-client', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user  = req.user!;
    const { startDate, endDate } = req.query as Record<string, string>;
    const dr    = dateRange(startDate, endDate);
    const where = {
      ...(user.role !== 'ADMIN' && { userId: user.id }),
      ...(dr && { createdAt: dr }),
    };

    const sales = await prisma.sale.findMany({
      where,
      include: {
        budget: { include: { project: { select: { clientName: true } } } },
      },
    });

    const grouped: Record<string, { clientName: string; count: number; total: number; paid: number; pending: number }> = {};
    for (const s of sales) {
      const name = s.clientName || s.budget?.project?.clientName || 'Não informado';
      if (!grouped[name]) grouped[name] = { clientName: name, count: 0, total: 0, paid: 0, pending: 0 };
      grouped[name].count++;
      grouped[name].total += s.totalAmount;
      if (s.status === 'PAID') grouped[name].paid    += s.totalAmount;
      else                     grouped[name].pending += s.totalAmount;
    }

    res.json({ success: true, data: Object.values(grouped).sort((a, b) => b.total - a.total) });
  } catch (err) { next(err); }
});

reportsRouter.get('/sales/pipeline', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user  = req.user!;
    const { startDate, endDate } = req.query as Record<string, string>;
    const dr     = dateRange(startDate, endDate);
    const bWhere = {
      ...(user.role !== 'ADMIN' && { userId: user.id }),
      ...(dr && { createdAt: dr }),
    };

    const stages = await prisma.budget.groupBy({
      by: ['status'], where: bWhere, _count: true, _sum: { totalCost: true },
    });

    const result = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'].map(s => {
      const f = stages.find(st => st.status === s);
      return { status: s, count: f?._count || 0, total: f?._sum?.totalCost || 0 };
    });

    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

reportsRouter.get('/sales/abc', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user  = req.user!;
    const { startDate, endDate } = req.query as Record<string, string>;
    const dr     = dateRange(startDate, endDate);
    const bWhere = {
      ...(user.role !== 'ADMIN' && { userId: user.id }),
      status: 'APPROVED',
      ...(dr && { createdAt: dr }),
    };

    const items = await prisma.budgetItem.findMany({
      where: { budget: bWhere },
      include: { material: { select: { name: true, type: true } } },
    });

    const map: Record<string, { name: string; type: string; revenue: number; area: number; count: number }> = {};
    for (const item of items) {
      const k = item.materialId;
      if (!map[k]) map[k] = { name: item.material.name, type: item.material.type, revenue: 0, area: 0, count: 0 };
      map[k].revenue += item.subtotal;
      map[k].area    += item.area;
      map[k].count++;
    }

    const sorted = Object.values(map).sort((a, b) => b.revenue - a.revenue);
    const totalRevenue = sorted.reduce((s, m) => s + m.revenue, 0);
    let cumulative = 0;
    const result = sorted.map(m => {
      cumulative += m.revenue;
      const cumPct = totalRevenue > 0 ? (cumulative / totalRevenue) * 100 : 0;
      return { ...m, revenuePct: totalRevenue > 0 ? (m.revenue / totalRevenue) * 100 : 0, cumPct, curve: cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C' };
    });

    res.json({ success: true, data: result, totalRevenue });
  } catch (err) { next(err); }
});

// ─── Stock report ─────────────────────────────────────────────────────────────

reportsRouter.get('/stock', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user  = req.user!;
    const { startDate, endDate } = req.query as Record<string, string>;
    const dr     = dateRange(startDate, endDate);
    const bWhere = {
      ...(user.role !== 'ADMIN' && { userId: user.id }),
      ...(dr && { createdAt: dr }),
    };

    // All materials (active and inactive for full visibility)
    const materials = await prisma.material.findMany({
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });

    // Area consumed in APPROVED budgets in the date range
    const approvedItems = await prisma.budgetItem.findMany({
      where: { budget: { ...bWhere, status: 'APPROVED' } },
      select: { materialId: true, area: true, subtotal: true },
    });

    // Area quoted (all statuses except REJECTED) in the date range
    const quotedItems = await prisma.budgetItem.findMany({
      where: { budget: { ...bWhere, status: { not: 'REJECTED' } } },
      select: { materialId: true, area: true },
    });

    // Build consumption maps
    const consumed: Record<string, { area: number; revenue: number }> = {};
    for (const i of approvedItems) {
      if (!consumed[i.materialId]) consumed[i.materialId] = { area: 0, revenue: 0 };
      consumed[i.materialId].area    += i.area;
      consumed[i.materialId].revenue += i.subtotal;
    }

    const quoted: Record<string, number> = {};
    for (const i of quotedItems) {
      quoted[i.materialId] = (quoted[i.materialId] || 0) + i.area;
    }

    const result = materials.map(m => {
      const consumedArea  = consumed[m.id]?.area    || 0;
      const consumedRev   = consumed[m.id]?.revenue || 0;
      const quotedArea    = quoted[m.id]            || 0;
      const remaining     = Math.max(m.stock - consumedArea, 0);
      const stockPct      = m.stock > 0 ? (remaining / m.stock) * 100 : null;
      const status        = m.stock === 0          ? 'NO_STOCK'
                          : stockPct! <= 0         ? 'OUT'
                          : stockPct! <= 20        ? 'CRITICAL'
                          : stockPct! <= 50        ? 'LOW'
                          :                          'OK';
      return {
        id:           m.id,
        name:         m.name,
        type:         m.type,
        color:        m.color,
        finish:       m.finish,
        supplier:     m.supplier,
        pricePerM2:   m.pricePerM2,
        stock:        m.stock,
        consumedArea,
        consumedRev,
        quotedArea,
        remaining,
        stockPct,
        status,
        active:       m.active,
      };
    });

    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ─── PDF helpers ─────────────────────────────────────────────────────────────
const NAVY  = '#1a2e5a';
const GOLD  = '#b8935a';
const GRAY  = '#64748b';
const LIGHT = '#f8fafc';
const PAGE_W = 595.28;
const MARGIN = 45;
const CONTENT_W = PAGE_W - MARGIN * 2;

const TYPE_PT: Record<string, string> = {
  MARBLE: 'Mármore', GRANITE: 'Granito', QUARTZITE: 'Quartzito', OTHER: 'Outro',
};
const FINISH_PT: Record<string, string> = {
  POLISHED: 'Polido', BRUSHED: 'Escovado', HONED: 'Amaciado', NATURAL: 'Natural',
};
const STATUS_PT: Record<string, string> = {
  DRAFT: 'Rascunho', PENDING: 'Pendente', APPROVED: 'Aprovado', REJECTED: 'Rejeitado',
};

function brl(n: number) {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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

    const doc = new PDFDocument({ margin: MARGIN, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="orcamento-${budget.id}.pdf"`);
    doc.pipe(res);

    // ── Page background ───────────────────────────────────────────────────────
    doc.rect(0, 0, PAGE_W, 110).fill(NAVY);

    // ── Brand header ──────────────────────────────────────────────────────────
    doc.fontSize(26).fillColor('white').font('Helvetica-Bold')
      .text('MARMODECOR', MARGIN, 28, { align: 'left' });
    doc.fontSize(9).fillColor('#94a3b8').font('Helvetica')
      .text('Orçamentação de Mármores e Granitos', MARGIN, 58);

    // Quote number / status badge
    const statusLabel = STATUS_PT[budget.status] ?? budget.status;
    doc.fontSize(9).fillColor(GOLD).font('Helvetica-Bold')
      .text(`Orçamento #${budget.id.substring(0, 8).toUpperCase()}`, MARGIN, 80);

    // ── Info strip ─────────────────────────────────────────────────────────────
    const infoY = 120;
    doc.rect(MARGIN, infoY, CONTENT_W, 60).fill(LIGHT).stroke('#e2e8f0');

    const col = CONTENT_W / 4;
    const infoItems = [
      { label: 'PROJETO', value: budget.project.name },
      { label: 'CLIENTE', value: budget.project.clientName || '—' },
      { label: 'EMITIDO EM', value: new Date(budget.createdAt).toLocaleDateString('pt-BR') },
      { label: 'VALIDADE', value: budget.validUntil ? new Date(budget.validUntil).toLocaleDateString('pt-BR') : '—' },
    ];
    infoItems.forEach((item, i) => {
      const x = MARGIN + i * col + 8;
      doc.fontSize(7).fillColor(GRAY).font('Helvetica').text(item.label, x, infoY + 10, { width: col - 10 });
      doc.fontSize(9).fillColor(NAVY).font('Helvetica-Bold').text(item.value, x, infoY + 23, { width: col - 10 });
    });

    // Status pill
    const statusColor = budget.status === 'APPROVED' ? '#16a34a'
      : budget.status === 'REJECTED' ? '#dc2626'
      : budget.status === 'PENDING' ? '#d97706' : GRAY;
    doc.roundedRect(PAGE_W - MARGIN - 70, infoY + 36, 70, 16, 4).fill(statusColor);
    doc.fontSize(8).fillColor('white').font('Helvetica-Bold')
      .text(statusLabel, PAGE_W - MARGIN - 70, infoY + 41, { width: 70, align: 'center' });

    // ── Section title ─────────────────────────────────────────────────────────
    let y = infoY + 76;
    doc.fontSize(11).fillColor(NAVY).font('Helvetica-Bold').text('DETALHAMENTO POR AMBIENTE', MARGIN, y);
    doc.moveTo(MARGIN, y + 16).lineTo(MARGIN + CONTENT_W, y + 16).lineWidth(1.5).strokeColor(GOLD).stroke();
    y += 24;

    // ── Table header ──────────────────────────────────────────────────────────
    const cols = { mat: 190, tipo: 70, acab: 65, area: 55, preco: 60, sub: 65 };
    const drawTableHeader = (startY: number) => {
      doc.rect(MARGIN, startY, CONTENT_W, 18).fill(NAVY);
      doc.fontSize(7.5).fillColor('white').font('Helvetica-Bold');
      let x = MARGIN + 4;
      doc.text('MATERIAL', x, startY + 5, { width: cols.mat });
      x += cols.mat;
      doc.text('TIPO', x, startY + 5, { width: cols.tipo });
      x += cols.tipo;
      doc.text('ACABAMENTO', x, startY + 5, { width: cols.acab });
      x += cols.acab;
      doc.text('ÁREA (m²)', x, startY + 5, { width: cols.area, align: 'right' });
      x += cols.area;
      doc.text('R$/m²', x, startY + 5, { width: cols.preco, align: 'right' });
      x += cols.preco;
      doc.text('SUBTOTAL', x, startY + 5, { width: cols.sub - 4, align: 'right' });
      return startY + 18;
    };

    y = drawTableHeader(y);

    // Group items by room
    const roomGroups: Record<string, typeof budget.items> = {};
    for (const item of budget.items) {
      const key = item.room.name;
      if (!roomGroups[key]) roomGroups[key] = [];
      roomGroups[key].push(item);
    }

    let rowColor = false;
    for (const [roomName, items] of Object.entries(roomGroups)) {
      // Check page space
      if (y > 730) {
        doc.addPage();
        doc.rect(0, 0, PAGE_W, 36).fill(NAVY);
        doc.fontSize(9).fillColor('white').font('Helvetica').text('MARMODECOR — continuação', MARGIN, 14);
        y = 50;
        y = drawTableHeader(y);
      }

      // Room header row
      const roomArea = items.reduce((s, i) => s + i.area, 0);
      const roomTotal = items.reduce((s, i) => s + i.subtotal, 0);
      doc.rect(MARGIN, y, CONTENT_W, 16).fill('#e8edf5');
      doc.fontSize(8).fillColor(NAVY).font('Helvetica-Bold')
        .text(`  ${roomName}`, MARGIN + 4, y + 4, { width: cols.mat + cols.tipo + cols.acab + cols.area - 8 });
      doc.text(`${roomArea.toFixed(2)} m²  →  ${brl(roomTotal)}`,
        MARGIN + cols.mat + cols.tipo + cols.acab + cols.area, y + 4,
        { width: cols.preco + cols.sub - 4, align: 'right' });
      y += 16;

      // Item rows
      for (const item of items) {
        if (y > 740) {
          doc.addPage();
          doc.rect(0, 0, PAGE_W, 36).fill(NAVY);
          doc.fontSize(9).fillColor('white').font('Helvetica').text('MARMODECOR — continuação', MARGIN, 14);
          y = 50;
          y = drawTableHeader(y);
        }

        const bg = rowColor ? '#f8fafc' : 'white';
        rowColor = !rowColor;
        doc.rect(MARGIN, y, CONTENT_W, 18).fill(bg);
        doc.fontSize(8.5).fillColor('#1e293b').font('Helvetica');

        let x = MARGIN + 4;
        doc.text(item.material.name, x, y + 5, { width: cols.mat - 4 });
        x += cols.mat;
        doc.text(TYPE_PT[item.material.type] ?? item.material.type, x, y + 5, { width: cols.tipo - 4 });
        x += cols.tipo;
        doc.text(FINISH_PT[item.material.finish ?? ''] ?? (item.material.finish ?? '—'), x, y + 5, { width: cols.acab - 4 });
        x += cols.acab;
        doc.text(item.area.toFixed(2), x, y + 5, { width: cols.area - 4, align: 'right' });
        x += cols.area;
        doc.text(item.unitPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), x, y + 5, { width: cols.preco - 4, align: 'right' });
        x += cols.preco;
        doc.font('Helvetica-Bold')
          .text(item.subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), x, y + 5, { width: cols.sub - 8, align: 'right' });

        // thin bottom border
        doc.moveTo(MARGIN, y + 18).lineTo(MARGIN + CONTENT_W, y + 18)
          .lineWidth(0.3).strokeColor('#e2e8f0').stroke();
        y += 18;
      }
      y += 4;
    }

    // ── Financial summary ─────────────────────────────────────────────────────
    y += 8;
    if (y > 680) { doc.addPage(); y = 60; }

    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).lineWidth(1).strokeColor('#e2e8f0').stroke();
    y += 12;

    const materialsCost = budget.totalCost - budget.laborCost - budget.extraCost + budget.discount;
    const summaryLines: [string, number][] = [
      ['Materiais', materialsCost],
    ];
    if (budget.laborCost) summaryLines.push(['Mão de Obra', budget.laborCost]);
    if (budget.extraCost) summaryLines.push(['Custos Extras', budget.extraCost]);
    if (budget.discount)  summaryLines.push(['Desconto', -budget.discount]);

    for (const [label, value] of summaryLines) {
      doc.fontSize(9).fillColor(GRAY).font('Helvetica')
        .text(label, PAGE_W - MARGIN - 220, y, { width: 140, align: 'right' });
      doc.fillColor(value < 0 ? '#dc2626' : '#1e293b').font('Helvetica-Bold')
        .text((value < 0 ? '−' : '') + brl(Math.abs(value)), PAGE_W - MARGIN - 80, y, { width: 80, align: 'right' });
      y += 16;
    }

    // Total box
    y += 4;
    doc.rect(PAGE_W - MARGIN - 210, y, 210, 36).fill(NAVY);
    doc.fontSize(10).fillColor('#94a3b8').font('Helvetica')
      .text('TOTAL GERAL', PAGE_W - MARGIN - 206, y + 6, { width: 100 });
    doc.fontSize(16).fillColor('white').font('Helvetica-Bold')
      .text(brl(budget.totalCost), PAGE_W - MARGIN - 90, y + 4, { width: 86, align: 'right' });

    // Area tag
    doc.fontSize(8.5).fillColor(GRAY).font('Helvetica')
      .text(`Área total: ${budget.totalArea.toFixed(2)} m²`, MARGIN, y + 12);

    // Notes
    if (budget.notes) {
      y += 50;
      doc.rect(MARGIN, y, CONTENT_W, 1).fill(GOLD);
      y += 8;
      doc.fontSize(9).fillColor(GRAY).font('Helvetica-Bold').text('OBSERVAÇÕES', MARGIN, y);
      y += 14;
      doc.fontSize(9).fillColor('#475569').font('Helvetica').text(budget.notes, MARGIN, y, { width: CONTENT_W });
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = 810;
    doc.moveTo(MARGIN, footerY).lineTo(PAGE_W - MARGIN, footerY).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
    doc.fontSize(7.5).fillColor(GRAY).font('Helvetica')
      .text(`Emitido por ${budget.user.name} em ${new Date().toLocaleDateString('pt-BR')}`, MARGIN, footerY + 6)
      .text('MARMODECOR — Sistema de Orçamentação', PAGE_W - MARGIN - 200, footerY + 6, { width: 200, align: 'right' });

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
