import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Path, Rect } from "react-native-svg";
import {
  ehBanca, buscarCarteiras, Carteira, dataHora, dinheiro, MOEDAS, numero, pct,
  buscarContaReal, ContaReal, reais, buscarVelas, OperacaoReal,
} from "./src/api";
import Velas, { LegendaVelas, Vela } from "./src/Velas";
import { Atualizacao, baixarAtualizacao, ouvirToqueNaNotificacao, procurarAtualizacao } from "./src/atualizacao";
import { corDoNumero, Tema, useTema } from "./src/tema";
import { registrarAvisos } from "./src/push";

type Aba = "agora" | "historico";

export default function App() {
  return (
    <SafeAreaProvider>
      <Tela />
    </SafeAreaProvider>
  );
}

// Dados da conta real, compartilhados pelas duas abas
function useConta() {
  const [real, setReal] = useState<ContaReal | null>(null);
  const [carteiras, setCarteiras] = useState<Carteira[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const carregar = useCallback(async () => {
    setAtualizando(true);
    try {
      const [r, c] = await Promise.all([buscarContaReal(), buscarCarteiras().catch(() => null)]);
      setReal(r); setCarteiras(c); setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAtualizando(false);
    }
  }, []);
  useEffect(() => {
    carregar();
    const id = setInterval(carregar, 15000);
    return () => clearInterval(id);
  }, [carregar]);
  return { real, carteiras, erro, atualizando, carregar };
}

function Tela() {
  const t = useTema();
  const s = useMemo(() => estilos(t), [t]);
  const [aba, setAba] = useState<Aba>("agora");
  const [atualizacao, setAtualizacao] = useState<Atualizacao | null>(null);
  const [oculto, setOculto] = useState(false);
  const conta = useConta();

  // Lembra se o saldo estava escondido
  useEffect(() => {
    AsyncStorage.getItem("saldo_oculto").then((v) => setOculto(v === "1")).catch(() => {});
  }, []);
  const alternarOculto = () => {
    const novo = !oculto;
    setOculto(novo);
    AsyncStorage.setItem("saldo_oculto", novo ? "1" : "0").catch(() => {});
  };

  // Procura versão nova ao abrir, ao voltar para o app e a cada 30 minutos
  // Registra este celular para receber os avisos de compra e venda
  useEffect(() => { registrarAvisos(); }, []);

  useEffect(() => {
    const checar = () => procurarAtualizacao().then(setAtualizacao);
    checar();
    const id = setInterval(checar, 30 * 60 * 1000);
    const sub = AppState.addEventListener("change", (e) => e === "active" && checar());
    const pararToque = ouvirToqueNaNotificacao();
    return () => { clearInterval(id); sub.remove(); pararToque(); };
  }, []);

  return (
    <SafeAreaView style={[s.raiz]} edges={["top", "left", "right"]}>
      <StatusBar style={t.escuro ? "light" : "dark"} />
      <View style={[s.conteudo, { maxWidth: 1120 }]}>
        <View style={s.cabecalho}>
          <Logo t={t} />
          <Text style={[s.titulo, { flex: 1 }]}>PanissAsset</Text>
          <Pressable onPress={alternarOculto} hitSlop={10} style={s.olho} accessibilityLabel={oculto ? "Mostrar saldo" : "Esconder saldo"}>
            <Olho t={t} fechado={oculto} />
          </Pressable>
          <View style={[s.selo, { borderColor: t.alta }]}>
            <View style={[s.ponto, { backgroundColor: t.alta }]} />
            <Text style={[s.seloTexto, { color: t.alta }]}>Real</Text>
          </View>
        </View>
        {atualizacao && (
          <Pressable onPress={baixarAtualizacao} style={s.avisoAtualizacao} accessibilityRole="button">
            <View style={{ flex: 1 }}>
              <Text style={s.avisoTitulo}>Atualização disponível</Text>
              <Text style={s.textoSuave}>Toque para baixar a versão nova e instalar.</Text>
            </View>
            <View style={s.avisoBotao}>
              <Text style={s.botaoTexto}>Baixar</Text>
            </View>
          </Pressable>
        )}
        <View style={s.abas}>
          {(["agora", "historico"] as Aba[]).map((a) => (
            <Pressable key={a} onPress={() => setAba(a)} style={[s.aba, aba === a && s.abaAtiva]} accessibilityRole="tab">
              <Text style={[s.abaTexto, aba === a && s.abaTextoAtivo]}>{a === "agora" ? "Agora" : "Histórico"}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <ScrollView contentContainerStyle={s.rolagem} refreshControl={<RefreshControl refreshing={conta.atualizando} onRefresh={conta.carregar} tintColor={t.acento} />}>
        <View style={s.conteudo}>
          {conta.erro && <Aviso t={t} s={s} texto={conta.erro} />}
          {!conta.real && !conta.erro && <ActivityIndicator color={t.acento} style={{ marginTop: 40 }} />}
          {conta.real && (aba === "agora"
            ? <Agora t={t} s={s} r={conta.real} carteiras={conta.carteiras} oculto={oculto} />
            : <Historico t={t} s={s} r={conta.real} oculto={oculto} />)}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const PARES = ["SOLUSDT", "ETHUSDT", "BNBUSDT", "BTCUSDT"];
const INTERVALOS = [
  { id: "15m", nome: "15 min", ms: 15 * 60_000 },
  { id: "1h", nome: "1 hora", ms: 3600_000 },
  { id: "4h", nome: "4 horas", ms: 4 * 3600_000 },
  { id: "1d", nome: "1 dia", ms: 24 * 3600_000 },
];

// ---------------- Agora ----------------
function Agora({ t, s, r, carteiras, oculto }: { t: Tema; s: Estilos; r: ContaReal; carteiras: Carteira[] | null; oculto: boolean }) {
  const banca = (carteiras ?? []).find((c) => ehBanca(c));
  // Moeda do gráfico: começa na que você tem; tocar numa posição aberta muda o gráfico
  const [par, setPar] = useState(PARES.find((p) => r.posicoes[p.replace("USDT", "")]) ?? "SOLUSDT");
  return (
    <View style={{ gap: 14 }}>
      <PosicoesCard r={r} t={t} s={s} oculto={oculto} aoTocar={setPar} />
      <ContaRealCard r={r} t={t} s={s} oculto={oculto} />
      <GraficoCard r={r} t={t} s={s} oculto={oculto} par={par} setPar={setPar} />
      {banca && <SinaisCard c={banca} t={t} s={s} />}
    </View>
  );
}

// Posições abertas em destaque, no topo: o que está comprado agora e se está no lucro
function PosicoesCard({ r, t, s, oculto, aoTocar }: { r: ContaReal; t: Tema; s: Estilos; oculto: boolean; aoTocar: (par: string) => void }) {
  const brl = r.usdt_brl ?? 0;
  const lista = Object.entries(r.posicoes ?? {}).map(([moeda, pos]) => {
    const m = r.moedas.find((x) => x.moeda === moeda);
    const preco = m && m.qtd ? m.usdt / m.qtd : pos.preco_medio;
    const res = (preco / pos.preco_medio - 1) * 100;
    const ganho = (preco - pos.preco_medio) * pos.qtd;
    return { moeda, pos, res, ganho };
  });
  return (
    <View style={[s.painel, { paddingVertical: 10, gap: 6 }]}>
      <View style={s.linhaEntre}>
        <Text style={[s.rotulo, { marginTop: 0, marginBottom: 0 }]}>Posições abertas</Text>
        <Text style={s.textoSuave}>{lista.length ? `${lista.length}` : "Nenhuma"}</Text>
      </View>
      {lista.map((p) => (
        <Pressable key={p.moeda} onPress={() => aoTocar(p.moeda + "USDT")} style={[s.linhaEntre, { paddingVertical: 4 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
            <View style={[s.ponto, { backgroundColor: p.res >= 0 ? t.alta : t.baixa }]} />
            <Text style={[s.textoNormal, { fontWeight: "600" }]}>{nomeMoeda(p.moeda + "USDT")}</Text>
            <Text style={s.textoSuave}>a {dinheiro(p.pos.preco_medio)}</Text>
          </View>
          <Text style={[s.textoNormal, { fontWeight: "700", color: corDoNumero(t, Math.round(p.res * 100) / 100) }]}>
            {pct(p.res)}{oculto ? "" : ` · ${p.ganho >= 0 ? "+" : "-"}${reais(Math.abs(p.ganho) * brl)}`}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function GraficoCard({ r, t, s, oculto, par, setPar }: { r: ContaReal; t: Tema; s: Estilos; oculto: boolean; par: string; setPar: (p: string) => void }) {
  const [intervalo, setIntervalo] = useState("1h");
  const [velas, setVelas] = useState<Vela[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const ler = () => buscarVelas(par, intervalo, 80).then((v) => { if (vivo) { setVelas(v); setErro(null); } }).catch((e) => vivo && setErro(e.message));
    setVelas([]);
    ler();
    const id = setInterval(ler, 15000);
    return () => { vivo = false; clearInterval(id); };
  }, [par, intervalo]);

  const moeda = par.replace("USDT", "");
  const pos = r.posicoes[moeda];
  const passoMs = INTERVALOS.find((i) => i.id === intervalo)!.ms;
  const marcas = r.operacoes.filter((o) => o.moeda === moeda).map((o) => ({ t: o.em, tipo: o.tipo, preco: o.preco_usdt }));
  const atual = velas.length ? velas[velas.length - 1].c : null;
  const variacao = velas.length ? (velas[velas.length - 1].c / velas[0].o - 1) * 100 : null;
  const resultado = pos && atual ? (atual / pos.preco_medio - 1) * 100 : null;
  const ganhoUsd = pos && atual ? (atual - pos.preco_medio) * pos.qtd : null;
  const brl = r.usdt_brl ?? 0;

  return (
    <View style={[s.painel, s.cartao]}>
      <View style={s.chips}>
        {PARES.map((p) => <Chip key={p} s={s} ativo={p === par} texto={nomeMoeda(p)} onPress={() => setPar(p)} />)}
      </View>
      <View style={s.linhaEntre}>
        <View>
          <Text style={s.rotulo}>{nomeMoeda(par)} · {moeda}/USDT</Text>
          <Text style={s.precoGrande}>{atual != null ? dinheiro(atual) : "-"}</Text>
          <Text style={[s.textoSuave, { color: corDoNumero(t, variacao) }]}>{pct(variacao)} no gráfico</Text>
        </View>
      </View>
      <View style={[s.chips, { marginBottom: 0 }]}>
        {INTERVALOS.map((i) => <Chip key={i.id} s={s} ativo={i.id === intervalo} texto={i.nome} onPress={() => setIntervalo(i.id)} />)}
      </View>
      {erro ? <Text style={[s.textoSuave, { color: t.baixa }]}>{erro}</Text> : velas.length ? (
        <Velas velas={velas} t={t} medio={pos?.preco_medio ?? null} marcas={marcas} passoMs={passoMs} />
      ) : <ActivityIndicator color={t.acento} style={{ height: 280 }} />}
      <LegendaVelas t={t} temPosicao={!!pos} />
      {pos ? (
        <View style={[s.indicador, { backgroundColor: resultado != null && resultado >= 0 ? t.altaFraca : t.baixaFraca }]}>
          <Text style={s.rotulo}>Sua posição em {nomeMoeda(par)}</Text>
          <View style={s.linhaEntre}>
            <Text style={s.textoNormal}>Comprou a {dinheiro(pos.preco_medio)}</Text>
            <Text style={[s.numero, { color: corDoNumero(t, resultado) }]}>{pct(resultado)}</Text>
          </View>
          <View style={s.linhaEntre}>
            <Text style={s.textoSuave}>{oculto ? "••••" : `${numero(pos.qtd, 6)} ${moeda}`}</Text>
            <Text style={[s.textoNormal, { color: corDoNumero(t, ganhoUsd) }]}>
              {ganhoUsd == null || oculto ? "••••" : `${ganhoUsd >= 0 ? "+" : "-"}${reais(Math.abs(ganhoUsd) * brl)}`}
            </Text>
          </View>
          <Text style={s.textoSuave}>
            {resultado == null ? "" : resultado >= 0 ? "Acima do preço que você pagou: no lucro." : "Abaixo do preço que você pagou: no prejuízo por enquanto."}
          </Text>
        </View>
      ) : (
        <Text style={s.textoSuave}>Você não tem {nomeMoeda(par)} agora. Quando o bot comprar, a linha do seu preço aparece no gráfico.</Text>
      )}
    </View>
  );
}

// RSI de cada moeda agora (o mesmo sinal que os bots usam)
function SinaisCard({ c, t, s }: { c: Carteira; t: Tema; s: Estilos }) {
  const ind = (c.indicadores ?? {}) as any;
  const precos: Record<string, number> = ind.precos ?? {};
  const rsis: Record<string, number | null> = ind.rsi ?? {};
  const pares = PARES.filter((p) => c.par.split(",").includes(p));
  return (
    <View style={[s.painel, s.cartao]}>
      <View style={s.linhaEntre}>
        <Text style={s.cartaoTitulo}>Sinais agora</Text>
        <Text style={s.textoSuave}>{dataHora(c.atualizado_em)}</Text>
      </View>
      <Text style={s.textoSuave}>RSI 14 · vela de 1 hora</Text>
      <View style={{ gap: 10 }}>
        {pares.map((p) => {
          const v = rsis[p];
          const sinal = v == null ? "-" : v < 30 ? "Sinal de compra" : v > 70 ? "Sinal de venda" : "Sem sinal";
          const cor = v == null ? t.suave : v < 30 ? t.alta : v > 70 ? t.baixa : t.suave;
          return (
            <View key={p} style={[s.indicador, { gap: 6 }]}>
              <View style={s.linhaEntre}>
                <Text style={[s.textoNormal, { fontWeight: "700" }]}>{nomeMoeda(p)}</Text>
                <Text style={s.textoNormal}>{dinheiro(precos[p])}</Text>
              </View>
              <View style={s.linhaEntre}>
                <Text style={s.textoSuave}>RSI {numero(v, 1)}</Text>
                <Text style={[s.textoSuave, { color: cor, fontWeight: "700" }]}>{sinal}</Text>
              </View>
              <View style={s.barra}>
                <View style={[s.barraZona, { left: 0, width: "30%", backgroundColor: t.altaFraca }]} />
                <View style={[s.barraZona, { left: "70%", width: "30%", backgroundColor: t.baixaFraca }]} />
                {v != null && <View style={[s.barraMarca, { left: `${Math.max(0, Math.min(100, v))}%`, backgroundColor: t.acento }]} />}
              </View>
              <View style={{ flexDirection: "row" }}>
                <Text style={[s.miudo, { width: "30%", color: t.alta }]}>Zona de compra</Text>
                <Text style={[s.miudo, { width: "40%", textAlign: "center" }]}>Meio</Text>
                <Text style={[s.miudo, { width: "30%", textAlign: "right", color: t.baixa }]}>Caro demais</Text>
              </View>
            </View>
          );
        })}
      </View>
      <Text style={s.regra}>O tracinho laranja é o RSI da moeda agora. Quando ele entra na parte verde (abaixo de 30), a moeda caiu bastante e o bot dela compra. Depois vende quando der 2,9% de lucro.</Text>
    </View>
  );
}

// Conta real da Binance: só mostra (o app não compra nem vende)
function ContaRealCard({ r, t, s, oculto }: { r: ContaReal; t: Tema; s: Estilos; oculto: boolean }) {
  const x = (v: string) => (oculto ? "••••" : v);
  return (
    <View style={[s.painel, s.cartao]}>
      <View style={s.linhaEntre}>
        <View style={{ flex: 1 }}>
          <Text style={s.rotulo}>Real - Binance</Text>
          <Text style={s.precoGrande}>{oculto ? "R$ ••••••" : reais(r.total_brl)}</Text>
          <Text style={s.textoSuave}>{x(dinheiro(r.total_usdt))}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={s.rotulo}>Atualizado</Text>
          <Text style={s.textoSuave}>{dataHora(r.atualizado_em)}</Text>
        </View>
      </View>
      {r.erro ? (
        <View style={[s.indicador, { backgroundColor: t.baixaFraca }]}>
          <Text style={[s.textoNormal, { color: t.baixa }]}>{r.erro}</Text>
        </View>
      ) : (
        r.moedas.map((m) => {
          const pos = r.posicoes[m.moeda];
          const preco = m.qtd ? m.usdt / m.qtd : 0;
          const res = pos ? (preco / pos.preco_medio - 1) * 100 : null;
          return (
            <View key={m.moeda} style={s.linhaEntre}>
              <View style={{ flex: 1 }}>
                <Text style={s.textoNormal}>{nomeMoeda(m.moeda + "USDT")}</Text>
                <Text style={s.textoSuave}>{x(m.qtd.toLocaleString("pt-BR", { maximumFractionDigits: 8 }))}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={s.textoNormal}>{x(reais(r.usdt_brl ? m.usdt * r.usdt_brl : null))}</Text>
                {res != null ? (
                  <Text style={[s.textoSuave, { color: corDoNumero(t, res) }]}>{pct(res)}</Text>
                ) : (
                  <Text style={s.textoSuave}>{x(dinheiro(m.usdt))}</Text>
                )}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

// ---------------- Histórico ----------------
const PERIODOS = [
  { nome: "Hoje", dias: 0 },
  { nome: "Semana", dias: 7 },
  { nome: "Mês", dias: 30 },
  { nome: "6 meses", dias: 182 },
  { nome: "1 ano", dias: 365 },
];

function inicioDe(dias: number) {
  if (dias === 0) { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  return Date.now() - dias * 24 * 3600_000;
}

function Historico({ t, s, r, oculto }: { t: Tema; s: Estilos; r: ContaReal; oculto: boolean }) {
  const brl = r.usdt_brl ?? 0;
  const [filtro, setFiltro] = useState<string>("todas");
  const ops = r.operacoes.filter((o) => filtro === "todas" || o.moeda === filtro);
  return (
    <View style={{ gap: 14 }}>
      <View style={[s.painel, s.cartao]}>
        <Text style={s.cartaoTitulo}>Lucro das vendas</Text>
        <View style={s.numeros}>
          {PERIODOS.map((p) => {
            const desde = inicioDe(p.dias);
            const vendas = r.operacoes.filter((o) => o.tipo === "venda" && o.em >= desde && o.lucro_usdt != null);
            const lucro = vendas.reduce((a, o) => a + (o.lucro_usdt ?? 0), 0);
            return (
              <View key={p.nome} style={[s.indicador, { flexGrow: 1, minWidth: 140 }]}>
                <Text style={s.rotulo}>{p.nome}</Text>
                <Text style={[s.numero, { color: corDoNumero(t, vendas.length ? lucro : null) }]}>
                  {oculto ? "••••" : `${lucro > 0 ? "+" : lucro < 0 ? "-" : ""}${reais(Math.abs(lucro) * brl)}`}
                </Text>
                <Text style={s.textoSuave}>{vendas.length} {vendas.length === 1 ? "venda" : "vendas"}</Text>
              </View>
            );
          })}
        </View>
        <Text style={s.textoSuave}>Conta só o que já foi vendido. O que ainda está comprado aparece na aba Agora.</Text>
      </View>

      <View style={[s.painel, s.cartao]}>
        <Text style={s.cartaoTitulo}>Operações</Text>
        <View style={[s.chips, { marginBottom: 0 }]}>
          <Chip s={s} ativo={filtro === "todas"} texto="Todas" onPress={() => setFiltro("todas")} />
          {PARES.map((p) => { const m = p.replace("USDT", ""); return <Chip key={m} s={s} ativo={filtro === m} texto={nomeMoeda(p)} onPress={() => setFiltro(m)} />; })}
        </View>
        {ops.length === 0 ? (
          <Text style={s.textoSuave}>Nenhuma operação ainda.</Text>
        ) : (
          ops.map((o, i) => <LinhaReal key={`${o.em}-${i}`} o={o} t={t} s={s} brl={brl} oculto={oculto} ultima={i === ops.length - 1} />)
        )}
      </View>
    </View>
  );
}

function LinhaReal({ o, t, s, brl, oculto, ultima }: { o: OperacaoReal; t: Tema; s: Estilos; brl: number; oculto: boolean; ultima: boolean }) {
  const compra = o.tipo === "compra";
  return (
    <View style={[s.linhaOp, !ultima && { borderBottomWidth: 1, borderBottomColor: t.borda }]}>
      <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: compra ? t.altaFraca : t.baixaFraca }}>
        <Svg width={12} height={12}><Path d={compra ? "M6 1 L11 10 L1 10 Z" : "M6 11 L11 2 L1 2 Z"} fill={compra ? t.alta : t.baixa} /></Svg>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.textoNormal, { fontWeight: "700" }]}>{compra ? "Compra" : "Venda"} · {nomeMoeda(o.moeda + "USDT")}</Text>
        <Text style={s.textoSuave}>{dataHora(o.em)} · a {dinheiro(o.preco_usdt)}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={s.textoNormal}>{oculto ? "••••" : reais(o.valor_usdt * brl)}</Text>
        {!compra && o.lucro_usdt != null && (
          <Text style={[s.textoSuave, { color: corDoNumero(t, o.lucro_usdt), fontWeight: "700" }]}>
            {o.lucro_usdt >= 0 ? "Lucro" : "Prejuízo"} {oculto ? "••••" : reais(Math.abs(o.lucro_usdt) * brl)} ({pct(o.lucro_pct)})
          </Text>
        )}
      </View>
    </View>
  );
}

// ---------------- Peças ----------------
function nomeMoeda(par: string) {
  return MOEDAS.find((m) => m.par === par)?.nome ?? par.replace("USDT", "");
}

// Testnet primeiro (banca na frente); depois as simuladas
function ordenar(l: Carteira[]) {
  const peso = (c: Carteira) => (c.modo === "simulado" ? 2 : ehBanca(c) ? 0 : 1);
  return [...l].sort((a, b) => peso(a) - peso(b));
}
function abreviar(n: number) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${numero(n / 1e6, 1)}M`;
  if (a >= 1e4) return `${numero(n / 1e3, 1)}mil`;
  if (a >= 100) return numero(n, 0);
  return numero(n, 2);
}

function Numero({ s, rotulo, valor, cor }: { s: Estilos; rotulo: string; valor: string; cor?: string }) {
  return (
    <View style={{ flexGrow: 1, minWidth: 118 }}>
      <Text style={s.rotulo}>{rotulo}</Text>
      <Text style={[s.numero, cor ? { color: cor } : null]}>{valor}</Text>
    </View>
  );
}

function Chip({ s, ativo, texto, onPress }: { s: Estilos; ativo: boolean; texto: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, ativo && s.chipAtivo]}>
      <Text style={[s.chipTexto, ativo && s.chipTextoAtivo]}>{texto}</Text>
    </Pressable>
  );
}

function Legenda({ s, cor, texto, triangulo }: { s: Estilos; cor: string; texto: string; triangulo?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {triangulo ? (
        <Svg width={10} height={10}><Path d="M5 1 L9 9 L1 9 Z" fill={cor} /></Svg>
      ) : (
        <View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: cor }} />
      )}
      <Text style={s.textoSuave}>{texto}</Text>
    </View>
  );
}

function Aviso({ t, s, texto }: { t: Tema; s: Estilos; texto: string }) {
  return (
    <View style={[s.painel, { borderColor: t.baixa, backgroundColor: t.baixaFraca, marginTop: 12 }]}>
      <Text style={[s.textoNormal, { color: t.baixa }]}>{texto} Puxe para baixo ou toque em atualizar para tentar de novo.</Text>
    </View>
  );
}

function Olho({ t, fechado }: { t: Tema; fechado: boolean }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" stroke={t.suave} strokeWidth={2} strokeLinejoin="round" />
      <Path d="M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z" fill={t.suave} />
      {fechado && <Path d="M3 3l18 18" stroke={t.suave} strokeWidth={2.2} strokeLinecap="round" />}
    </Svg>
  );
}

function Logo({ t }: { t: Tema }) {
  // Duas velas retas quase coladas formando um "P": a verde é a haste, a vermelha é a barriga
  return (
    <Svg width={40} height={40} viewBox="0 0 40 40">
      <Rect x={0} y={0} width={40} height={40} rx={11} fill={t.painel2} />
      <Rect x={9.9} y={2.8} width={9.5} height={34.3} rx={1.5} fill={t.alta} />
      <Rect x={21} y={2.8} width={9.5} height={17.8} rx={1.5} fill={t.baixa} />
    </Svg>
  );
}

type Estilos = ReturnType<typeof estilos>;
function estilos(t: Tema) {
  const tab = { fontVariant: ["tabular-nums" as const] };
  return StyleSheet.create({
    raiz: { flex: 1, backgroundColor: t.fundo },
    conteudo: { width: "100%", alignSelf: "center", maxWidth: 1120, paddingHorizontal: 16 },
    rolagem: { paddingBottom: 48 },
    cabecalho: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 12, paddingBottom: 14 },
    titulo: { color: t.texto, fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
    legenda: { color: t.suave, fontSize: 12.5, marginTop: 1 },
    olho: { padding: 6 },
    selo: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: t.acento, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
    seloTexto: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
    ponto: { width: 7, height: 7, borderRadius: 4 },
    abas: { flexDirection: "row", backgroundColor: t.painel2, borderRadius: 12, padding: 4, marginBottom: 6 },
    aba: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center" },
    abaAtiva: { backgroundColor: t.painel, shadowColor: "#000", shadowOpacity: t.escuro ? 0.3 : 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
    abaTexto: { color: t.suave, fontWeight: "600", fontSize: 14 },
    abaTextoAtivo: { color: t.texto },
    precoLinha: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 14, marginBottom: 12 },
    precoGrande: { color: t.texto, fontSize: 30, fontWeight: "800", letterSpacing: -0.5, ...tab },
    rotulo: { color: t.suave, fontSize: 11.5, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4, marginTop: 4 },
    grade: { gap: 12, marginTop: 4 },
    painel: { backgroundColor: t.painel, borderRadius: 14, borderWidth: 1, borderColor: t.borda, padding: 14 },
    cartao: { gap: 12 },
    cartaoTitulo: { color: t.texto, fontSize: 17, fontWeight: "700" },
    modo: { fontSize: 12, fontWeight: "700", marginTop: 3 },
    linhaEntre: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
    pilula: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
    pilulaTexto: { fontSize: 12.5, fontWeight: "700" },
    numeros: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    numero: { color: t.texto, fontSize: 18, fontWeight: "700", ...tab },
    textoNormal: { color: t.texto, fontSize: 14.5, lineHeight: 21, ...tab },
    textoSuave: { color: t.suave, fontSize: 13, lineHeight: 19, ...tab },
    miudo: { color: t.suave, fontSize: 10.5, ...tab },
    regra: { color: t.suave, fontSize: 13, lineHeight: 19, borderLeftWidth: 2, borderLeftColor: t.borda, paddingLeft: 10 },
    indicador: { backgroundColor: t.painel2, borderRadius: 10, padding: 12, gap: 6 },
    barra: { height: 10, borderRadius: 5, backgroundColor: t.borda, overflow: "hidden", position: "relative" },
    barraZona: { position: "absolute", top: 0, bottom: 0 },
    barraMarca: { position: "absolute", top: -1, bottom: -1, width: 4, marginLeft: -2, borderRadius: 2 },
    secao: { color: t.texto, fontSize: 16, fontWeight: "700", marginTop: 22, marginBottom: 8 },
    linhaOp: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
    rodape: { color: t.suave, fontSize: 12, lineHeight: 18, marginTop: 18 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
    chip: { borderWidth: 1, borderColor: t.borda, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: t.painel },
    chipAtivo: { borderColor: t.acento, backgroundColor: t.acentoFraco },
    chipTexto: { color: t.suave, fontWeight: "600", fontSize: 13.5 },
    chipTextoAtivo: { color: t.acento },
    tabLinha: { flexDirection: "row", alignItems: "center", paddingVertical: 11, paddingHorizontal: 6, borderRadius: 8 },
    tabCel: { flex: 1, color: t.texto, fontSize: 13.5, textAlign: "right", ...tab },
    tabCab: { color: t.suave, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
    legendaLinha: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
    botao: { backgroundColor: t.acento, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
    botaoTexto: { color: t.escuro ? "#1A1206" : "#FFFFFF", fontWeight: "700", fontSize: 15 },
    avisoAtualizacao: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: t.acentoFraco, borderColor: t.acento, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
    avisoTitulo: { color: t.texto, fontWeight: "700", fontSize: 14.5 },
    avisoBotao: { backgroundColor: t.acento, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 8 },
    botaoPequeno: { marginTop: 6, borderWidth: 1, borderColor: t.borda, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
    botaoPequenoTexto: { color: t.texto, fontSize: 12.5, fontWeight: "600" },
  });
}
