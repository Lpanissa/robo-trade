// Avisos de compra e venda direto no app (Firebase Cloud Messaging), sem precisar do ntfy.
// O app pega o "endereço" deste celular e guarda no Supabase; o robô manda o aviso pra ele.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

const SB = "https://fyxksvydxwvygjebanno.supabase.co";
const CHAVE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5eGtzdnlkeHd2eWdqZWJhbm5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMzE5MDMsImV4cCI6MjEwNjcwNzkwM30.qUHr5gl00vF2JG7YaostqpOqhEMSEPSci1ySH1D-Fik";

export async function registrarAvisos() {
  if (Platform.OS !== "android") return;
  try {
    // Canal com prioridade alta: aparece no topo da tela e faz som
    await Notifications.setNotificationChannelAsync("operacoes", {
      name: "Compras e vendas",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      vibrationPattern: [0, 250, 150, 250],
    });
    const p = await Notifications.getPermissionsAsync();
    const ok = p.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!ok) return;
    const { data: token } = await Notifications.getDevicePushTokenAsync();
    if (!token) return;
    await fetch(`${SB}/rest/v1/robo_dispositivos?on_conflict=token`, {
      method: "POST",
      headers: {
        apikey: CHAVE,
        Authorization: `Bearer ${CHAVE}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal,resolution=merge-duplicates",
      },
      body: JSON.stringify({ token: String(token), plataforma: "android", visto_em: new Date().toISOString() }),
    });
  } catch {
    // Sem aviso no app: continua funcionando o resto
  }
}
