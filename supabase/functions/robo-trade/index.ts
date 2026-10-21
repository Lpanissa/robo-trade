// Robô Trade — roda na nuvem (Supabase) a cada 5 minutos.
// Lê o histórico de preços da Binance (dados públicos), decide compra/venda
// e registra numa carteira SIMULADA. Não envia ordens para nenhuma corretora.
import { backtest, calcularSinais, Candle, Estrategia, ESTRATEGIAS, motivo, TAXA } from "./logica.ts";

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
async function candles(par: string, tempo: string) {
  let ultimoErro = "";
  for (const base of FONTES) {
    try {
      const r = await fetch(`${base}/api/v3/klines?symbol=${par}&interval=${tempo}&limit=1000`);
      if (!r.ok) { ultimoErro = `${base}: ${r.status}`; continue; }
      const linhas = (await r.json()) as unknown[][];
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

async function testarHistorico(par: string, tempo: string, salvar = true) {
  const { fechados } = await candles(par, tempo);
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

    // Primeira vez: só marca onde começou, não opera o passado
    if (c.ultimo_candle != null) {
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
        ultimo_candle: ultimo, ultimo_preco: atual,
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
      return json({ ok: true, resultado: await testarHistorico(par, tempo) });
    }
    return json({ ok: false, erro: "Ação desconhecida" }, 400);
  } catch (e) {
    return json({ ok: false, erro: (e as Error).message }, 500);
  }
});
