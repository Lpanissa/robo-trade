# Robô Trade

Robô de cripto em modo **simulado** (dinheiro de mentira). Ele roda sozinho na nuvem (Supabase) a cada 5 minutos, lê os preços públicos da Binance e testa duas estratégias: cruzamento de médias 9/21 e RSI 14.

- `supabase/functions/robo-trade`: o robô (estratégias, teste no histórico e carteiras simuladas)
- `app`: app Expo do painel (APK para Android e versão web para o PC)

O APK sai em **Releases** e a versão do PC fica no GitHub Pages. Nenhuma ordem é enviada para corretora.
