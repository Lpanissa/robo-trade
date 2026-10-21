// Ordens na Binance. Por enquanto só na TESTNET (dinheiro de mentira da própria Binance).
// As chaves ficam nos "Secrets" das Edge Functions do Supabase, colocadas pelo dono:
//   BINANCE_TESTNET_KEY e BINANCE_TESTNET_SECRET

const BASES: Record<string, string> = {
  testnet: "https://testnet.binance.vision",
};

function chaves(modo: string) {
  if (modo !== "testnet") throw new Error("Modo não liberado. Só a Testnet está ligada por enquanto.");
  const key = Deno.env.get("BINANCE_TESTNET_KEY");
  const secret = Deno.env.get("BINANCE_TESTNET_SECRET");
  if (!key || !secret) throw new Error("Falta colar as chaves da Binance Testnet no Supabase (BINANCE_TESTNET_KEY e BINANCE_TESTNET_SECRET).");
  return { key, secret, base: BASES[modo] };
}

async function assinar(secret: string, texto: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function chamar(modo: string, metodo: "GET" | "POST", caminho: string, params: Record<string, string | number>) {
  const { key, secret, base } = chaves(modo);
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([a, b]) => [a, String(b)])), recvWindow: "10000", timestamp: String(Date.now()) }).toString();
  const sig = await assinar(secret, q);
  const r = await fetch(`${base}${caminho}?${q}&signature=${sig}`, { method: metodo, headers: { "X-MBX-APIKEY": key } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Binance recusou (${r.status}): ${j?.msg ?? "erro desconhecido"}`);
  return j;
}

// Regras da moeda (tamanho mínimo e "degrau" da quantidade)
async function regras(modo: string, par: string) {
  const r = await fetch(`${BASES[modo]}/api/v3/exchangeInfo?symbol=${par}`);
  const j = await r.json();
  const f = j?.symbols?.[0]?.filters ?? [];
  const lote = f.find((x: any) => x.filterType === "LOT_SIZE");
  const notional = f.find((x: any) => x.filterType === "NOTIONAL" || x.filterType === "MIN_NOTIONAL");
  return { passo: Number(lote?.stepSize ?? "0.00001"), minimo: Number(notional?.minNotional ?? 5) };
}

function arredondarParaBaixo(qtd: number, passo: number) {
  const casas = Math.max(0, Math.round(-Math.log10(passo)));
  const n = Math.floor(qtd / passo) * passo;
  return Number(n.toFixed(casas));
}

function resumoOrdem(j: any, base: string) {
  const bruto = Number(j.executedQty);
  const valor = Number(j.cummulativeQuoteQty);
  // Taxa cobrada na própria moeda comprada sai da quantidade
  const taxa = (moeda: string) => (j.fills ?? []).filter((f: any) => f.commissionAsset === moeda).reduce((s: number, f: any) => s + Number(f.commission), 0);
  const taxaBase = taxa(base), taxaUsdt = taxa("USDT");
  // compra: quanto gastou (valor) e quanto recebeu (qtd líquida); venda: quanto recebeu líquido
  const liquido = j.side === "SELL" ? valor - taxaUsdt : valor;
  return { ordem_id: String(j.orderId), qtd: bruto - taxaBase, bruto, valor: liquido, preco: bruto > 0 ? valor / bruto : 0 };
}

export function temChaves(modo: string) {
  try { chaves(modo); return null; } catch (e) { return (e as Error).message; }
}

export async function comprar(modo: string, par: string, valorUsdt: number) {
  const { minimo } = await regras(modo, par);
  if (valorUsdt < minimo) throw new Error(`Valor por operação (${valorUsdt} USDT) é menor que o mínimo da Binance (${minimo} USDT).`);
  const j = await chamar(modo, "POST", "/api/v3/order", { symbol: par, side: "BUY", type: "MARKET", quoteOrderQty: (Math.floor(valorUsdt * 100) / 100).toFixed(2), newOrderRespType: "FULL" });
  return resumoOrdem(j, par.replace(/USDT$/, ""));
}

export async function vender(modo: string, par: string, qtdDesejada: number) {
  const { passo } = await regras(modo, par);
  const base = par.replace(/USDT$/, "");
  const conta = await chamar(modo, "GET", "/api/v3/account", {});
  const livre = Number(conta.balances?.find((b: any) => b.asset === base)?.free ?? 0);
  const qtd = arredondarParaBaixo(Math.min(livre, qtdDesejada), passo);
  if (qtd <= 0) throw new Error(`Não há ${base} livre na conta para vender.`);
  const j = await chamar(modo, "POST", "/api/v3/order", { symbol: par, side: "SELL", type: "MARKET", quantity: qtd, newOrderRespType: "FULL" });
  return resumoOrdem(j, base);
}

// Confere se as chaves funcionam e mostra os saldos (sem mostrar as chaves)
export async function testarConta(modo: string) {
  const conta = await chamar(modo, "GET", "/api/v3/account", {});
  const saldos = (conta.balances ?? [])
    .filter((b: any) => ["USDT", "BTC", "ETH", "BNB"].includes(b.asset))
    .map((b: any) => ({ moeda: b.asset, livre: Number(b.free) }));
  return { podeNegociar: conta.canTrade, saldos };
}
