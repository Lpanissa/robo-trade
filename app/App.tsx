import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Svg, { Path, Rect } from "react-native-svg";
import {
  buscarCarteiras, buscarOperacoes, buscarTeste, Carteira, data, dataHora, dinheiro, Estrategia, MOEDAS,
  NOME_ESTRATEGIA, NOME_TEMPO, numero, Operacao, pct, Teste,
} from "./src/api";
import Grafico from "./src/Grafico";
import { corDoNumero, Tema, useTema } from "./src/tema";

type Aba = "agora" | "historico";

const REGRA: Record<Estrategia, string> = {
  medias: "Compra quando a média de 9 velas cruza para cima da média de 21. Vende quando cruza para baixo.",
  rsi: "Compra quando o RSI cai abaixo de 30 (caiu demais). Vende quando passa de 70 (subiu demais).",
  combo: "Compra quando a média de 9 cruza para cima da de 21 e o RSI está abaixo de 65. Vende quando o RSI passa de 70 ou as médias cruzam para baixo.",
};

export default function App() {
  return (
    <SafeAreaProvider>
      <Tela />
    </SafeAreaProvider>
  );
}

function Tela() {
  const t = useTema();
  const s = useMemo(() => estilos(t), [t]);
  const { width } = useWindowDimensions();
  const largo = width >= 900;
  const [aba, setAba] = useState<Aba>("agora");

  return (
    <SafeAreaView style={[s.raiz]} edges={["top", "left", "right"]}>
      <StatusBar style={t.escuro ? "light" : "dark"} />
      <View style={[s.conteudo, { maxWidth: 1120 }]}>
        <View style={s.cabecalho}>
          <Logo t={t} />
          <View style={{ flex: 1 }}>
            <Text style={s.titulo}>PanissAsset</Text>
            <Text style={s.legenda}>Roda sozinho na nuvem a cada 5 minutos</Text>
          </View>
          <View style={s.selo}>
            <View style={[s.ponto, { backgroundColor: t.acento }]} />
            <Text style={[s.seloTexto, { color: t.acento }]}>Simulado</Text>
          </View>
        </View>
        <View style={s.abas}>
          {(["agora", "historico"] as Aba[]).map((a) => (
            <Pressable key={a} onPress={() => setAba(a)} style={[s.aba, aba === a && s.abaAtiva]} accessibilityRole="tab">
              <Text style={[s.abaTexto, aba === a && s.abaTextoAtivo]}>{a === "agora" ? "Agora" : "Teste no histórico"}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {aba === "agora" ? <Agora t={t} s={s} largo={largo} /> : <Historico t={t} s={s} largo={largo} />}
    </SafeAreaView>
  );
}

// ---------------- Agora ----------------
function Agora({ t, s, largo }: { t: Tema; s: Estilos; largo: boolean }) {
  const [carteiras, setCarteiras] = useState<Carteira[] | null>(null);
  const [ops, setOps] = useState<Operacao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);

  const carregar = useCallback(async () => {
    setAtualizando(true);
    try {
      const [c, o] = await Promise.all([buscarCarteiras(), buscarOperacoes()]);
      setCarteiras(c); setOps(o); setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, 30000);
    return () => clearInterval(id);
  }, [carregar]);

  const preco = carteiras?.[0]?.ultimo_preco;
  const atualizado = carteiras?.length ? carteiras.map((c) => c.atualizado_em).sort().pop()! : null;

  return (
    <ScrollView contentContainerStyle={s.rolagem} refreshControl={<RefreshControl refreshing={atualizando} onRefresh={carregar} tintColor={t.acento} />}>
      <View style={s.conteudo}>
        {erro && <Aviso t={t} s={s} texto={erro} />}
        {!carteiras && !erro && <ActivityIndicator color={t.acento} style={{ marginTop: 40 }} />}
        {carteiras && (
          <>
            <View style={s.precoLinha}>
              <View>
                <Text style={s.rotulo}>Bitcoin agora</Text>
                <Text style={s.precoGrande}>{dinheiro(preco)}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={s.rotulo}>Atualizado</Text>
                <Text style={s.textoSuave}>{atualizado ? dataHora(atualizado) : "-"}</Text>
                {Platform.OS === "web" && (
                  <Pressable onPress={carregar} style={s.botaoPequeno}>
                    <Text style={s.botaoPequenoTexto}>Atualizar</Text>
                  </Pressable>
                )}
              </View>
            </View>
            <View style={[s.grade, largo && { flexDirection: "row" }]}>
              {carteiras.map((c) => (
                <CarteiraCard key={c.id} c={c} t={t} s={s} ops={ops.filter((o) => o.carteira === c.id)} />
              ))}
            </View>
            <Text style={s.secao}>Últimas operações</Text>
            <View style={s.painel}>
              {ops.length === 0 ? (
                <Text style={s.textoSuave}>
                  Nenhuma operação ainda. O robô começou agora e só compra quando aparecer um sinal. Na vela de 1 hora isso pode levar algumas horas ou dias.
                </Text>
              ) : (
                ops.map((o, i) => <LinhaOperacao key={o.id} o={o} t={t} s={s} ultima={i === ops.length - 1} />)
              )}
            </View>
            <Text style={s.rodape}>
              Simulação com dinheiro de mentira. Nenhuma ordem é enviada para corretora. Taxa de 0,1% por operação já descontada.
            </Text>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function CarteiraCard({ c, t, s, ops }: { c: Carteira; t: Tema; s: Estilos; ops: Operacao[] }) {
  const preco = c.ultimo_preco ?? 0;
  const patrimonio = c.caixa + c.qtd * preco;
  const lucro = (patrimonio / c.saldo_inicial - 1) * 100;
  const comprado = c.qtd > 0;
  const desdeCompra = comprado && c.compra_preco ? (preco / c.compra_preco - 1) * 100 : null;
  const vendas = ops.filter((o) => o.tipo === "venda" && o.resultado_pct != null);
  const acertos = vendas.filter((o) => (o.resultado_pct ?? 0) > 0).length;
  const ind = c.indicadores ?? {};

  return (
    <View style={[s.painel, s.cartao]}>
      <View style={s.linhaEntre}>
        <View style={{ flex: 1 }}>
          <Text style={s.cartaoTitulo}>{NOME_ESTRATEGIA[c.estrategia]}</Text>
          <Text style={s.textoSuave}>{c.par.replace("USDT", "")} · vela de {NOME_TEMPO[c.tempo] ?? c.tempo}</Text>
          <Text style={[s.modo, { color: c.modo === "simulado" ? t.suave : t.acento }]}>
            {c.modo === "testnet" ? "Binance Testnet · ordens de verdade com dinheiro de teste" : c.modo === "real" ? "Binance · conta real" : "Só anotando (sem ordens)"}
          </Text>
        </View>
        <View style={[s.pilula, { backgroundColor: comprado ? t.altaFraca : t.painel2 }]}>
          <View style={[s.ponto, { backgroundColor: comprado ? t.alta : t.suave }]} />
          <Text style={[s.pilulaTexto, { color: comprado ? t.alta : t.suave }]}>{comprado ? "Comprado" : "Esperando sinal"}</Text>
        </View>
      </View>

      <View style={s.numeros}>
        <Numero s={s} rotulo="Saldo simulado" valor={dinheiro(patrimonio)} />
        <Numero s={s} rotulo="Resultado" valor={pct(lucro)} cor={corDoNumero(t, Math.round(lucro * 10) / 10)} />
        <Numero s={s} rotulo="Operações" valor={`${vendas.length}${vendas.length ? ` · ${acertos} certas` : ""}`} />
      </View>

      {c.erro && (
        <View style={[s.indicador, { backgroundColor: t.baixaFraca }]}>
          <Text style={[s.textoNormal, { color: t.baixa }]}>{c.erro}</Text>
        </View>
      )}

      {c.modo !== "simulado" && c.limite_perda_dia != null && (
        <Text style={s.textoSuave}>
          Usa até {dinheiro(c.saldo_inicial)} por operação. Para de comprar no dia se perder {dinheiro(c.limite_perda_dia)}.
        </Text>
      )}

      {comprado && (
        <Text style={s.textoNormal}>
          Comprou a {dinheiro(c.compra_preco)} em {c.compra_em ? dataHora(c.compra_em) : "-"}. Desde então:{" "}
          <Text style={{ color: corDoNumero(t, desdeCompra) }}>{pct(desdeCompra)}</Text>
        </Text>
      )}

      {c.estrategia !== "medias" && <BarraRsi t={t} s={s} valor={ind.rsi ?? null} />}
      {c.estrategia !== "rsi" && (
        <View style={s.indicador}>
          <Text style={s.rotulo}>Médias agora</Text>
          <Text style={s.textoNormal}>
            Média 9: {numero(ind.media_rapida)} · Média 21: {numero(ind.media_lenta)}
          </Text>
          {ind.media_rapida != null && ind.media_lenta != null && (
            <Text style={s.textoSuave}>
              {ind.media_rapida > ind.media_lenta ? "A rápida está acima da lenta (tendência de alta)." : "A rápida está abaixo da lenta (tendência de baixa)."}
            </Text>
          )}
        </View>
      )}
      <Text style={s.regra}>{REGRA[c.estrategia]}</Text>
      <Text style={s.textoSuave}>Começou em {data(c.criado_em)} com {dinheiro(c.saldo_inicial)}</Text>
    </View>
  );
}

function BarraRsi({ t, s, valor }: { t: Tema; s: Estilos; valor: number | null }) {
  const v = valor ?? 50;
  const zona = valor == null ? "" : v < 30 ? "Abaixo de 30: sinal de compra" : v > 70 ? "Acima de 70: sinal de venda" : "Entre 30 e 70: sem sinal";
  return (
    <View style={s.indicador}>
      <View style={s.linhaEntre}>
        <Text style={s.rotulo}>RSI agora</Text>
        <Text style={[s.textoNormal, { fontWeight: "700" }]}>{numero(valor, 1)}</Text>
      </View>
      <View style={s.barra}>
        <View style={[s.barraZona, { left: 0, width: "30%", backgroundColor: t.altaFraca }]} />
        <View style={[s.barraZona, { left: "70%", width: "30%", backgroundColor: t.baixaFraca }]} />
        {valor != null && <View style={[s.barraMarca, { left: `${Math.max(0, Math.min(100, v))}%`, backgroundColor: t.acento }]} />}
      </View>
      <View style={s.linhaEntre}>
        <Text style={s.miudo}>0</Text>
        <Text style={s.miudo}>30</Text>
        <Text style={s.miudo}>70</Text>
        <Text style={s.miudo}>100</Text>
      </View>
      <Text style={s.textoSuave}>{zona}</Text>
    </View>
  );
}

function LinhaOperacao({ o, t, s, ultima }: { o: Operacao; t: Tema; s: Estilos; ultima: boolean }) {
  const compra = o.tipo === "compra";
  return (
    <View style={[s.linhaOp, !ultima && { borderBottomWidth: 1, borderBottomColor: t.borda }]}>
      <View style={[s.pilula, { backgroundColor: compra ? t.altaFraca : t.baixaFraca, minWidth: 74, justifyContent: "center" }]}>
        <Text style={[s.pilulaTexto, { color: compra ? t.alta : t.baixa }]}>{compra ? "Compra" : "Venda"}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.textoNormal}>
          {dinheiro(o.preco)} · {NOME_ESTRATEGIA[o.carteira.split("_")[0] as Estrategia]}
        </Text>
        {o.motivo && <Text style={s.textoSuave} numberOfLines={2}>{o.motivo}</Text>}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        {o.resultado_pct != null && <Text style={[s.textoNormal, { color: corDoNumero(t, o.resultado_pct), fontWeight: "700" }]}>{pct(o.resultado_pct)}</Text>}
        <Text style={s.textoSuave}>{dataHora(o.em)}</Text>
      </View>
    </View>
  );
}

// ---------------- Histórico ----------------
function Historico({ t, s, largo }: { t: Tema; s: Estilos; largo: boolean }) {
  const [par, setPar] = useState("BTCUSDT");
  const [tempo, setTempo] = useState("1h");
  const [ver, setVer] = useState<Estrategia>("rsi");
  const [testes, setTestes] = useState<Record<Estrategia, Teste> | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (forcar = false) => {
    setCarregando(true); setErro(null);
    try {
      setTestes(await buscarTeste(par, tempo, forcar));
    } catch (e) {
      setErro((e as Error).message); setTestes(null);
    } finally {
      setCarregando(false);
    }
  }, [par, tempo]);

  useEffect(() => { carregar(); }, [carregar]);

  const teste = testes?.[ver];
  const melhor = testes
    ? ([["medias", testes.medias.resultado_pct], ["rsi", testes.rsi.resultado_pct], ["combo", testes.combo?.resultado_pct ?? -Infinity], ["segurar", testes.rsi.segurar_pct]] as [string, number][]).sort((a, b) => b[1] - a[1])[0][0]
    : null;

  const marcas = useMemo(() => {
    if (!teste) return [];
    return teste.marcas.map((m) => {
      let i = teste.serie.findIndex((p) => p.t >= m.t);
      if (i < 0) i = teste.serie.length - 1;
      return { i, tipo: m.tipo };
    });
  }, [teste]);

  const nomeMoeda = MOEDAS.find((m) => m.par === par)?.nome ?? par;

  return (
    <ScrollView contentContainerStyle={s.rolagem}>
      <View style={s.conteudo}>
        <Text style={s.rotulo}>Moeda</Text>
        <View style={s.chips}>
          {MOEDAS.map((m) => (
            <Chip key={m.par} s={s} ativo={par === m.par} texto={m.nome} onPress={() => setPar(m.par)} />
          ))}
        </View>
        <Text style={s.rotulo}>Tempo de cada vela</Text>
        <View style={s.chips}>
          {Object.entries(NOME_TEMPO).map(([k, v]) => (
            <Chip key={k} s={s} ativo={tempo === k} texto={v} onPress={() => setTempo(k)} />
          ))}
        </View>

        {erro && <Aviso t={t} s={s} texto={erro} />}
        {carregando && <ActivityIndicator color={t.acento} style={{ marginVertical: 32 }} />}

        {testes && !carregando && (
          <>
            <Text style={s.secao}>
              {nomeMoeda}, de {data(testes.rsi.inicio)} a {data(testes.rsi.fim)}
            </Text>
            <Text style={s.textoSuave}>
              {numero(testes.rsi.candles)} velas de {NOME_TEMPO[tempo]}. Começando com {dinheiro(testes.rsi.saldo_inicial)}.
            </Text>

            <View style={[s.painel, { marginTop: 12, paddingVertical: 4 }]}>
              <View style={[s.tabLinha, { borderBottomWidth: 1, borderBottomColor: t.borda }]}>
                <Text style={[s.tabCel, s.tabCab, { flex: 1.6, textAlign: "left" }]}>Estratégia</Text>
                <Text style={[s.tabCel, s.tabCab]}>Resultado</Text>
                {largo && <Text style={[s.tabCel, s.tabCab]}>Operações</Text>}
                <Text style={[s.tabCel, s.tabCab]}>Acertos</Text>
                <Text style={[s.tabCel, s.tabCab]}>Maior queda</Text>
              </View>
              {(["medias", "rsi", "combo"] as Estrategia[]).filter((e) => testes[e]).map((e) => {
                const r = testes[e];
                return (
                  <Pressable key={e} onPress={() => setVer(e)} style={[s.tabLinha, ver === e && { backgroundColor: t.acentoFraco }]}>
                    <Text style={[s.tabCel, { flex: 1.6, textAlign: "left", fontWeight: "600", color: t.texto }]}>
                      {NOME_ESTRATEGIA[e]}{melhor === e ? "  ·  melhor" : ""}
                    </Text>
                    <Text style={[s.tabCel, { color: corDoNumero(t, r.resultado_pct), fontWeight: "700" }]}>{pct(r.resultado_pct)}</Text>
                    {largo && <Text style={s.tabCel}>{r.operacoes}</Text>}
                    <Text style={s.tabCel}>{r.operacoes ? `${numero(r.acertos_pct)}%` : "-"}</Text>
                    <Text style={s.tabCel}>{pct(-r.maior_queda_pct)}</Text>
                  </Pressable>
                );
              })}
              <View style={s.tabLinha}>
                <Text style={[s.tabCel, { flex: 1.6, textAlign: "left", color: t.texto }]}>
                  Só comprar e segurar{melhor === "segurar" ? "  ·  melhor" : ""}
                </Text>
                <Text style={[s.tabCel, { color: corDoNumero(t, testes.rsi.segurar_pct), fontWeight: "700" }]}>{pct(testes.rsi.segurar_pct)}</Text>
                {largo && <Text style={s.tabCel}>1</Text>}
                <Text style={s.tabCel}>-</Text>
                <Text style={s.tabCel}>-</Text>
              </View>
            </View>
            <Text style={[s.textoSuave, { marginTop: 6 }]}>Toque numa estratégia para ver os gráficos dela.</Text>

            {teste && (
              <View style={[s.grade, largo && { flexDirection: "row" }]}>
                <View style={[s.painel, s.cartao]}>
                  <Text style={s.cartaoTitulo}>Preço e operações · {NOME_ESTRATEGIA[ver]}</Text>
                  <View style={s.legendaLinha}>
                    <Legenda s={s} cor={t.alta} texto="Compra" triangulo />
                    <Legenda s={s} cor={t.baixa} texto="Venda" triangulo />
                  </View>
                  <Grafico
                    tema={t}
                    tempos={teste.serie.map((p) => p.t)}
                    series={[{ valores: teste.serie.map((p) => p.preco), cor: t.texto, largura: 1.5 }]}
                    marcas={marcas}
                    formato={(n) => abreviar(n)}
                    altura={220}
                  />
                </View>
                <View style={[s.painel, s.cartao]}>
                  <Text style={s.cartaoTitulo}>Saldo: robô x só segurar</Text>
                  <View style={s.legendaLinha}>
                    <Legenda s={s} cor={t.acento} texto={`Robô ${pct(teste.resultado_pct)}`} />
                    <Legenda s={s} cor={t.segurar} texto={`Segurar ${pct(teste.segurar_pct)}`} />
                  </View>
                  <Grafico
                    tema={t}
                    tempos={teste.serie.map((p) => p.t)}
                    series={[
                      { valores: teste.serie.map((p) => p.patrimonio), cor: t.acento, largura: 2.2 },
                      { valores: teste.serie.map((p) => p.segurar), cor: t.segurar, largura: 1.5, tracejado: true },
                    ]}
                    formato={(n) => `$${abreviar(n)}`}
                    altura={220}
                  />
                </View>
              </View>
            )}

            {teste && (
              <>
                <Text style={s.secao}>Operações do teste · {NOME_ESTRATEGIA[ver]}</Text>
                <View style={s.painel}>
                  {teste.lista.length === 0 ? (
                    <Text style={s.textoSuave}>Nenhuma operação completa nesse período.</Text>
                  ) : (
                    teste.lista.map((o, i) => (
                      <View key={i} style={[s.linhaOp, i < teste.lista.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.borda }]}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.textoNormal}>
                            {dinheiro(o.compra_preco)} → {dinheiro(o.venda_preco)}
                          </Text>
                          <Text style={s.textoSuave}>
                            {dataHora(o.compra_em)} até {dataHora(o.venda_em)}
                          </Text>
                        </View>
                        <Text style={[s.textoNormal, { color: corDoNumero(t, o.resultado_pct), fontWeight: "700" }]}>{pct(o.resultado_pct)}</Text>
                      </View>
                    ))
                  )}
                </View>
                {teste.posicao_aberta && <Text style={[s.textoSuave, { marginTop: 6 }]}>No fim do período o robô ainda estava comprado.</Text>}
              </>
            )}

            <Pressable onPress={() => carregar(true)} style={[s.botao, { marginTop: 20 }]}>
              <Text style={s.botaoTexto}>Refazer o teste com os preços de agora</Text>
            </Pressable>
            <Text style={s.rodape}>Resultado passado não garante resultado futuro. Taxa de 0,1% por operação já descontada.</Text>
          </>
        )}
      </View>
    </ScrollView>
  );
}

// ---------------- Peças ----------------
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
    cartao: { flex: 1, gap: 12 },
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
    botaoPequeno: { marginTop: 6, borderWidth: 1, borderColor: t.borda, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
    botaoPequenoTexto: { color: t.texto, fontSize: 12.5, fontWeight: "600" },
  });
}
