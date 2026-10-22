// Lógica do Robô Trade: indicadores, sinais e teste no histórico.
// Tudo aqui é simulação: nenhuma ordem é enviada para corretora.

export const TAXA = 0.001; // 0,1% por operação (taxa padrão da Binance)

export type Candle = { t: number; c: number };
export type Sinal = "compra" | "venda" | null;
export type Estrategia = "medias" | "rsi" | "combo";

export const ESTRATEGIAS: Record<Estrategia, { nome: string; regra: string }> = {
  medias: {
    nome: "Cruzamento de médias 9/21",
    regra: "Compra quando a média de 9 passa para cima da média de 21; vende quando cruza para baixo.",
  },
  rsi: {
    nome: "RSI 14",
    regra: "Compra quando o RSI fica abaixo de 30 (caiu demais); vende quando passa de 70 (subiu demais).",
  },
  combo: {
    nome: "Médias + RSI",
    regra: "Compra quando a média de 9 cruza para cima da de 21 e o RSI está abaixo de 65; vende quando o RSI passa de 70 ou as médias cruzam para baixo.",
  },
};

export function mediaMovel(v: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  let soma = 0;
  for (let i = 0; i < v.length; i++) {
    soma += v[i];
    if (i >= n) soma -= v[i - n];
    if (i >= n - 1) out[i] = soma / n;
  }
  return out;
}

export function rsi(v: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  if (v.length <= n) return out;
  let ganho = 0, perda = 0;
  for (let i = 1; i <= n; i++) {
    const d = v[i] - v[i - 1];
    if (d > 0) ganho += d; else perda -= d;
  }
  ganho /= n; perda /= n;
  const calc = () => (perda === 0 ? 100 : 100 - 100 / (1 + ganho / perda));
  out[n] = calc();
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    ganho = (ganho * (n - 1) + (d > 0 ? d : 0)) / n;
    perda = (perda * (n - 1) + (d < 0 ? -d : 0)) / n;
    out[i] = calc();
  }
  return out;
}

export function calcularSinais(fech: number[], estrategia: Estrategia) {
  const sinais: Sinal[] = new Array(fech.length).fill(null);
  if (estrategia === "medias") {
    const r = mediaMovel(fech, 9), l = mediaMovel(fech, 21);
    for (let i = 1; i < fech.length; i++) {
      const a = r[i - 1], b = l[i - 1], c = r[i], d = l[i];
      if (a == null || b == null || c == null || d == null) continue;
      if (a <= b && c > d) sinais[i] = "compra";
      else if (a >= b && c < d) sinais[i] = "venda";
    }
    const ind = (i: number) => ({ media_rapida: r[i], media_lenta: l[i] });
    return { sinais, ind };
  }
  if (estrategia === "combo") {
    // Médias decidem a entrada; RSI evita comprar "esticado" e realiza o lucro cedo
    const r = mediaMovel(fech, 9), l = mediaMovel(fech, 21), x = rsi(fech, 14);
    for (let i = 1; i < fech.length; i++) {
      const a = r[i - 1], b = l[i - 1], c = r[i], d = l[i], v = x[i];
      if (a == null || b == null || c == null || d == null || v == null) continue;
      if (a <= b && c > d && v < 65) sinais[i] = "compra";
      else if ((a >= b && c < d) || v > 70) sinais[i] = "venda";
    }
    const ind = (i: number) => ({ media_rapida: r[i], media_lenta: l[i], rsi: x[i] });
    return { sinais, ind };
  }
  const x = rsi(fech, 14);
  for (let i = 0; i < fech.length; i++) {
    const v = x[i];
    if (v == null) continue;
    if (v < 30) sinais[i] = "compra";
    else if (v > 70) sinais[i] = "venda";
  }
  const ind = (i: number) => ({ rsi: x[i] });
  return { sinais, ind };
}

