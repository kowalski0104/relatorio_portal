"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const credoresConsulth = ['Banco Atlântico', 'Crédito Solar', 'Capital Norte', 'Fomento Sul'];
const credoresSisth = ['Vértice Financeira', 'Aurora Bank', 'Polo Investimentos'];
const negociadores = ['Marina Souza', 'Carlos Pereira', 'Júlia Almeida', 'Rafael Costa', 'Beatriz Lima', 'Diego Ramos'];
function pad(n) {
    return String(n).padStart(2, '0');
}
function mulberry32(seed) {
    return function () {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function rand(rng, min, max) {
    return rng() * (max - min) + min;
}
async function main() {
    await prisma.acesso.deleteMany();
    await prisma.acordo.deleteMany();
    await prisma.baixa.deleteMany();
    const periods = [
        { year: 2026, month: 2, days: 28 },
        { year: 2026, month: 3, days: 31 },
        { year: 2026, month: 4, days: 30 },
    ];
    const baixas = [];
    const acordos = [];
    const acessos = [];
    const rng = mulberry32(20260508);
    periods.forEach(({ year, month, days }) => {
        const baseFactor = month === 3 ? 1.15 : month === 4 ? 0.92 : 1;
        const nBaixasC = Math.round(35 * baseFactor);
        const nBaixasS = Math.round(28 * baseFactor);
        const nAcordosC = Math.round(48 * baseFactor);
        const nAcordosS = Math.round(36 * baseFactor);
        const nAcessosC = Math.round(420 * baseFactor);
        const nAcessosS = Math.round(310 * baseFactor);
        for (let i = 0; i < nBaixasC + nBaixasS; i++) {
            const isConsulth = i < nBaixasC;
            const empresa = isConsulth ? 401 : 1007;
            const credor = isConsulth
                ? credoresConsulth[Math.floor(rng() * credoresConsulth.length)]
                : credoresSisth[Math.floor(rng() * credoresSisth.length)];
            const day = Math.max(1, Math.min(days, Math.floor(rand(rng, 1, days + 1))));
            const capital = Math.round(rand(rng, 800, 12000) * 100) / 100;
            const juros = Math.round(capital * rand(rng, 0.05, 0.18) * 100) / 100;
            const multa = Math.round(capital * rand(rng, 0.02, 0.08) * 100) / 100;
            const honorarios = Math.round((capital + juros + multa) * rand(rng, 0.08, 0.16) * 100) / 100;
            baixas.push({
                data: new Date(`${year}-${pad(month)}-${pad(day)}T00:00:00Z`),
                idempresa: empresa,
                credor,
                capital_pago: capital,
                juros_pago: juros,
                multa_pago: multa,
                honorarios_pago_portal: honorarios,
                total_pago_portal: Math.round((capital + juros + multa + honorarios) * 100) / 100,
                negociador: negociadores[Math.floor(rng() * negociadores.length)],
            });
        }
        for (let i = 0; i < nAcordosC + nAcordosS; i++) {
            const isConsulth = i < nAcordosC;
            const empresa = isConsulth ? 401 : 1007;
            const credor = isConsulth
                ? credoresConsulth[Math.floor(rng() * credoresConsulth.length)]
                : credoresSisth[Math.floor(rng() * credoresSisth.length)];
            const day = Math.max(1, Math.min(days, Math.floor(rand(rng, 1, days + 1))));
            acordos.push({
                data: new Date(`${year}-${pad(month)}-${pad(day)}T00:00:00Z`),
                idempresa: empresa,
                credor,
                tot_sub_total: Math.round(rand(rng, 1500, 18000) * 100) / 100,
            });
        }
        for (let i = 0; i < nAcessosC + nAcessosS; i++) {
            const isConsulth = i < nAcessosC;
            const empresa = isConsulth ? 401 : 1007;
            const day = Math.max(1, Math.min(days, Math.floor(rand(rng, 1, days + 1))));
            const comAcordo = rng() < 0.18;
            const credor = comAcordo
                ? isConsulth
                    ? credoresConsulth[Math.floor(rng() * credoresConsulth.length)]
                    : credoresSisth[Math.floor(rng() * credoresSisth.length)]
                : null;
            acessos.push({
                data: new Date(`${year}-${pad(month)}-${pad(day)}T00:00:00Z`),
                idempresa: empresa,
                credor,
                situacao: comAcordo ? 'COM_ACORDO' : 'SEM_ACORDO',
            });
        }
    });
    await prisma.baixa.createMany({ data: baixas });
    await prisma.acordo.createMany({ data: acordos });
    await prisma.acesso.createMany({ data: acessos });
    console.log(`Seed concluída: ${baixas.length} baixas, ${acordos.length} acordos, ${acessos.length} acessos.`);
}
main()
    .catch((error) => {
    console.error(error);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map