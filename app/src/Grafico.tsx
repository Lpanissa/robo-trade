import React, { useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Path, Polygon, Text as SvgText } from "react-native-svg";
import { Tema } from "./tema";

type Serie = { valores: number[]; cor: string; largura?: number; tracejado?: boolean };
type Marca = { i: number; tipo: "compra" | "venda" };

type Props = {
  tema: Tema;
  series: Serie[];
  tempos: number[];
  marcas?: Marca[];
  formato: (n: number) => string;
  altura?: number;
};

const ROTULO = 64; // espaço à direita para os valores

export default function Grafico({ tema, series, tempos, marcas = [], formato, altura = 200 }: Props) {
  const [largura, setLargura] = useState(0);
  const todos = series.flatMap((s) => s.valores).filter((v) => isFinite(v));
  const n = tempos.length;

  let corpo = null;
  if (largura > 0 && todos.length && n > 1) {
    let min = Math.min(...todos), max = Math.max(...todos);
    if (min === max) { min -= 1; max += 1; }
    const folga = (max - min) * 0.08;
    min -= folga; max += folga;
    const topo = 8, base = altura - 22, w = largura - ROTULO;
    const x = (i: number) => (i / (n - 1)) * w;
    const y = (v: number) => base - ((v - min) / (max - min)) * (base - topo);

    const grade = [0, 1, 2, 3].map((k) => min + ((max - min) * (k + 0.5)) / 4);
    const caminho = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const dt = (t: number) => new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

    corpo = (
      <Svg width={largura} height={altura}>
        {grade.map((g, k) => (
          <React.Fragment key={k}>
            <Line x1={0} x2={w} y1={y(g)} y2={y(g)} stroke={tema.borda} strokeWidth={1} />
            <SvgText x={w + 6} y={y(g) + 4} fontSize={10} fill={tema.suave}>{formato(g)}</SvgText>
          </React.Fragment>
        ))}
        {series.map((s, k) => (
          <Path key={k} d={caminho(s.valores)} stroke={s.cor} strokeWidth={s.largura ?? 2} fill="none" strokeDasharray={s.tracejado ? "4 4" : undefined} strokeLinejoin="round" />
        ))}
        {marcas.map((m, k) => {
          const v = series[0].valores[m.i];
          if (v == null) return null;
          const cx = x(m.i), cy = y(v);
          return m.tipo === "compra" ? (
            <Polygon key={k} points={`${cx},${cy + 3} ${cx - 5},${cy + 12} ${cx + 5},${cy + 12}`} fill={tema.alta} />
          ) : (
            <Polygon key={k} points={`${cx},${cy - 3} ${cx - 5},${cy - 12} ${cx + 5},${cy - 12}`} fill={tema.baixa} />
          );
        })}
        {series[0] && (
          <Circle cx={x(n - 1)} cy={y(series[0].valores[n - 1])} r={3.5} fill={series[0].cor} />
        )}
        <SvgText x={0} y={altura - 4} fontSize={10} fill={tema.suave}>{dt(tempos[0])}</SvgText>
        <SvgText x={w / 2} y={altura - 4} fontSize={10} fill={tema.suave} textAnchor="middle">{dt(tempos[Math.floor((n - 1) / 2)])}</SvgText>
        <SvgText x={w} y={altura - 4} fontSize={10} fill={tema.suave} textAnchor="end">{dt(tempos[n - 1])}</SvgText>
      </Svg>
    );
  }

  return (
    <View style={{ height: altura, width: "100%" }} onLayout={(e) => setLargura(e.nativeEvent.layout.width)}>
      {corpo}
    </View>
  );
}
