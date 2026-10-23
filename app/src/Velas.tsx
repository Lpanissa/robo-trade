// Gráfico de velas (candles) com a sua posição: linha do preço que você pagou
// e marcas das compras e vendas. Só mostra, não opera.
import React, { useState } from "react";
import { View, Text } from "react-native";
import Svg, { G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { Tema } from "./tema";

export type Vela = { t: number; o: number; h: number; l: number; c: number };
export type Marca = { t: number; tipo: "compra" | "venda"; preco: number };

const EIXO = 64;
const ALTURA = 280;

function formatar(n: number) {
  const casas = n >= 1000 ? 0 : n >= 10 ? 2 : n >= 0.01 ? 4 : Math.min(10, 2 - Math.floor(Math.log10(n)) + 1);
  return n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export default function Velas({ velas, t, medio, alvo, marcas, passoMs }: { velas: Vela[]; t: Tema; medio: number | null; alvo?: number | null; marcas: Marca[]; passoMs: number }) {
  const [largura, setLargura] = useState(0);
  if (!velas.length) return <View style={{ height: ALTURA }} />;

  const W = Math.max(0, largura - EIXO);
  const n = velas.length;
  let min = Math.min(...velas.map((v) => v.l));
  let max = Math.max(...velas.map((v) => v.h));
  if (medio != null && medio > 0) { min = Math.min(min, medio); max = Math.max(max, medio); }
  if (alvo != null && alvo > 0) { min = Math.min(min, alvo); max = Math.max(max, alvo); }
  const folga = (max - min) * 0.08 || max * 0.01;
  min -= folga; max += folga;
  const y = (p: number) => ((max - p) / (max - min)) * ALTURA;
  const passo = W / n;
  const corpo = Math.max(1.5, passo * 0.68);
  const x = (i: number) => i * passo + passo / 2;
  const ultimo = velas[n - 1].c;
  const subiu = ultimo >= velas[0].o;
  const corUlt = velas[n - 1].c >= velas[n - 1].o ? t.alta : t.baixa;

  const linhas = 4;
  const grade = Array.from({ length: linhas + 1 }, (_, i) => min + ((max - min) * i) / linhas);

  const idxDe = (tempo: number) => {
    const i = velas.findIndex((v) => tempo >= v.t && tempo < v.t + passoMs);
    return i;
  };

  const etiqueta = (preco: number, cor: string, texto?: string) => {
    const yy = Math.min(ALTURA - 9, Math.max(9, y(preco)));
    return (
      <G>
        <Rect x={W + 2} y={yy - 9} width={EIXO - 4} height={18} rx={4} fill={cor} />
        <SvgText x={W + EIXO / 2} y={yy + 4} fontSize={10.5} fontWeight="700" fill="#fff" textAnchor="middle">{texto ?? formatar(preco)}</SvgText>
      </G>
    );
  };

  return (
    <View onLayout={(e) => setLargura(e.nativeEvent.layout.width)} style={{ height: ALTURA }}>
      {largura > 0 && (
        <Svg width={largura} height={ALTURA}>
          {grade.map((p, i) => (
            <G key={i}>
              <Line x1={0} x2={W} y1={y(p)} y2={y(p)} stroke={t.borda} strokeWidth={1} />
              <SvgText x={W + 6} y={y(p) + 4} fontSize={10} fill={t.suave}>{formatar(p)}</SvgText>
            </G>
          ))}
          {velas.map((v, i) => {
            const cor = v.c >= v.o ? t.alta : t.baixa;
            const topo = y(Math.max(v.o, v.c));
            const alt = Math.max(1, Math.abs(y(v.o) - y(v.c)));
            return (
              <G key={v.t}>
                <Line x1={x(i)} x2={x(i)} y1={y(v.h)} y2={y(v.l)} stroke={cor} strokeWidth={1} />
                <Rect x={x(i) - corpo / 2} y={topo} width={corpo} height={alt} fill={cor} />
              </G>
            );
          })}
          {medio != null && medio > 0 && (
            <G>
              <Line x1={0} x2={W} y1={y(medio)} y2={y(medio)} stroke={t.acento} strokeWidth={1.5} strokeDasharray="6 4" />
              {etiqueta(medio, t.acento)}
            </G>
          )}
          {alvo != null && alvo > 0 && (
            <G>
              <Line x1={0} x2={W} y1={y(alvo)} y2={y(alvo)} stroke={t.alta} strokeWidth={1.5} strokeDasharray="6 4" />
              {etiqueta(alvo, t.alta)}
            </G>
          )}
          <Line x1={0} x2={W} y1={y(ultimo)} y2={y(ultimo)} stroke={corUlt} strokeWidth={1} strokeDasharray="2 3" />
          {etiqueta(ultimo, corUlt)}
          {marcas.map((m, k) => {
            const i = idxDe(m.t);
            if (i < 0) return null;
            const v = velas[i];
            const cx = x(i);
            if (m.tipo === "compra") {
              const yy = y(v.l) + 6;
              return <Path key={k} d={`M${cx} ${yy} L${cx + 6} ${yy + 10} L${cx - 6} ${yy + 10} Z`} fill={t.alta} stroke={t.fundo} strokeWidth={1} />;
            }
            const yy = y(v.h) - 6;
            return <Path key={k} d={`M${cx} ${yy} L${cx + 6} ${yy - 10} L${cx - 6} ${yy - 10} Z`} fill={t.baixa} stroke={t.fundo} strokeWidth={1} />;
          })}
        </Svg>
      )}
      {!subiu && null}
    </View>
  );
}

export function LegendaVelas({ t, temPosicao, alvoPct = 2.9 }: { t: Tema; temPosicao: boolean; alvoPct?: number }) {
  const item = (cor: string, texto: string, tracejado = false, tri?: "up" | "down") => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {tri ? (
        <Svg width={10} height={10}><Path d={tri === "up" ? "M5 1 L9 9 L1 9 Z" : "M5 9 L9 1 L1 1 Z"} fill={cor} /></Svg>
      ) : (
        <View style={{ width: 16, height: 0, borderTopWidth: 2, borderColor: cor, borderStyle: tracejado ? "dashed" : "solid" }} />
      )}
      <Text style={{ color: t.suave, fontSize: 12 }}>{texto}</Text>
    </View>
  );
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
      {temPosicao && item(t.acento, "Seu preço de compra", true)}
      {temPosicao && item(t.alta, `Alvo de venda (+${alvoPct.toLocaleString("pt-BR")}%)`, true)}
      {item(t.alta, "Compra", false, "up")}
      {item(t.baixa, "Venda", false, "down")}
    </View>
  );
}
