// Confere se saiu um APK novo no GitHub e avisa com uma notificação.
import { Linking, Platform } from "react-native";
import * as Notifications from "expo-notifications";

const REPO = "Lpanissa/robo-trade";
export const LINK_APK = `https://github.com/${REPO}/releases/latest/download/robo-trade.apk`;
// Número desta versão, colocado pelo GitHub na hora de gerar o APK
export const VERSAO_ATUAL = Number(process.env.EXPO_PUBLIC_BUILD ?? 0);

export type Atualizacao = { versao: number; nome: string };

if (Platform.OS === "android") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

let jaAvisou = 0;

export async function procurarAtualizacao(): Promise<Atualizacao | null> {
  if (Platform.OS !== "android" || !VERSAO_ATUAL) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) return null;
    const j = await r.json();
    const versao = Number(String(j.tag_name ?? "").split(".").pop());
    if (!versao || versao <= VERSAO_ATUAL) return null;
    const nova = { versao, nome: j.name ?? `Versão ${versao}` };
    if (jaAvisou !== versao) {
      jaAvisou = versao;
      await avisar(nova);
    }
    return nova;
  } catch {
    return null;
  }
}

async function avisar(a: Atualizacao) {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("atualizacoes", {
        name: "Atualizações do app",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const p = await Notifications.getPermissionsAsync();
    const ok = p.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!ok) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "PanissAsset: atualização disponível",
        body: "Toque para baixar a versão nova do app.",
        data: { link: LINK_APK },
      },
      trigger: Platform.OS === "android" ? { channelId: "atualizacoes" } as any : null,
    });
  } catch {
    // Sem notificação: o aviso dentro do app continua aparecendo
  }
}

// Tocar na notificação abre o download do APK
export function ouvirToqueNaNotificacao() {
  if (Platform.OS !== "android") return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    const link = resp.notification.request.content.data?.link;
    if (typeof link === "string") Linking.openURL(link);
  });
  return () => sub.remove();
}

export function baixarAtualizacao() {
  Linking.openURL(LINK_APK);
}
