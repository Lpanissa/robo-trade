//+------------------------------------------------------------------+
//| PanissAsset WIN - robô RSI para mini-índice no MetaTrader 5        |
//|                                                                  |
//| Regra: compra quando o RSI da vela que fechou fica abaixo de 30  |
//| e zera quando passa de 70. Só abre posição no horário do pregão, |
//| zera tudo no fim do dia e para se bater a perda máxima do dia.   |
//|                                                                  |
//| Teste SEMPRE primeiro numa conta demo. Por segurança, o robô não |
//| opera em conta real enquanto "PermitirContaReal" estiver false.  |
//+------------------------------------------------------------------+
#property copyright "PanissAsset"
#property version   "1.00"
#property description "Robô RSI para mini-índice (WIN). Teste primeiro na conta demo."

#include <Trade\Trade.mqh>

//--- Configurações (aparecem na aba "Entradas" ao colocar o robô no gráfico)
input ENUM_TIMEFRAMES Tempo            = PERIOD_M15; // Tempo de cada vela
input int             PeriodoRSI       = 14;         // Períodos do RSI
input double          NivelCompra      = 30;         // RSI abaixo disso: compra
input double          NivelVenda       = 70;         // RSI acima disso: zera a compra
input bool            OperarVendido    = false;      // Também vender quando RSI > 70
input double          Contratos        = 1;          // Contratos por operação
input int             StopPontos       = 300;        // Stop de perda em pontos (0 = sem stop)
input int             AlvoPontos       = 0;          // Alvo de ganho em pontos (0 = sem alvo)
input string          HoraInicio       = "09:15";    // Começa a abrir posições
input string          HoraFimEntradas  = "17:00";    // Para de abrir posições
input string          HoraZerar        = "17:45";    // Zera tudo (não dorme posicionado)
input double          PerdaMaxDia      = 200;        // Perda máxima do dia em R$ (0 = sem limite)
input string          CanalNtfy        = "";         // Canal do ntfy para avisos (vazio = sem aviso)
input bool            PermitirContaReal = false;     // Deixe false enquanto testa na demo
input long            NumeroMagico     = 20261021;   // Identificação das ordens deste robô

CTrade   trade;
int      hRSI = INVALID_HANDLE;
datetime ultimaBarra = 0;
bool     bloqueadoReal = false;
bool     avisouLimite = false;

//+------------------------------------------------------------------+
int OnInit()
{
   hRSI = iRSI(_Symbol, Tempo, PeriodoRSI, PRICE_CLOSE);
   if(hRSI == INVALID_HANDLE)
   {
      Print("PanissAsset: não consegui criar o RSI.");
      return(INIT_FAILED);
   }
   trade.SetExpertMagicNumber(NumeroMagico);
   trade.SetTypeFillingBySymbol(_Symbol);
   trade.SetDeviationInPoints(50);

   // Só age a partir da PRÓXIMA vela que fechar, nunca no passado
   ultimaBarra = iTime(_Symbol, Tempo, 0);

   long tipoConta = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   bloqueadoReal = (tipoConta == ACCOUNT_TRADE_MODE_REAL && !PermitirContaReal);
   string conta = (tipoConta == ACCOUNT_TRADE_MODE_DEMO ? "DEMO" : tipoConta == ACCOUNT_TRADE_MODE_REAL ? "REAL" : "CONCURSO");
   if(bloqueadoReal)
      Comment("PanissAsset: conta REAL detectada. Robô parado (PermitirContaReal = false).");
   else
      Comment("PanissAsset rodando em ", _Symbol, " | conta ", conta, " | RSI ", PeriodoRSI, " | vela ", EnumToString(Tempo));
   Print("PanissAsset iniciado em ", _Symbol, ", conta ", conta);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
void OnDeinit(const int motivo)
{
   if(hRSI != INVALID_HANDLE) IndicatorRelease(hRSI);
   Comment("");
}

//+------------------------------------------------------------------+
int Minutos(string hhmm)
{
   return (int)StringToInteger(StringSubstr(hhmm, 0, 2)) * 60 + (int)StringToInteger(StringSubstr(hhmm, 3, 2));
}

int MinutosAgora()
{
   MqlDateTime t;
   TimeToStruct(TimeCurrent(), t);
   return t.hour * 60 + t.min;
}

// Ajusta o preço ao "degrau" do ativo (no WIN, 5 pontos)
double Ajustar(double preco)
{
   double tick = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tick <= 0) return preco;
   return MathRound(preco / tick) * tick;
}

// Posição deste robô: 1 comprado, -1 vendido, 0 fora
int Posicao(ulong &ticket)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0 || !PositionSelectByTicket(tk)) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != NumeroMagico) continue;
      ticket = tk;
      return (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 1 : -1;
   }
   ticket = 0;
   return 0;
}

// Resultado do dia em R$ (operações fechadas + posição aberta)
double ResultadoHoje()
{
   MqlDateTime t;
   TimeToStruct(TimeCurrent(), t);
   t.hour = 0; t.min = 0; t.sec = 0;
   double r = 0;
   if(HistorySelect(StructToTime(t), TimeCurrent()))
   {
      for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
      {
         ulong d = HistoryDealGetTicket(i);
         if(HistoryDealGetInteger(d, DEAL_MAGIC) != NumeroMagico) continue;
         if(HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol) continue;
         r += HistoryDealGetDouble(d, DEAL_PROFIT) + HistoryDealGetDouble(d, DEAL_COMMISSION) + HistoryDealGetDouble(d, DEAL_SWAP);
      }
   }
   ulong tk;
   if(Posicao(tk) != 0 && PositionSelectByTicket(tk))
      r += PositionGetDouble(POSITION_PROFIT);
   return r;
}

