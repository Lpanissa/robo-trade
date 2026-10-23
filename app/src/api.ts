// Conversa com o robô na nuvem (Supabase). Só leitura: o robô roda sozinho.
const SB = "https://fyxksvydxwvygjebanno.supabase.co";
// Chave pública (anon): só permite LER as tabelas do robô.
const CHAVE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5eGtzdnlkeHd2eWdqZWJhbm5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMzE5MDMsImV4cCI6MjEwNjcwNzkwM30.qUHr5gl00vF2JG7YaostqpOqhEMSEPSci1ySH1D-Fik";

const cab = { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` };

export type Estrategia = "medias" | "rsi" | "combo";

export type Carteira = {
  id: string;
  estrategia: Estrategia;
  par: string;
  tempo: string;
  saldo_inicial: number;
  caixa: number;
  qtd: number;
  compra_preco: number | null;
  compra_em: string | null;
  ultimo_preco: number | null;
  indicadores: { media_rapida?: number | null; media_lenta?: number | null; rsi?: number | null; sinal_ultimo_candle?: string | null } | null;
  criado_em: string;
  atualizado_em: string;
  modo: "simulado" | "testnet" | "real";
  erro: string | null;
  limite_perda_dia: number | null;
  max_posicoes: number;
  posicoes: Record<string, { qtd: number; custo: number; preco: number; em: string }>;
};

// Banca única: a carteira tem várias moedas no campo par, separadas por vírgula
export const ehBanca = (c: Carteira) => c.par.includes(",");

// Quanto a carteira vale agora (dinheiro livre + moedas compradas)
export function valorAtual(c: Carteira) {
  if (!ehBanca(c)) return c.caixa + c.qtd * (c.ultimo_preco ?? 0);
  const precos = ((c.indicadores as any)?.precos ?? {}) as Record<string, number>;
  return c.caixa + Object.entries(c.posicoes ?? {}).reduce((a, [p, pos]) => a + pos.qtd * (precos[p] ?? pos.preco), 0);
}

export type Operacao = {
  id: number;
  carteira: string;
  par: string | null;
  tipo: "compra" | "venda";
  preco: number;
  qtd: number;
  valor: number;
  resultado_pct: number | null;
  motivo: string | null;
  em: string;
};

export type Teste = {
  estrategia: Estrategia;
  nome: string;
  regra: string;
  par: string;
  tempo: string;
  inicio: number;
  fim: number;
  candles: number;
  saldo_inicial: number;
  saldo_final: number;
  resultado_pct: number;
  segurar_pct: number;
  operacoes: number;
  acertos_pct: number;
  maior_queda_pct: number;
  posicao_aberta: boolean;
  lista: { compra_em: number; compra_preco: number; venda_em: number; venda_preco: number; resultado_pct: number }[];
  marcas: { t: number; tipo: "compra" | "venda"; preco: number }[];
  serie: { t: number; preco: number; patrimonio: number; segurar: number }[];
};

async function ler<T>(caminho: string): Promise<T> {
  const r = await fetch(`${SB}/rest/v1/${caminho}`, { headers: cab });
  if (!r.ok) throw new Error(`Não consegui falar com o robô (erro ${r.status}).`);
  return r.json();
}

const num = (v: unknown) => (v == null ? null : Number(v));

export async function buscarCarteiras(): Promise<Carteira[]> {
  const l = await ler<any[]>("robo_carteiras?select=*&ativo=eq.true&order=id");
  return l.map((c) => ({
    ...c,
    saldo_inicial: Number(c.saldo_inicial),
    caixa: Number(c.caixa),
    qtd: Number(c.qtd),
    compra_preco: num(c.compra_preco),
    ultimo_preco: num(c.ultimo_preco),
    limite_perda_dia: num(c.limite_perda_dia),
    modo: c.modo ?? "simulado",
    max_posicoes: Number(c.max_posicoes ?? 1),
    posicoes: c.posicoes ?? {},
  }));
}

// Conta REAL da Binance (só leitura, atualizada pelo robô a cada 5 minutos)
export type ContaReal = {
  moedas: { moeda: string; qtd: number; usdt: number; earn?: number }[];
  earn_usdt?: number | null;
  total_usdt: number | null;
  total_brl: number | null;
  usdt_brl: number | null;
  erro: string | null;
  atualizado_em: string;
  operacoes: OperacaoReal[];
  posicoes: Record<string, { qtd: number; preco_medio: number; desde: number }>;
};

export type OperacaoReal = {
  em: number; moeda: string; par: string; tipo: "compra" | "venda";
  qtd: number; preco_usdt: number; valor_usdt: number; lucro_usdt: number | null; lucro_pct: number | null;
};

// Velas (candles) com o preço real da Binance (dados públicos)
export async function buscarVelas(par: string, intervalo: string, limite = 80) {
  for (const base of ["https://data-api.binance.vision", "https://api.binance.com"]) {
    try {
      const r = await fetch(`${base}/api/v3/klines?symbol=${par}&interval=${intervalo}&limit=${limite}`);
      if (!r.ok) continue;
      const l = (await r.json()) as any[][];
      return l.map((k) => ({ t: Number(k[0]), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]) }));
    } catch {}
  }
  throw new Error("Não consegui buscar o preço na Binance.");
}

export async function buscarContaReal(): Promise<ContaReal | null> {
  try {
    const l = await ler<any[]>("robo_conta_real?select=*&id=eq.1");
    if (!l.length) return null;
    const c = l[0];
    return { ...c, total_usdt: num(c.total_usdt), total_brl: num(c.total_brl), usdt_brl: num(c.usdt_brl), moedas: c.moedas ?? [], operacoes: c.operacoes ?? [], posicoes: c.posicoes ?? {} };
  } catch {
    return null; // tabela ainda não criada ou sem chave de leitura
  }
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const reais = (n: number | null | undefined) => (n == null || isNaN(n) ? "-" : brl.format(n));

export async function buscarOperacoes(): Promise<Operacao[]> {
  const l = await ler<any[]>("robo_operacoes?select=*&order=em.desc&limit=40");
  return l.map((o) => ({ ...o, preco: Number(o.preco), qtd: Number(o.qtd), valor: Number(o.valor), resultado_pct: num(o.resultado_pct) }));
}

// Teste no histórico. Primeiro tenta o que o robô já guardou; senão pede um teste novo.
export async function buscarTeste(par: string, tempo: string, forcar = false): Promise<Record<Estrategia, Teste>> {
  if (!forcar) {
    const l = await ler<{ id: string; resultado: Teste }[]>(`robo_backtest?select=id,resultado&id=in.(medias_${par}_${tempo},rsi_${par}_${tempo},combo_${par}_${tempo})`);
    if (l.length === 3) {
      const o: any = {};
      for (const x of l) o[x.resultado.estrategia] = x.resultado;
      return o;
    }
  }
  const r = await fetch(`${SB}/functions/v1/robo-trade?acao=backtest&par=${par}&tempo=${tempo}`, { headers: cab });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.erro ?? `O teste falhou (erro ${r.status}).`);
  return j.resultado;
}

// ---------- Formatação ----------
const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
export const dinheiro = (n: number | null | undefined) => (n == null || isNaN(n) ? "-" : usd.format(n));
export const pct = (n: number | null | undefined) =>
  n == null || isNaN(n) ? "-" : `${n > 0 ? "+" : ""}${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
export const numero = (n: number | null | undefined, casas = 0) =>
  n == null || isNaN(n) ? "-" : n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const dataHora = (d: string | number) => {
  const x = new Date(d);
  return `${x.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${x.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};
export const data = (d: string | number) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" });

export const NOME_ESTRATEGIA: Record<Estrategia, string> = { medias: "Médias 9/21", rsi: "RSI 14", combo: "Médias + RSI" };
export const NOME_TEMPO: Record<string, string> = { "15m": "15 min", "1h": "1 hora", "4h": "4 horas", "1d": "1 dia" };
export const MOEDAS = [
  { par: "BTCUSDT", nome: "Bitcoin" },
  { par: "ETHUSDT", nome: "Ethereum" },
  { par: "SOLUSDT", nome: "Solana" },
  { par: "BNBUSDT", nome: "BNB" },
];
