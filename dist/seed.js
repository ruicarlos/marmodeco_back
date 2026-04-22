"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('🌱 Seeding database...');
    // Create demo company
    const company = await prisma.company.upsert({
        where: { cnpj: '53.184.633/0001-63' },
        update: {},
        create: {
            name: 'BMAAR Propriedades',
            cnpj: '53.184.633/0001-63',
            email: 'contato@domluxury.com.br',
            phone: '(85) 8781-1290',
            address: 'Av. Washington Soares, 3663, Edson Queiroz, Fortaleza/CE',
            plan: 'ENTERPRISE',
        },
    });
    // Create admin user
    const adminPass = await bcryptjs_1.default.hash('admin123', 12);
    await prisma.user.upsert({
        where: { email: 'admin@marmodecor.com.br' },
        update: {},
        create: {
            name: 'Administrador',
            email: 'admin@marmodecor.com.br',
            password: adminPass,
            role: 'ADMIN',
            companyId: company.id,
        },
    });
    // Create gestor user
    const gestorPass = await bcryptjs_1.default.hash('gestor123', 12);
    await prisma.user.upsert({
        where: { email: 'gestor@marmodecor.com.br' },
        update: {},
        create: {
            name: 'Ivanez Dantas',
            email: 'gestor@marmodecor.com.br',
            password: gestorPass,
            role: 'GESTOR',
            companyId: company.id,
        },
    });
    // Create materials catalog
    const materials = [
        { name: 'Mármore Branco Carrara', type: 'MARBLE', color: 'Branco', finish: 'POLISHED', thickness: 2.0, pricePerM2: 380.00, supplier: 'Marmaria CE' },
        { name: 'Mármore Crema Marfil', type: 'MARBLE', color: 'Bege', finish: 'POLISHED', thickness: 2.0, pricePerM2: 290.00, supplier: 'Marmaria CE' },
        { name: 'Mármore Nero Marquina', type: 'MARBLE', color: 'Preto', finish: 'POLISHED', thickness: 2.0, pricePerM2: 420.00, supplier: 'Granitos Nordeste' },
        { name: 'Granito Cinza Andorinha', type: 'GRANITE', color: 'Cinza', finish: 'POLISHED', thickness: 2.0, pricePerM2: 180.00, supplier: 'Granitos Nordeste' },
        { name: 'Granito Preto Absoluto', type: 'GRANITE', color: 'Preto', finish: 'POLISHED', thickness: 2.0, pricePerM2: 220.00, supplier: 'Granitos Nordeste' },
        { name: 'Granito Verde Ubatuba', type: 'GRANITE', color: 'Verde', finish: 'POLISHED', thickness: 2.0, pricePerM2: 195.00, supplier: 'Pedreiras Sul' },
        { name: 'Granito Amarelo Ornamental', type: 'GRANITE', color: 'Amarelo', finish: 'POLISHED', thickness: 2.0, pricePerM2: 165.00, supplier: 'Pedreiras Sul' },
        { name: 'Quartizito Taj Mahal', type: 'QUARTZITE', color: 'Bege/Dourado', finish: 'POLISHED', thickness: 2.0, pricePerM2: 650.00, supplier: 'Premium Stones' },
        { name: 'Quartizito Fantasy Brown', type: 'QUARTZITE', color: 'Marrom', finish: 'POLISHED', thickness: 2.0, pricePerM2: 520.00, supplier: 'Premium Stones' },
        { name: 'Mármore Statuario', type: 'MARBLE', color: 'Branco/Cinza', finish: 'POLISHED', thickness: 2.0, pricePerM2: 680.00, supplier: 'Importados BR' },
        { name: 'Granito Branco Siena', type: 'GRANITE', color: 'Branco', finish: 'POLISHED', thickness: 2.0, pricePerM2: 210.00, supplier: 'Granitos Nordeste' },
        { name: 'Mármore Travertino', type: 'MARBLE', color: 'Bege/Marrom', finish: 'HONED', thickness: 2.0, pricePerM2: 310.00, supplier: 'Marmaria CE' },
    ];
    for (const mat of materials) {
        await prisma.material.upsert({
            where: { id: `${mat.type}-${mat.name}`.toLowerCase().replace(/\s/g, '-').substring(0, 36) },
            update: { pricePerM2: mat.pricePerM2 },
            create: { ...mat, id: `${mat.type}-${mat.name}`.toLowerCase().replace(/\s/g, '-').substring(0, 36) },
        });
    }
    // Create subscription plans
    const plans = [
        {
            name: 'Básico',
            code: 'BASIC',
            price: 199.90,
            maxUsers: 3,
            maxProjects: 20,
            maxStorage: 5,
            features: JSON.stringify(['Importação de PDF', 'Orçamentos básicos', 'Exportação PDF', 'Suporte por email']),
        },
        {
            name: 'Profissional',
            code: 'PRO',
            price: 499.90,
            maxUsers: 10,
            maxProjects: 100,
            maxStorage: 20,
            features: JSON.stringify(['Tudo do Básico', 'IA para detecção de áreas', 'Simulação de materiais', 'Exportação Excel', 'Dashboard avançado', 'Suporte prioritário']),
        },
        {
            name: 'Empresarial',
            code: 'ENTERPRISE',
            price: 999.90,
            maxUsers: -1,
            maxProjects: -1,
            maxStorage: 100,
            features: JSON.stringify(['Tudo do Profissional', 'Usuários ilimitados', 'Projetos ilimitados', 'Integrações ERP/CRM', 'API dedicada', 'Suporte 24/7', 'Gerente de conta']),
        },
    ];
    for (const plan of plans) {
        await prisma.subscriptionPlan.upsert({
            where: { code: plan.code },
            update: { price: plan.price },
            create: plan,
        });
    }
    console.log('✅ Seed completed!');
    console.log('');
    console.log('Credenciais de acesso:');
    console.log('  Admin: admin@marmodecor.com.br / admin123');
    console.log('  Gestor: gestor@marmodecor.com.br / gestor123');
}
main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=seed.js.map