// Aviso no celular pelo ntfy (precisa liberar https://ntfy.sh em
// Ferramentas > Opções > Expert Advisors > "Permitir WebRequest")
void Avisar(string titulo, string msg)
{
   Print(titulo, " | ", msg);
   if(CanalNtfy == "") return;
   char dados[], resposta[];
   string cabecalhoResposta;
   string cabecalho = "Title: " + titulo + "\r\nPriority: 5\r\n";
   int n = StringToCharArray(msg, dados, 0, WHOLE_ARRAY, CP_UTF8);
   if(n > 0) ArrayResize(dados, n - 1); // tira o zero do fim
   ResetLastError();
   int res = WebRequest("POST", "https://ntfy.sh/" + CanalNtfy, cabecalho, 5000, dados, resposta, cabecalhoResposta);
   if(res == -1) Print("PanissAsset: aviso não enviado (libere https://ntfy.sh no WebRequest). Erro ", GetLastError());
}

void Zerar(ulong ticket, string motivo)
{
   if(trade.PositionClose(ticket))
      Avisar("PanissAsset WIN: ZERADO", motivo + " Resultado do dia: R$ " + DoubleToString(ResultadoHoje(), 2));
   else
      Print("PanissAsset: falha ao zerar (", trade.ResultRetcode(), ") ", trade.ResultRetcodeDescription());
}

//+------------------------------------------------------------------+
void OnTick()
{
   if(bloqueadoReal) return;

   ulong tk;
   int pos = Posicao(tk);
   int agora = MinutosAgora();

   // 1) Fim do dia: zera e não abre mais nada
   if(agora >= Minutos(HoraZerar))
   {
      if(pos != 0) Zerar(tk, "Fim do pregão.");
      return;
   }

   // 2) Perda máxima do dia
   if(PerdaMaxDia > 0 && ResultadoHoje() <= -PerdaMaxDia)
   {
      if(pos != 0) Zerar(tk, "Perda máxima do dia atingida.");
      if(!avisouLimite)
      {
         avisouLimite = true;
         Avisar("PanissAsset WIN: PARADO", "Perda maxima do dia atingida. Volta amanha.");
      }
      return;
   }

   // 3) Só decide quando uma vela nova abre (olhando a vela que acabou de fechar)
   datetime barra = iTime(_Symbol, Tempo, 0);
   if(barra == 0 || barra == ultimaBarra) return;
   ultimaBarra = barra;

   // vira o dia: libera o aviso de limite
   MqlDateTime t; TimeToStruct(TimeCurrent(), t);
   if(t.hour * 60 + t.min < Minutos(HoraInicio)) avisouLimite = false;

   double rsi[];
   if(CopyBuffer(hRSI, 0, 1, 1, rsi) != 1) return;
   double r = rsi[0];
   string rTxt = DoubleToString(r, 1);

   // Sai das posições
   if(pos == 1 && r > NivelVenda)  { Zerar(tk, "RSI " + rTxt + " acima de " + DoubleToString(NivelVenda, 0) + "."); pos = 0; }
   if(pos == -1 && r < NivelCompra) { Zerar(tk, "RSI " + rTxt + " abaixo de " + DoubleToString(NivelCompra, 0) + "."); pos = 0; }

   // Entra
   bool podeEntrar = (agora >= Minutos(HoraInicio) && agora < Minutos(HoraFimEntradas));
   if(pos != 0 || !podeEntrar) return;

   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   if(r < NivelCompra)
   {
      double sl = StopPontos > 0 ? Ajustar(ask - StopPontos) : 0;
      double tp = AlvoPontos > 0 ? Ajustar(ask + AlvoPontos) : 0;
      if(trade.Buy(Contratos, _Symbol, 0, sl, tp, "PanissAsset RSI compra"))
         Avisar("PanissAsset WIN: COMPRA", "Comprou " + DoubleToString(Contratos, 0) + " contrato(s) a " + DoubleToString(ask, 0) + " | RSI " + rTxt);
      else
         Print("PanissAsset: compra recusada (", trade.ResultRetcode(), ") ", trade.ResultRetcodeDescription());
   }
   else if(OperarVendido && r > NivelVenda)
   {
      double sl = StopPontos > 0 ? Ajustar(bid + StopPontos) : 0;
      double tp = AlvoPontos > 0 ? Ajustar(bid - AlvoPontos) : 0;
      if(trade.Sell(Contratos, _Symbol, 0, sl, tp, "PanissAsset RSI venda"))
         Avisar("PanissAsset WIN: VENDA", "Vendeu " + DoubleToString(Contratos, 0) + " contrato(s) a " + DoubleToString(bid, 0) + " | RSI " + rTxt);
      else
         Print("PanissAsset: venda recusada (", trade.ResultRetcode(), ") ", trade.ResultRetcodeDescription());
   }
}
//+------------------------------------------------------------------+
