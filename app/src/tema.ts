import { useColorScheme } from "react-native";

const escuro = {
  fundo: "#10141C",
  painel: "#171C26",
  painel2: "#1E2431",
  borda: "#262E3D",
  texto: "#E8ECF3",
  suave: "#8A93A6",
  acento: "#E9A23B",
  acentoFraco: "rgba(233,162,59,0.14)",
  alta: "#2FBF8A",
  baixa: "#E5534B",
  altaFraca: "rgba(47,191,138,0.14)",
  baixaFraca: "rgba(229,83,75,0.14)",
  segurar: "#6F7B93",
  escuro: true,
};

const claro: typeof escuro = {
  fundo: "#F3F5F9",
  painel: "#FFFFFF",
  painel2: "#EEF1F6",
  borda: "#DCE1EA",
  texto: "#131925",
  suave: "#5D6678",
  acento: "#B46F0C",
  acentoFraco: "rgba(180,111,12,0.12)",
  alta: "#13865C",
  baixa: "#C3352D",
  altaFraca: "rgba(19,134,92,0.12)",
  baixaFraca: "rgba(195,53,45,0.12)",
  segurar: "#8A94A8",
  escuro: false,
};

export type Tema = typeof escuro;

export function useTema(): Tema {
  return useColorScheme() === "light" ? claro : escuro;
}

export const corDoNumero = (t: Tema, n: number | null | undefined) => (n == null || n === 0 ? t.texto : n > 0 ? t.alta : t.baixa);