export function motivo(estrategia: Estrategia, tipo: "compra" | "venda", ind: Record<string, number | null>) {
  const f = (n: number | null | undefined, d = 0) => (n == null ? "-" : n.toLocaleString("pt-BR", { maximumFractionDigits: d }));
  if (estrategia === "combo") {
    if (tipo === "compra") return `Média 9 cruzou para cima da 21 com RSI em ${f(ind.rsi, 1)}`;
    return (ind.rsi ?? 0) > 70 ? `RSI em ${f(ind.rsi, 1)}, acima de 70: lucro realizado` : `Média 9 cruzou para baixo da 21`;
  }
  if (estrategia === "medias") {
    return tipo === "compra"
      ? `Média 9 (${f(ind.media_rapida)}) cruzou para cima da média 21 (${f(ind.media_lenta)})`
      : `Média 9 (${f(ind.media_rapida)}) cruzou para baixo da média 21 (${f(ind.media_lenta)})`;
  }
  return tipo === "compra" ? `RSI em ${f(ind.rsi, 1)}, abaixo de 30` : `RSI em ${f(ind.rsi, 1)}, acima de 70`;
}

export function backtest(candles: Candle[], estrategia: Estrategia, saldo = 1000) {
  const fech = candles.map((k) => k.c);
  const { sinais } = calcularSinais(fech, estrategia);
  let caixa = saldo, qtd = 0, compraCaixa = 0, compraPreco = 0, compraT = 0;
  const ops: { compra_em: number; compra_preco: number; venda_em: number; venda_preco: number; resultado_pct: number }[] = [];
  const marcas: { t: number; tipo: "compra" | "venda"; preco: number }[] = [];
  const patrimonio: number[] = [];
  let pico = saldo, maiorQueda = 0;
  for (let i = 0; i < candles.length; i++) {
    const p = fech[i], s = sinais[i];
    if (s === "compra" && qtd === 0) {
      compraCaixa = caixa; compraPreco = p; compraT = candles[i].t;
      qtd = (caixa * (1 - TAXA)) / p; caixa = 0;
      marcas.push({ t: candles[i].t, tipo: "compra", preco: p });
    } else if (s === "venda" && qtd > 0) {
      caixa = qtd * p * (1 - TAXA); qtd = 0;
      ops.push({ compra_em: compraT, compra_preco: compraPreco, venda_em: candles[i].t, venda_preco: p, resultado_pct: (caixa / compraCaixa - 1) * 100 });
      marcas.push({ t: candles[i].t, tipo: "venda", preco: p });
    }
    const pat = caixa + qtd * p;
    patrimonio.push(pat);
    if (pat > pico) pico = pat;
    const queda = (1 - pat / pico) * 100;
    if (queda > maiorQueda) maiorQueda = queda;
  }
  const final = patrimonio[patrimonio.length - 1] ?? saldo;
  const p0 = fech[0], pN = fech[fech.length - 1];
  const segurarFinal = saldo * (1 - TAXA) * (pN / p0);
  const acertos = ops.filter((o) => o.resultado_pct > 0).length;

  // Série reduzida para o gráfico (até 240 pontos)
  const passo = Math.max(1, Math.ceil(candles.length / 240));
  const serie: { t: number; preco: number; patrimonio: number; segurar: number }[] = [];
  for (let i = 0; i < candles.length; i += passo) {
    serie.push({ t: candles[i].t, preco: fech[i], patrimonio: round(patrimonio[i]), segurar: round(saldo * (1 - TAXA) * (fech[i] / p0)) });
  }
  // Resultado mês a mês (horário de Brasília): robô x só segurar
  const mensal: { mes: string; robo_pct: number; segurar_pct: number; operacoes: number }[] = [];
  const mesDe = (t: number) => new Date(t - 3 * 3600_000).toISOString().slice(0, 7);
  let iIni = 0;
  for (let i = 1; i <= candles.length; i++) {
    if (i === candles.length || mesDe(candles[i].t) !== mesDe(candles[iIni].t)) {
      const base = iIni === 0 ? saldo : patrimonio[iIni - 1];
      const precoBase = iIni === 0 ? fech[0] : fech[iIni - 1];
      const ini = candles[iIni].t, fim = candles[i - 1].t;
      mensal.push({
        mes: mesDe(ini),
        robo_pct: round((patrimonio[i - 1] / base - 1) * 100),
        segurar_pct: round((fech[i - 1] / precoBase - 1) * 100),
        operacoes: ops.filter((o) => o.venda_em >= ini && o.venda_em <= fim).length,
      });
      iIni = i;
    }
  }

  const ult = candles.length - 1;
  if (ult >= 0 && serie[serie.length - 1]?.t !== candles[ult].t) {
    serie.push({ t: candles[ult].t, preco: pN, patrimonio: round(final), segurar: round(segurarFinal) });
  }

  return {
    estrategia,
    nome: ESTRATEGIAS[estrategia].nome,
    regra: ESTRATEGIAS[estrategia].regra,
    inicio: candles[0]?.t ?? null,
    fim: candles[ult]?.t ?? null,
    candles: candles.length,
    saldo_inicial: saldo,
    saldo_final: round(final),
    resultado_pct: round((final / saldo - 1) * 100),
    segurar_pct: round((segurarFinal / saldo - 1) * 100),
    operacoes: ops.length,
    acertos_pct: ops.length ? round((acertos / ops.length) * 100) : 0,
    maior_queda_pct: round(maiorQueda),
    posicao_aberta: qtd > 0,
    lista: ops.slice(-40).reverse().map((o) => ({ ...o, resultado_pct: round(o.resultado_pct) })),
    marcas: marcas.slice(-120),
    serie,
    mensal,
  };
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------- Banca única para várias moedas ----------
// Uma banca só: quando está fora, entra na moeda que der sinal de compra
// (se mais de uma der sinal na mesma vela, escolhe a de RSI mais baixo).
// Fica nela até o sinal de venda dessa moeda; depois volta a procurar.
export function escolherEntrada(sinaisCompra: { par: string; rsi: number | null }[]) {
  if (!sinaisCompra.length) return null;
  return [...sinaisCompra].sort((a, b) => (a.rsi ?? 50) - (b.rsi ?? 50))[0].par;
}

export function backtestBanca(mapa: Record<string, Candle[]>, estrategia: Estrategia, saldo = 1000, maxPosicoes = 1) {
  // maxPosicoes: em quantas moedas ao mesmo tempo a banca pode estar.
  // Cada entrada usa o dinheiro livre dividido pelas vagas que sobram.
  const pares = Object.keys(mapa);
  const tempos = pares.map((p) => new Set(mapa[p].map((k) => k.t)));
  const comuns = mapa[pares[0]].map((k) => k.t).filter((t) => tempos.every((s) => s.has(t)));
  const info: Record<string, { idx: Map<number, number>; fech: number[]; sinais: Sinal[]; rsi: (number | null)[] }> = {};
  for (const p of pares) {
    const fech = mapa[p].map((k) => k.c);
    info[p] = { idx: new Map(mapa[p].map((k, i) => [k.t, i])), fech, sinais: calcularSinais(fech, estrategia).sinais, rsi: rsi(fech, 14) };
  }
  let caixa = saldo;
  const abertas = new Map<string, { qtd: number; custo: number; preco: number; t: number }>();
  const ops: { par: string; compra_em: number; compra_preco: number; venda_em: number; venda_preco: number; resultado_pct: number }[] = [];
  const patrimonio: number[] = [];
  let pico = saldo, maiorQueda = 0, maxJuntas = 0;
  const preco = (p: string, t: number) => info[p].fech[info[p].idx.get(t)!];
  for (const t of comuns) {
    // 1) vende as que deram sinal de venda
    for (const [p, pos] of [...abertas]) {
      if (info[p].sinais[info[p].idx.get(t)!] === "venda") {
        const valor = pos.qtd * preco(p, t) * (1 - TAXA);
        caixa += valor;
        ops.push({ par: p, compra_em: pos.t, compra_preco: pos.preco, venda_em: t, venda_preco: preco(p, t), resultado_pct: (valor / pos.custo - 1) * 100 });
        abertas.delete(p);
      }
    }
    // 2) entra nas que deram sinal de compra, enquanto houver vaga (RSI mais baixo primeiro)
    const cands = pares
      .filter((p) => !abertas.has(p) && info[p].sinais[info[p].idx.get(t)!] === "compra")
      .map((p) => ({ par: p, rsi: info[p].rsi[info[p].idx.get(t)!] }))
      .sort((a, b) => (a.rsi ?? 50) - (b.rsi ?? 50));
    for (const c of cands) {
      const vagas = maxPosicoes - abertas.size;
      if (vagas <= 0 || caixa <= 1) break;
      const custo = caixa / vagas;
      const pr = preco(c.par, t);
      abertas.set(c.par, { qtd: (custo * (1 - TAXA)) / pr, custo, preco: pr, t });
      caixa -= custo;
    }
    maxJuntas = Math.max(maxJuntas, abertas.size);
    let pat = caixa;
    for (const [p, pos] of abertas) pat += pos.qtd * preco(p, t);
    patrimonio.push(pat);
    if (pat > pico) pico = pat;
    maiorQueda = Math.max(maiorQueda, (1 - pat / pico) * 100);
  }
  const mesDe = (t: number) => new Date(t - 3 * 3600_000).toISOString().slice(0, 7);
  const mensal: { mes: string; robo_pct: number; operacoes: number }[] = [];
  let iIni = 0;
  for (let i = 1; i <= comuns.length; i++) {
    if (i === comuns.length || mesDe(comuns[i]) !== mesDe(comuns[iIni])) {
      const base = iIni === 0 ? saldo : patrimonio[iIni - 1];
      const ini = comuns[iIni], fim = comuns[i - 1];
      mensal.push({ mes: mesDe(ini), robo_pct: round((patrimonio[i - 1] / base - 1) * 100), operacoes: ops.filter((o) => o.venda_em >= ini && o.venda_em <= fim).length });
      iIni = i;
    }
  }
  const final = patrimonio[patrimonio.length - 1] ?? saldo;
  const porMoeda: Record<string, { operacoes: number; acertos: number }> = {};
  for (const o of ops) {
    porMoeda[o.par] ??= { operacoes: 0, acertos: 0 };
    porMoeda[o.par].operacoes++;
    if (o.resultado_pct > 0) porMoeda[o.par].acertos++;
  }
  return {
    pares,
    max_posicoes: maxPosicoes,
    max_juntas: maxJuntas,
    inicio: comuns[0] ?? null,
    fim: comuns[comuns.length - 1] ?? null,
    saldo_inicial: saldo,
    saldo_final: round(final),
    resultado_pct: round((final / saldo - 1) * 100),
    operacoes: ops.length,
    acertos_pct: ops.length ? round((ops.filter((o) => o.resultado_pct > 0).length / ops.length) * 100) : 0,
    maior_queda_pct: round(maiorQueda),
    posicoes_abertas: [...abertas.keys()],
    por_moeda: porMoeda,
    mensal,
    lista: ops.slice(-40).reverse().map((o) => ({ ...o, resultado_pct: round(o.resultado_pct) })),
  };
}

// ---------- Simulação do bot DCA Spot (estilo Binance) ----------
// Compra uma ordem base; se o preço cair "desvio"% abaixo da última compra, faz
// uma ordem de segurança (cada uma "mult" vezes maior), até "maxSeg" ordens.
// Vende tudo quando o preço passa "alvo"% acima do preço médio, e recomeça.
export type ConfigDCA = { desvio: number; maxSeg: number; mult: number; alvo: number };

export function backtestDCA(candles: Candle[], cfg: ConfigDCA, saldo = 1000) {
  const pesos = [1];
  for (let i = 1; i <= cfg.maxSeg; i++) pesos.push(pesos[i - 1] * cfg.mult);
  const somaPesos = pesos.reduce((a, b) => a + b, 0);
  let caixa = saldo, qtd = 0, gasto = 0, passo = 0, ultimaCompra = 0, ciclos = 0, lucros = 0, travado = 0;
  const patrimonio: number[] = [];
  let pico = saldo, maiorQueda = 0;
  for (let i = 0; i < candles.length; i++) {
    const p = candles[i].c;
    const comprar = (valor: number) => {
      valor = Math.min(valor, caixa);
      if (valor <= 0) return;
      qtd += (valor * (1 - TAXA)) / p; gasto += valor; caixa -= valor; ultimaCompra = p; passo++;
    };
    if (qtd === 0) {
      // valor da banca no início do ciclo (lucro é reinvestido)
      comprar((caixa * pesos[0]) / somaPesos);
    } else {
      const medio = gasto / qtd;
      if (p >= medio * (1 + cfg.alvo / 100)) {
        const valor = qtd * p * (1 - TAXA);
        lucros += valor - gasto; caixa += valor; qtd = 0; gasto = 0; passo = 0; ciclos++;
      } else if (passo <= cfg.maxSeg && p <= ultimaCompra * (1 - cfg.desvio / 100)) {
        const totalCiclo = caixa + gasto;
        comprar((totalCiclo * pesos[passo]) / somaPesos);
      }
      if (qtd > 0 && passo > cfg.maxSeg) travado++;
    }
    const pat = caixa + qtd * p;
    patrimonio.push(pat);
    if (pat > pico) pico = pat;
    maiorQueda = Math.max(maiorQueda, (1 - pat / pico) * 100);
  }
  const final = patrimonio[patrimonio.length - 1] ?? saldo;
  const mesDe = (t: number) => new Date(t - 3 * 3600_000).toISOString().slice(0, 7);
  const mensal: { mes: string; robo_pct: number }[] = [];
  let iIni = 0;
  for (let i = 1; i <= candles.length; i++) {
    if (i === candles.length || mesDe(candles[i].t) !== mesDe(candles[iIni].t)) {
      const base = iIni === 0 ? saldo : patrimonio[iIni - 1];
      mensal.push({ mes: mesDe(candles[iIni].t), robo_pct: round((patrimonio[i - 1] / base - 1) * 100) });
      iIni = i;
    }
  }
  return {
    cfg,
    resultado_pct: round((final / saldo - 1) * 100),
    segurar_pct: round(((candles[candles.length - 1].c / candles[0].c) * (1 - TAXA) - 1) * 100),
    ciclos,
    maior_queda_pct: round(maiorQueda),
    horas_travado: travado,
    aberto_no_fim: qtd > 0,
    mensal,
  };
}

// ---------- RSI na entrada + lucro fixo / stop na saída (como o bot da WunderTrading) ----------
export function backtestRsiAlvo(candles: Candle[], alvo: number, stop: number, saldo = 1000) {
  const fech = candles.map((k) => k.c);
  const x = rsi(fech, 14);
  let caixa = saldo, qtd = 0, custo = 0, preco = 0, ops = 0, acertos = 0, pico = saldo, maiorQueda = 0;
  for (let i = 0; i < fech.length; i++) {
    const p = fech[i];
    if (qtd === 0) {
      if (x[i] != null && (x[i] as number) < 30) { custo = caixa; preco = p; qtd = (caixa * (1 - TAXA)) / p; caixa = 0; }
    } else if (p >= preco * (1 + alvo / 100) || (stop > 0 && p <= preco * (1 - stop / 100))) {
      caixa = qtd * p * (1 - TAXA); qtd = 0; ops++;
      if (caixa > custo) acertos++;
    }
    const pat = caixa + qtd * p;
    if (pat > pico) pico = pat;
    maiorQueda = Math.max(maiorQueda, (1 - pat / pico) * 100);
  }
  const final = caixa + qtd * fech[fech.length - 1];
  return { alvo, stop, resultado_pct: round((final / saldo - 1) * 100), operacoes: ops, acertos_pct: ops ? round((acertos / ops) * 100) : 0, maior_queda_pct: round(maiorQueda) };
}
