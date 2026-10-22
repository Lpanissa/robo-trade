// Conta REAL da Binance: SÓ LEITURA. Este arquivo não envia ordens.
// Usa uma chave criada só com "Habilitar Leitura", guardada nos Secrets do Supabase:
//   BINANCE_LEITURA_KEY e BINANCE_LEITURA_SECRET

const BASE = "https://api.binance.com";
const MOEDAS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "PEPE", "ADA", "LINK"];
const COTACOES = ["USDT", "BRL"];

async function assinar(secret: string, texto: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function ler(key: string, secret: string, caminho: string, params: Record<string, string> = {}) {
  const q = new URLSearchParams({ ...params, recvWindow: "10000", timestamp: String(Date.now()) }).toString();
  const r = await fetch(`${BASE}${caminho}?${q}&signature=${await assinar(secret, q)}`, { headers: { "X-MBX-APIKEY": key } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Binance recusou a leitura (${r.status}): ${j?.msg ?? "erro desconhecido"}`);
  return j;
}

export type OperacaoReal = {
  em: number; moeda: string; par: string; tipo: "compra" | "venda";
  qtd: number; preco_usdt: number; valor_usdt: number; lucro_usdt: number | null; lucro_pct: number | null;
};

// Diagnóstico: o que a Binance devolveu (sem chaves)
export async function diagnostico() {
  const key = Deno.env.get("BINANCE_LEITURA_KEY")!, secret = Deno.env.get("BINANCE_LEITURA_SECRET")!;
  const c = await ler(key, secret, "/api/v3/account", { omitZeroBalances: "true" });
  return { chaves: Object.keys(c), n: Array.isArray(c.balances) ? c.balances.length : null, tipo: c.accountType, permissoes: c.permissions, amostra: (c.balances ?? []).slice(0, 6) };
}

export async function lerContaReal() {
  const key = Deno.env.get("BINANCE_LEITURA_KEY");
  const secret = Deno.env.get("BINANCE_LEITURA_SECRET");
  if (!key || !secret) return null;

  const conta = await ler(key, secret, "/api/v3/account", { omitZeroBalances: "true" });
  if (!Array.isArray(conta.balances)) throw new Error(`Binance mandou a conta sem saldos (${Object.keys(conta).join(",").slice(0, 120)})`);
  // Moedas no Earn Flexível aparecem como "LD" + moeda (LDUSDT, LDETH...). Somamos com a moeda normal,
  // mas guardamos quanto está no Earn: os bots só conseguem usar o que está na Spot.
  const porMoeda: Record<string, { qtd: number; earn: number }> = {};
  for (const b of conta.balances ?? []) {
    const bruto = String(b.asset);
    const qtd = Number(b.free) + Number(b.locked);
    if (!(qtd > 0)) continue;
    const earn = bruto.startsWith("LD") && ["USDT", "USDC", "FDUSD", "BRL", "BTC", "ETH", "SOL", "BNB", "DOGE", "PEPE", "ADA", "LINK"].includes(bruto.slice(2));
    const moeda = earn ? bruto.slice(2) : bruto;
    const p = (porMoeda[moeda] ??= { qtd: 0, earn: 0 });
    p.qtd += qtd;
    if (earn) p.earn += qtd;
  }
  const saldos = Object.entries(porMoeda).map(([moeda, v]) => ({ moeda, qtd: v.qtd, earn: v.earn }));

  // Preços públicos para converter tudo em USDT e em reais
  const precos: Record<string, number> = {};
  const lista = await (await fetch(`${BASE}/api/v3/ticker/price`)).json().catch(() => []);
  for (const p of lista ?? []) precos[p.symbol] = Number(p.price);
  const usdtBrl = precos["USDTBRL"] ?? 0;

  const emUsdt = (moeda: string, qtd: number) => {
    if (moeda === "USDT") return qtd;
    if (moeda === "BRL") return usdtBrl ? qtd / usdtBrl : 0;
    if (precos[`${moeda}USDT`]) return qtd * precos[`${moeda}USDT`];
    if (precos[`${moeda}BRL`] && usdtBrl) return (qtd * precos[`${moeda}BRL`]) / usdtBrl;
    return 0;
  };

  const moedas = saldos
    .map((s: { moeda: string; qtd: number; earn: number }) => ({ ...s, usdt: emUsdt(s.moeda, s.qtd) }))
    .filter((s: { usdt: number }) => s.usdt >= 0.01)
    .sort((a: { usdt: number }, b: { usdt: number }) => b.usdt - a.usdt);
  const total = moedas.reduce((a: number, m: { usdt: number }) => a + m.usdt, 0);
  const earnUsdt = saldos.reduce((a: number, m: { moeda: string; earn: number }) => a + emUsdt(m.moeda, m.earn), 0);

  // Histórico de negociações (só leitura) e preço médio de cada moeda
  const negocios: { em: number; moeda: string; par: string; compra: boolean; qtd: number; quote: number; cot: string; taxa: number; taxaMoeda: string; preco: number }[] = [];
  for (const m of MOEDAS) {
    for (const cot of COTACOES) {
      const par = m + cot;
      if (!precos[par]) continue;
      const l = await ler(key, secret, "/api/v3/myTrades", { symbol: par, limit: "1000" }).catch(() => []);
      for (const t of l ?? []) {
        negocios.push({ em: Number(t.time), moeda: m, par, compra: !!t.isBuyer, qtd: Number(t.qty), quote: Number(t.quoteQty), cot, taxa: Number(t.commission), taxaMoeda: String(t.commissionAsset), preco: Number(t.price) });
      }
    }
  }
  negocios.sort((a, b) => a.em - b.em);

  // Reais viram dólar pela cotação de agora (aproximado)
  const usd = (valor: number, cot: string) => (cot === "USDT" ? valor : usdtBrl ? valor / usdtBrl : 0);
  // Lotes de compra de cada moeda; a venda sai das compras mais recentes primeiro
  // (assim o lucro de cada venda é comparado com a compra que o bot acabou de fazer)
  const lotes: Record<string, { qtd: number; custoUn: number }[]> = {};
  const operacoes: OperacaoReal[] = [];
  for (const n of negocios) {
    const pilha = (lotes[n.moeda] ??= []);
    const valor = usd(n.quote, n.cot);
    const taxaUsd = n.taxaMoeda === n.cot ? usd(n.taxa, n.cot) : n.taxaMoeda === n.moeda ? n.taxa * (valor / (n.qtd || 1)) : emUsdt(n.taxaMoeda, n.taxa);
    if (n.compra) {
      const recebido = n.taxaMoeda === n.moeda ? n.qtd - n.taxa : n.qtd;
      const custo = valor + (n.taxaMoeda !== n.moeda ? taxaUsd : 0);
      if (recebido > 0) pilha.push({ qtd: recebido, custoUn: custo / recebido });
      operacoes.push({ em: n.em, moeda: n.moeda, par: n.par, tipo: "compra", qtd: recebido, preco_usdt: usd(n.preco, n.cot), valor_usdt: valor, lucro_usdt: null, lucro_pct: null });
    } else {
      let falta = n.qtd, custoVendido = 0, achou = 0;
      while (falta > 1e-12 && pilha.length) {
        const l = pilha[pilha.length - 1];
        const usar = Math.min(l.qtd, falta);
        custoVendido += usar * l.custoUn; achou += usar;
        l.qtd -= usar; falta -= usar;
        if (l.qtd <= 1e-12) pilha.pop();
      }
      const recebido = valor - taxaUsd;
      // Só calcula lucro se achou a compra de quase tudo que foi vendido
      const lucro = achou >= n.qtd * 0.98 && custoVendido > 0 ? recebido * (achou / n.qtd) - custoVendido : null;
      operacoes.push({ em: n.em, moeda: n.moeda, par: n.par, tipo: "venda", qtd: n.qtd, preco_usdt: usd(n.preco, n.cot), valor_usdt: valor, lucro_usdt: lucro, lucro_pct: lucro != null ? (lucro / custoVendido) * 100 : null });
    }
  }
  // Preço médio do que você TEM agora: as compras mais recentes que somam o saldo atual
  const posicoes: Record<string, { qtd: number; preco_medio: number; desde: number }> = {};
  for (const m of MOEDAS) {
    const saldo = saldos.find((s: { moeda: string }) => s.moeda === m)?.qtd ?? 0;
    if (emUsdt(m, saldo) < 1) continue;
    let q = 0, custo = 0, desde = 0;
    for (const o of [...operacoes].reverse()) {
      if (o.moeda !== m || o.tipo !== "compra") continue;
      const usar = Math.min(o.qtd, saldo - q);
      q += usar; custo += usar * o.preco_usdt; desde = o.em;
      if (q >= saldo * 0.999) break;
    }
    if (q > 0) posicoes[m] = { qtd: saldo, preco_medio: custo / q, desde };
  }

  return {
    moedas, total_usdt: total, total_brl: total * usdtBrl, usdt_brl: usdtBrl, pode_negociar: !!conta.canTrade, earn_usdt: earnUsdt,
    operacoes: operacoes.reverse().slice(0, 500), posicoes,
  };
}
