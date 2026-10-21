// Robô Trade — roda na nuvem (Supabase) a cada 5 minutos.
// Lê o histórico de preços da Binance (dados públicos) e decide compra/venda.
// Carteiras "simulado" só anotam; carteiras "testnet" mandam ordens na Binance Testnet.
import { backtest, backtestBanca, calcularSinais, Candle, Estrategia, ESTRATEGIAS, motivo, TAXA } from "./logica.ts";
import { comprar, temChaves, testarConta, vender } from "./binance.ts";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const CHAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TEMPOS = ["15m", "1h", "4h", "1d"];
const FONTES = ["https://data-api.binance.vision", "https://api.binance.com"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(dados: unknown, status = 200) {
  return new Response(JSON.stringify(dados), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function db(caminho: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_SB}/rest/v1/${caminho}`, {
    ...init,
    headers: {
      apikey: CHAVE,
      Authorization: `Bearer ${CHAVE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation,resolution=merge-duplicates",
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) throw new Error(`Banco: ${r.status} ${await r.text()}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

// Busca candles; devolve fechados + preço atual
async function candles(par: string, tempo: string, quantidade = 1000) {
  let ultimoErro = "";
  for (const base of FONTES) {
    try {
      // A Binance entrega no máximo 1000 velas por vez: busca em partes, do mais novo para o mais antigo
      let linhas: unknown[][] = [];
      let fim: number | null = null;
      let falhou = false;
      while (linhas.length < quantidade) {
        const lim = Math.min(1000, quantidade - linhas.length);
        const r = await fetch(`${base}/api/v3/klines?symbol=${par}&interval=${tempo}&limit=${lim}${fim ? `&endTime=${fim}` : ""}`);
        if (!r.ok) { ultimoErro = `${base}: ${r.status}`; falhou = true; break; }
        const parte = (await r.json()) as unknown[][];
        if (!parte.length) break;
        linhas = [...parte, ...linhas];
        fim = Number(parte[0][0]) - 1;
        if (parte.length < lim) break;
      }
      if (falhou) continue;
      const agora = Date.now();
      const fechados: Candle[] = [];
      for (const k of linhas) {
        if (Number(k[6]) < agora) fechados.push({ t: Number(k[0]), c: Number(k[4]) });
      }
      const atual = Number(linhas[linhas.length - 1]?.[4]);
      return { fechados, atual };
    } catch (e) {
      ultimoErro = `${base}: ${(e as Error).message}`;
    }
  }
  throw new Error(`Não consegui ler os preços da Binance (${ultimoErro})`);
}

const HORAS: Record<string, number> = { "15m": 0.25, "1h": 1, "4h": 4, "1d": 24 };

async function testarHistorico(par: string, tempo: string, salvar = true, dias = 0) {
  const qtd = dias > 0 ? Math.min(6000, Math.ceil((dias * 24) / HORAS[tempo]) + 50) : 1000;
  const { fechados } = await candles(par, tempo, qtd);
  const resultado: Record<string, unknown> = {};
  for (const e of Object.keys(ESTRATEGIAS) as Estrategia[]) {
    const r = { par, tempo, ...backtest(fechados, e) };
    resultado[e] = r;
    if (salvar) {
      await db("robo_backtest", { method: "POST", body: JSON.stringify({ id: `${e}_${par}_${tempo}`, resultado: r, atualizado_em: new Date().toISOString() }) });
    }
  }
  return resultado;
}

// Quanto essa carteira perdeu hoje (horário de Brasília), em USDT
async function perdaDoDia(carteira: string) {
  const inicio = new Date(Date.now() - 3 * 3600_000);
  inicio.setUTCHours(0, 0, 0, 0);
  const desde = new Date(inicio.getTime() + 3 * 3600_000).toISOString();
  const vendas = await db(`robo_operacoes?carteira=eq.${encodeURIComponent(carteira)}&tipo=eq.venda&em=gte.${desde}&select=valor,resultado_pct`);
  let lucro = 0;
  for (const v of vendas ?? []) {
    if (v.resultado_pct == null) continue;
    const compra = Number(v.valor) / (1 + Number(v.resultado_pct) / 100);
    lucro += Number(v.valor) - compra;
  }
  return lucro < 0 ? -lucro : 0;
}

async function rodar() {
  const carteiras = await db("robo_carteiras?ativo=eq.true&select=*");
  const cache = new Map<string, Awaited<ReturnType<typeof candles>>>();
  const resumo: unknown[] = [];

  for (const c of carteiras) {
    const chave = `${c.par}_${c.tempo}`;
    if (!cache.has(chave)) cache.set(chave, await candles(c.par, c.tempo));
    const { fechados, atual } = cache.get(chave)!;
    if (!fechados.length) continue;

    const fech = fechados.map((k) => k.c);
    const { sinais, ind } = calcularSinais(fech, c.estrategia as Estrategia);
    let caixa = Number(c.caixa), qtd = Number(c.qtd);
    let compraPreco = c.compra_preco != null ? Number(c.compra_preco) : null;
    let compraCaixa = c.compra_caixa != null ? Number(c.compra_caixa) : null;
    let compraEm = c.compra_em;
    const ultimo = fechados[fechados.length - 1].t;
    const novas: Record<string, unknown>[] = [];

    let erro: string | null = null;
    const modo = c.modo ?? "simulado";

    if (modo !== "simulado") {
      // Binance (Testnet): só age na vela que acabou de fechar, nunca no passado
      erro = temChaves(modo);
      const iU = fechados.length - 1;
      if (!erro && c.ultimo_candle != null && fechados[iU].t > Number(c.ultimo_candle)) {
        const s = sinais[iU];
        const quando = new Date().toISOString();
        try {
          if (s === "compra" && qtd === 0 && caixa > 0) {
            const perdaHoje = await perdaDoDia(c.id);
            if (c.limite_perda_dia != null && perdaHoje >= Number(c.limite_perda_dia)) {
              erro = `Limite de perda do dia atingido (US$ ${perdaHoje.toFixed(2)}). Compras pausadas até amanhã.`;
            } else {
              const r = await comprar(modo, c.par, caixa);
              compraCaixa = r.valor; compraPreco = r.preco; compraEm = quando;
              caixa = Math.max(0, caixa - r.valor); qtd = r.qtd;
              novas.push({ carteira: c.id, modo, tipo: "compra", preco: r.preco, qtd: r.qtd, valor: r.valor, ordem_id: r.ordem_id, motivo: motivo(c.estrategia, "compra", ind(iU)), em: quando });
            }
          } else if (s === "venda" && qtd > 0) {
            const r = await vender(modo, c.par, qtd);
            caixa += r.valor;
            const pctOp = compraCaixa ? (r.valor / compraCaixa - 1) * 100 : null;
            novas.push({ carteira: c.id, modo, tipo: "venda", preco: r.preco, qtd: r.bruto, valor: r.valor, resultado_pct: pctOp, ordem_id: r.ordem_id, motivo: motivo(c.estrategia, "venda", ind(iU)), em: quando });
            qtd = 0; compraPreco = null; compraCaixa = null; compraEm = null;
          }
        } catch (e) {
          erro = (e as Error).message;
        }
      }
    } else if (c.ultimo_candle != null) {
      // Simulado. Primeira vez: só marca onde começou, não opera o passado
      for (let i = 0; i < fechados.length; i++) {
        if (fechados[i].t <= Number(c.ultimo_candle)) continue;
        const s = sinais[i], p = fech[i];
        const quando = new Date(fechados[i].t).toISOString();
        if (s === "compra" && qtd === 0 && caixa > 0) {
          compraCaixa = caixa; compraPreco = p; compraEm = quando;
          qtd = (caixa * (1 - TAXA)) / p; caixa = 0;
          novas.push({ carteira: c.id, tipo: "compra", preco: p, qtd, valor: compraCaixa, motivo: motivo(c.estrategia, "compra", ind(i)), em: quando });
        } else if (s === "venda" && qtd > 0) {
          caixa = qtd * p * (1 - TAXA);
          const pct = compraCaixa ? (caixa / compraCaixa - 1) * 100 : null;
          novas.push({ carteira: c.id, tipo: "venda", preco: p, qtd, valor: caixa, resultado_pct: pct, motivo: motivo(c.estrategia, "venda", ind(i)), em: quando });
          qtd = 0; compraPreco = null; compraCaixa = null; compraEm = null;
        }
      }
    }

    if (novas.length) await db("robo_operacoes", { method: "POST", body: JSON.stringify(novas), headers: { Prefer: "return=minimal" } });

    const iUlt = fechados.length - 1;
    await db(`robo_carteiras?id=eq.${encodeURIComponent(c.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        caixa, qtd, compra_preco: compraPreco, compra_caixa: compraCaixa, compra_em: compraEm,
        ultimo_candle: ultimo, ultimo_preco: atual, erro,
        indicadores: { ...ind(iUlt), sinal_ultimo_candle: sinais[iUlt] },
        atualizado_em: new Date().toISOString(),
      }),
      headers: { Prefer: "return=minimal" },
    });
    resumo.push({ carteira: c.id, novas_operacoes: novas.length, preco: atual, posicao: qtd > 0 ? "comprado" : "fora" });
  }

  // Atualiza o teste no histórico de cada par/tempo das carteiras
  for (const chave of cache.keys()) {
    const [par, tempo] = chave.split("_");
    const { fechados } = cache.get(chave)!;
    for (const e of Object.keys(ESTRATEGIAS) as Estrategia[]) {
      const r = { par, tempo, ...backtest(fechados, e) };
      await db("robo_backtest", { method: "POST", body: JSON.stringify({ id: `${e}_${par}_${tempo}`, resultado: r, atualizado_em: new Date().toISOString() }), headers: { Prefer: "return=minimal,resolution=merge-duplicates" } });
    }
  }
  return resumo;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const u = new URL(req.url);
  const acao = u.searchParams.get("acao") ?? "rodar";
  try {
    if (acao === "rodar") return json({ ok: true, carteiras: await rodar() });
    if (acao === "backtest") {
      const par = (u.searchParams.get("par") ?? "BTCUSDT").toUpperCase();
      const tempo = u.searchParams.get("tempo") ?? "1h";
      if (!/^[A-Z0-9]{2,12}USDT$/.test(par) || !TEMPOS.includes(tempo)) return json({ ok: false, erro: "Moeda ou tempo inválido" }, 400);
      const dias = Math.max(0, Math.min(250, Number(u.searchParams.get("dias") ?? 0) || 0));
      // Testes de período longo não substituem o teste guardado do app
      return json({ ok: true, resultado: await testarHistorico(par, tempo, dias === 0, dias) });
    }
    if (acao === "backtest_banca") {
      const pares = (u.searchParams.get("pares") ?? "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT").toUpperCase().split(",").filter((p) => /^[A-Z0-9]{2,12}USDT$/.test(p)).slice(0, 6);
      const tempo = u.searchParams.get("tempo") ?? "1h";
      const dias = Math.max(1, Math.min(250, Number(u.searchParams.get("dias") ?? 184) || 184));
      if (!pares.length || !TEMPOS.includes(tempo)) return json({ ok: false, erro: "Moedas ou tempo inválido" }, 400);
      const qtd = Math.min(6000, Math.ceil((dias * 24) / HORAS[tempo]) + 50);
      const mapa: Record<string, Candle[]> = {};
      for (const p of pares) mapa[p] = (await candles(p, tempo, qtd)).fechados;
      return json({ ok: true, resultado: backtestBanca(mapa, "rsi") });
    }
    if (acao === "testar_conta") return json({ ok: true, conta: await testarConta("testnet") });
    return json({ ok: false, erro: "Ação desconhecida" }, 400);
  } catch (e) {
    return json({ ok: false, erro: (e as Error).message }, 500);
  }
});
