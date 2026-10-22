// Conta REAL da Binance: SÓ LEITURA. Este arquivo não envia ordens.
// Usa uma chave criada só com "Habilitar Leitura", guardada nos Secrets do Supabase:
//   BINANCE_LEITURA_KEY e BINANCE_LEITURA_SECRET

const BASE = "https://api.binance.com";

async function assinar(secret: string, texto: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type ContaReal = {
  moedas: { moeda: string; qtd: number; usdt: number }[];
  total_usdt: number;
  total_brl: number;
  usdt_brl: number;
  pode_negociar: boolean;
};

export async function lerContaReal(): Promise<ContaReal | null> {
  const key = Deno.env.get("BINANCE_LEITURA_KEY");
  const secret = Deno.env.get("BINANCE_LEITURA_SECRET");
  if (!key || !secret) return null;

  const q = `recvWindow=10000&timestamp=${Date.now()}`;
  const r = await fetch(`${BASE}/api/v3/account?${q}&signature=${await assinar(secret, q)}`, { headers: { "X-MBX-APIKEY": key } });
  const conta = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Binance recusou a leitura (${r.status}): ${conta?.msg ?? "erro desconhecido"}`);

  const saldos = (conta.balances ?? [])
    .map((b: any) => ({ moeda: String(b.asset), qtd: Number(b.free) + Number(b.locked) }))
    .filter((b: { qtd: number }) => b.qtd > 0);

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
    .map((s: { moeda: string; qtd: number }) => ({ ...s, usdt: emUsdt(s.moeda, s.qtd) }))
    .filter((s: { usdt: number }) => s.usdt >= 0.01)
    .sort((a: { usdt: number }, b: { usdt: number }) => b.usdt - a.usdt);
  const total = moedas.reduce((a: number, m: { usdt: number }) => a + m.usdt, 0);

  return { moedas, total_usdt: total, total_brl: total * usdtBrl, usdt_brl: usdtBrl, pode_negociar: !!conta.canTrade };
}
