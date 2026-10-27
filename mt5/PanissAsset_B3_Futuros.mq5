//+------------------------------------------------------------------+
//| PanissAsset B3 Futuros - assistente de day trade (WIN, WDO...)    |
//|                                                                  |
//| Ideias do pacote day-trader-skill, adaptadas para a B3:           |
//|  1. Faixa de abertura: máxima e mínima dos primeiros 15 minutos.  |
//|  2. Entrada: a primeira vela de 5 min que FECHA fora da faixa.    |
//|  3. Stop e alvo definidos ANTES de entrar (meio da faixa, 2R).    |
//|  4. Contratos calculados pela perda máxima por operação em R$.    |
//|  5. Porteiro de risco: perda do dia, operações por dia, horário.  |
//|  6. Time Machine: refaz o resto do pregão 10.000 vezes com as     |
//|     velas do próprio ativo e mostra as chances antes de entrar.   |
//|  7. Zera tudo no fim do dia. Nunca dorme posicionado.             |
//|                                                                  |
//| Modo padrão: ENTRA SOZINHO, sem pedir permissão. Teste na demo.  |
//| Em conta real ele fica parado enquanto PermitirContaReal = false. |
//+------------------------------------------------------------------+
#property copyright "PanissAsset"
#property version   "1.00"
#property description "Assistente de day trade para futuros da B3 (rompimento da faixa de abertura + Time Machine). Teste primeiro na demo."

#include <Trade\Trade.mqh>

enum ModoRobo
{
   SO_AVISAR      = 0, // Só avisar (eu opero)
   OPERAR_SOZINHO = 1  // Operar sozinho
};

enum TipoStop
{
   STOP_MEIO  = 0, // Meio da faixa
   STOP_PONTA = 1  // Outra ponta da faixa
};

//--- Configurações (aba "Entradas")
input ModoRobo Modo               = OPERAR_SOZINHO; // O robô analisa e entra sozinho
input string   HoraAbertura       = "09:00";    // Abertura do pregão
input int      MinutosFaixa       = 15;         // Minutos da faixa de abertura (múltiplo de 5)
input TipoStop Stop               = STOP_MEIO;  // Onde fica o stop
input double   AlvoR              = 2.0;        // Alvo em vezes o risco (1 = 1R, 2 = 2R)
input double   PerdaMaxOperacao   = 100;        // Perda máxima por operação em R$
input double   MaxContratos       = 5;          // Teto de contratos
input double   PerdaMaxDia        = 300;        // Perda máxima do dia em R$ (0 = sem limite)
input int      MaxOperacoesDia    = 2;          // Operações por dia (0 = sem limite)
input double   MinRiscoRetorno    = 1.0;        // Alvo mínimo em vezes o risco
input string   HoraFimEntradas    = "16:30";    // Depois disso não entra mais
input string   HoraZerar          = "17:45";    // Zera tudo
input bool     PermitirVenda      = true;       // Também avisar/vender no rompimento para baixo
input bool     FiltroTimeMachine  = true;       // Pular quando a Time Machine puxa para o stop
input int      DiasHistorico      = 90;         // Dias de calendário usados na Time Machine
input int      Replays            = 10000;      // Replays da Time Machine
input string   CanalNtfy          = "";         // Canal do ntfy para avisos (vazio = sem aviso)
input bool     PermitirContaReal  = false;      // Deixe false enquanto testa na demo
input long     NumeroMagico       = 20261026;   // Identificação das ordens deste robô

#define TF       PERIOD_M5
#define SLOTS    288          // velas de 5 min num dia

CTrade   trade;
datetime ultimaBarra  = 0;
datetime diaAtual     = 0;
bool     bloqueadoReal = false;
bool     faixaPronta  = false;
double   faixaMax = 0, faixaMin = 0;
bool     usouCompra = false, usouVenda = false;
bool     avisouLimite = false;
string   ultimoTexto = "Aguardando a faixa de abertura.";

//+------------------------------------------------------------------+
//| Utilidades de horário                                             |
//+------------------------------------------------------------------+
int Minutos(string hhmm)
{
   return (int)StringToInteger(StringSubstr(hhmm, 0, 2)) * 60 + (int)StringToInteger(StringSubstr(hhmm, 3, 2));
}
int MinutosDe(datetime t)  { return (int)((t % 86400) / 60); }
int MinutosAgora()         { return MinutosDe(TimeCurrent()); }
datetime InicioDia(datetime t) { return t - (t % 86400); }
int Slot(datetime t)       { return (int)((t % 86400) / 300); }

//+------------------------------------------------------------------+
//| Preço no degrau do ativo                                          |
//+------------------------------------------------------------------+
double Tick()
{
   double t = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   return t > 0 ? t : _Point;
}
double ArredBaixo(double p) { double t = Tick(); return MathFloor(p / t + 1e-9) * t; }
double ArredCima(double p)  { double t = Tick(); return MathCeil(p / t - 1e-9) * t; }
double Arred(double p)      { double t = Tick(); return MathRound(p / t) * t; }

// R$ por 1 unidade de preço por contrato (WIN: R$ 0,20 por ponto; WDO: R$ 10 por ponto)
double ReaisPorPonto()
{
   double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tv <= 0 || ts <= 0) return 0;
   return tv / ts;
}

string Preco(double p) { return DoubleToString(p, _Digits); }
string Reais(double v) { return "R$ " + DoubleToString(v, 2); }

//+------------------------------------------------------------------+
//| Posição e resultado do dia                                        |
//+------------------------------------------------------------------+
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

double ResultadoHoje()
{
   double r = 0;
   if(HistorySelect(InicioDia(TimeCurrent()), TimeCurrent()))
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

int OperacoesHoje()
{
   int n = 0;
   if(HistorySelect(InicioDia(TimeCurrent()), TimeCurrent()))
   {
      for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
      {
         ulong d = HistoryDealGetTicket(i);
         if(HistoryDealGetInteger(d, DEAL_MAGIC) != NumeroMagico) continue;
         if(HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol) continue;
         if(HistoryDealGetInteger(d, DEAL_ENTRY) == DEAL_ENTRY_IN) n++;
      }
   }
   return n;
}

//+------------------------------------------------------------------+
//| Avisos: janela do MT5, push do app MT5 e ntfy                     |
//+------------------------------------------------------------------+
void Avisar(string titulo, string msg, bool janela)
{
   Print(titulo, " | ", msg);
   if(janela) Alert(titulo, "\n", msg);
   SendNotification(titulo + ": " + msg);   // só chega se o MetaQuotes ID estiver configurado
   if(CanalNtfy == "") return;
   char dados[], resposta[];
   string cabResp;
   string cab = "Title: " + titulo + "\r\nPriority: 5\r\n";
   int n = StringToCharArray(msg, dados, 0, WHOLE_ARRAY, CP_UTF8);
   if(n > 0) ArrayResize(dados, n - 1);
   ResetLastError();
   if(WebRequest("POST", "https://ntfy.sh/" + CanalNtfy, cab, 5000, dados, resposta, cabResp) == -1)
      Print("PanissAsset B3: aviso não enviado (libere https://ntfy.sh no WebRequest). Erro ", GetLastError());
}

//+------------------------------------------------------------------+
//| TIME MACHINE                                                      |
//| Pool: pregões completos dos últimos DiasHistorico dias.           |
//| Cada vela vira 4 razões (abertura, máxima, mínima, fechamento)    |
//| sobre o fechamento anterior. Um replay sorteia, para cada horário |
//| que falta, uma vela de um pregão passado do mesmo horário (±2     |
//| velas) e aplica no preço atual. Stop é checado antes do alvo.     |
//+------------------------------------------------------------------+
uint semente = 19;
uint Sorteio()
{
   semente ^= semente << 13; semente ^= semente >> 17; semente ^= semente << 5;
   return semente;
}

struct ResultadoTM
{
   bool   ok;
   string erro;
   int    dias;
   int    alvo, stop, nenhum;
   double mediaR;
   int    hDisparou, hAlvo, hStop, hNada;
   int    lado;       // +1 puxa para o alvo, -1 puxa para o stop, 0 perto do empate
   string veredito;
};

// arrays planos do pool
int    pDia[];                 // índice do pregão de cada vela
double pRo[], pRh[], pRl[], pRc[];
double pO[], pH[], pL[], pC[];
int    pSlot[];
int    mapa[];                 // mapa[dia * SLOTS + slot] = índice da vela, ou -1
int    nDias = 0;
datetime poolMontadoEm = 0;

bool MontarPool(string &erro)
{
   datetime hoje = InicioDia(TimeCurrent());
   if(poolMontadoEm == hoje && nDias > 0) return true;
   MqlRates r[];
   ArraySetAsSeries(r, false);
   int n = CopyRates(_Symbol, TF, hoje - (datetime)DiasHistorico * 86400, hoje - 1, r);
   if(n <= 0) { erro = "sem histórico de velas de 5 min"; return false; }

   int sAb = Minutos(HoraAbertura) / 5, sZ = Minutos(HoraZerar) / 5;
   int esperado = sZ - sAb;
   ArrayResize(pDia, 0); ArrayResize(pRo, 0); ArrayResize(pRh, 0); ArrayResize(pRl, 0); ArrayResize(pRc, 0);
   ArrayResize(pO, 0); ArrayResize(pH, 0); ArrayResize(pL, 0); ArrayResize(pC, 0); ArrayResize(pSlot, 0);
   nDias = 0;

   int i = 0;
   while(i < n)
   {
      datetime d0 = InicioDia(r[i].time);
      int j = i;
      while(j < n && InicioDia(r[j].time) == d0) j++;
      // velas do pregão (da abertura até antes de zerar)
      int conta = 0; bool temAbertura = false;
      for(int k = i; k < j; k++)
      {
         int s = Slot(r[k].time);
         if(s >= sAb && s < sZ) { conta++; if(s == sAb) temAbertura = true; }
      }
      if(temAbertura && conta >= (int)(esperado * 0.9))
      {
         double ant = 0;
         for(int k = i; k < j; k++)
         {
            int s = Slot(r[k].time);
            if(s < sAb || s >= sZ) continue;
            if(ant <= 0) ant = r[k].open;
            int m = ArraySize(pDia);
            ArrayResize(pDia, m + 1, 20000); ArrayResize(pSlot, m + 1, 20000);
            ArrayResize(pRo, m + 1, 20000); ArrayResize(pRh, m + 1, 20000); ArrayResize(pRl, m + 1, 20000); ArrayResize(pRc, m + 1, 20000);
            ArrayResize(pO, m + 1, 20000); ArrayResize(pH, m + 1, 20000); ArrayResize(pL, m + 1, 20000); ArrayResize(pC, m + 1, 20000);
            pDia[m] = nDias; pSlot[m] = s;
            pRo[m] = r[k].open / ant; pRh[m] = r[k].high / ant; pRl[m] = r[k].low / ant; pRc[m] = r[k].close / ant;
            pO[m] = r[k].open; pH[m] = r[k].high; pL[m] = r[k].low; pC[m] = r[k].close;
            ant = r[k].close;
         }
         nDias++;
      }
      i = j;
   }
   if(nDias < 20) { erro = "só " + IntegerToString(nDias) + " pregões completos no histórico (precisa de 20)"; return false; }
   ArrayResize(mapa, nDias * SLOTS);
   ArrayInitialize(mapa, -1);
   for(int m = 0; m < ArraySize(pDia); m++) mapa[pDia[m] * SLOTS + pSlot[m]] = m;
   poolMontadoEm = hoje;
   return true;
}

void TimeMachine(int lado, double entrada, double stop, double alvo, int slotEntrada, ResultadoTM &t)
{
   t.ok = false; t.erro = ""; t.dias = 0; t.alvo = 0; t.stop = 0; t.nenhum = 0; t.mediaR = 0;
   t.hDisparou = 0; t.hAlvo = 0; t.hStop = 0; t.hNada = 0; t.lado = 0; t.veredito = "";
   if(!MontarPool(t.erro)) return;
   t.dias = nDias;
   double risco = MathAbs(entrada - stop);
   if(risco <= 0) { t.erro = "risco zero"; return; }
   int sZ = Minutos(HoraZerar) / 5;
   semente = 19;

   // 1) replays
   double somaR = 0;
   for(int k = 0; k < Replays; k++)
   {
      double p = entrada;
      int fim = 0;
      for(int s = slotEntrada + 1; s < sZ && fim == 0; s++)
      {
         int idx = -1;
         for(int tentativa = 0; tentativa < 6 && idx < 0; tentativa++)
         {
            int d  = (int)(Sorteio() % (uint)nDias);
            int s2 = s + (int)(Sorteio() % 5) - 2;
            if(s2 < 0 || s2 >= SLOTS) s2 = s;
            idx = mapa[d * SLOTS + s2];
            if(idx < 0) idx = mapa[d * SLOTS + s];
         }
         if(idx < 0) continue;
         double h = p * pRh[idx], l = p * pRl[idx], c = p * pRc[idx];
         if(lado > 0) { if(l <= stop) fim = -1; else if(h >= alvo) fim = 1; }
         else         { if(h >= stop) fim = -1; else if(l <= alvo) fim = 1; }
         p = c;
      }
      if(fim == 1)       { t.alvo++;  somaR += AlvoR; }
      else if(fim == -1) { t.stop++;  somaR -= 1; }
      else               { t.nenhum++; somaR += (p - entrada) * lado / risco; }
   }
   t.mediaR = somaR / Replays;

   // 2) a mesma regra em cada pregão real do histórico
   int sAb = Minutos(HoraAbertura) / 5, nFaixa = MinutosFaixa / 5, sFim = Minutos(HoraFimEntradas) / 5;
   for(int d = 0; d < nDias; d++)
   {
      double fx = -DBL_MAX, fn = DBL_MAX; bool completa = true;
      for(int s = sAb; s < sAb + nFaixa; s++)
      {
         int idx = mapa[d * SLOTS + s];
         if(idx < 0) { completa = false; break; }
         fx = MathMax(fx, pH[idx]); fn = MathMin(fn, pL[idx]);
      }
      if(!completa) continue;
      int sEnt = -1; double ent = 0;
      for(int s = sAb + nFaixa; s < sFim; s++)
      {
         int idx = mapa[d * SLOTS + s];
         if(idx < 0) continue;
         if((lado > 0 && pC[idx] > fx) || (lado < 0 && pC[idx] < fn)) { sEnt = s; ent = pC[idx]; break; }
      }
      if(sEnt < 0) continue;
      double meio = (fx + fn) / 2;
      double st = (Stop == STOP_MEIO) ? meio : (lado > 0 ? fn : fx);
      st = lado > 0 ? ArredBaixo(st) : ArredCima(st);
      double rk = MathAbs(ent - st);
      if(rk <= 0 || (lado > 0 && st >= ent) || (lado < 0 && st <= ent)) continue;
      double al = Arred(ent + lado * AlvoR * rk);
      t.hDisparou++;
      int fim = 0;
      for(int s = sEnt + 1; s < sZ && fim == 0; s++)
      {
         int idx = mapa[d * SLOTS + s];
         if(idx < 0) continue;
         if(lado > 0) { if(pL[idx] <= st) fim = -1; else if(pH[idx] >= al) fim = 1; }
         else         { if(pH[idx] >= st) fim = -1; else if(pL[idx] <= al) fim = 1; }
      }
      if(fim == 1) t.hAlvo++; else if(fim == -1) t.hStop++; else t.hNada++;
   }

   // 3) veredito: entre os replays que bateram um lado, quantos foram no alvo,
   //    contra o empate 1 / (1 + R): 50% em 1R, 33% em 2R, 25% em 3R
   int bateu = t.alvo + t.stop;
   if(bateu == 0) { t.veredito = "Nenhum replay bateu alvo ou stop"; t.lado = 0; t.ok = true; return; }
   double pAlvo = 100.0 * t.alvo / bateu;
   double empate = 100.0 / (1.0 + AlvoR);
   double folga = pAlvo - empate;
   if(MathAbs(folga) < 5)  { t.lado = 0;  t.veredito = (MathAbs(AlvoR - 1.0) < 0.01) ? "Perto de cara ou coroa" : "Perto do empate"; }
   else if(folga >= 15)    { t.lado = 1;  t.veredito = "Forte para o alvo"; }
   else if(folga > 0)      { t.lado = 1;  t.veredito = "Puxa para o alvo"; }
   else if(folga <= -15)   { t.lado = -1; t.veredito = "Forte para o stop"; }
   else                    { t.lado = -1; t.veredito = "Puxa para o stop"; }
   t.ok = true;
}

string TextoTM(ResultadoTM &t)
{
   if(!t.ok) return "Time Machine: não rodou (" + t.erro + ")";
   double n = (double)Replays;
   string s = "Time Machine (" + IntegerToString(Replays) + " replays, " + IntegerToString(t.dias) + " pregões, semente 19): ";
   s += "alvo antes " + DoubleToString(100.0 * t.alvo / n, 1) + "%, stop antes " + DoubleToString(100.0 * t.stop / n, 1) + "%, ";
   s += "nenhum até zerar " + DoubleToString(100.0 * t.nenhum / n, 1) + "%. R médio " + DoubleToString(t.mediaR, 2) + ". ";
   s += "Histórico: a mesma regra disparou " + IntegerToString(t.hDisparou) + " vezes, " + IntegerToString(t.hAlvo) + " no alvo, " + IntegerToString(t.hStop) + " no stop, " + IntegerToString(t.hNada) + " sem nenhum. ";
   s += "Veredito: " + t.veredito + ". É simulação, não previsão.";
   return s;
}

//+------------------------------------------------------------------+
//| Faixa de abertura                                                 |
//+------------------------------------------------------------------+
bool MontarFaixa()
{
   datetime hoje = InicioDia(TimeCurrent());
   datetime ini = hoje + Minutos(HoraAbertura) * 60;
   datetime fim = ini + MinutosFaixa * 60;
   if(TimeCurrent() < fim) return false;
   MqlRates r[];
   ArraySetAsSeries(r, false);
   int n = CopyRates(_Symbol, TF, ini, fim - 1, r);
   if(n < MinutosFaixa / 5)
   {
      ultimoTexto = "Faixa incompleta: " + IntegerToString(n) + " de " + IntegerToString(MinutosFaixa / 5) + " velas.";
      return false;
   }
   faixaMax = -DBL_MAX; faixaMin = DBL_MAX;
   for(int i = 0; i < n; i++) { faixaMax = MathMax(faixaMax, r[i].high); faixaMin = MathMin(faixaMin, r[i].low); }
   faixaPronta = true;

   // se o robô foi ligado depois, confere se o rompimento já aconteceu (sinal perdido)
   MqlRates d[];
   ArraySetAsSeries(d, false);
   int m = CopyRates(_Symbol, TF, fim, iTime(_Symbol, TF, 0) - 1, d);
   for(int i = 0; i < m; i++)
   {
      if(!usouCompra && d[i].close > faixaMax) { usouCompra = true; Print("PanissAsset B3: o rompimento para cima já aconteceu às ", TimeToString(d[i].time + 300, TIME_MINUTES), ". Sinal perdido, não entra atrasado."); }
      if(!usouVenda  && d[i].close < faixaMin) { usouVenda  = true; Print("PanissAsset B3: o rompimento para baixo já aconteceu às ", TimeToString(d[i].time + 300, TIME_MINUTES), ". Sinal perdido, não entra atrasado."); }
   }
   ultimoTexto = "Faixa " + HoraAbertura + " a " + TimeToString(fim, TIME_MINUTES) + ": máxima " + Preco(faixaMax) + ", mínima " + Preco(faixaMin) + ".";
   return true;
}

//+------------------------------------------------------------------+
//| Um sinal: plano, tamanho, porteiro de risco, Time Machine, ação   |
//+------------------------------------------------------------------+
void Sinal(int lado, double fechamento, datetime horaBarra)
{
   string nome = (lado > 0 ? "COMPRA" : "VENDA");
   string hora = TimeToString(horaBarra + 300, TIME_MINUTES);

   // 1) plano: stop e alvo antes de entrar
   double entrada = fechamento;
   if(Modo == OPERAR_SOZINHO)
      entrada = (lado > 0) ? SymbolInfoDouble(_Symbol, SYMBOL_ASK) : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double meio = (faixaMax + faixaMin) / 2;
   double stop = (Stop == STOP_MEIO) ? meio : (lado > 0 ? faixaMin : faixaMax);
   stop = (lado > 0) ? ArredBaixo(stop) : ArredCima(stop);
   double risco = MathAbs(entrada - stop);
   if((lado > 0 && stop >= entrada) || (lado < 0 && stop <= entrada) || risco < 2 * Tick())
   {
      Avisar("PanissAsset B3: " + nome + " recusada", "Stop " + Preco(stop) + " colado ou do lado errado da entrada " + Preco(entrada) + ".", false);
      return;
   }
   double alvo = Arred(entrada + lado * AlvoR * risco);
   double rr = MathAbs(alvo - entrada) / risco;

   // 2) tamanho pela perda máxima por operação
   double rpp = ReaisPorPonto();
   double riscoContrato = risco * rpp;
   double passo = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minimo = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   if(passo <= 0) passo = 1;
   double contratos = (riscoContrato > 0) ? MathFloor((PerdaMaxOperacao / riscoContrato) / passo + 1e-9) * passo : 0;
   contratos = MathMin(contratos, MaxContratos);
   double perdaNoStop = contratos * riscoContrato;

   // 3) porteiro de risco
   string bloqueio = "";
   if(contratos < minimo || contratos <= 0)
      bloqueio = "1 contrato arrisca " + Reais(riscoContrato) + " no stop, mais que a perda máxima de " + Reais(PerdaMaxOperacao) + " por operação";
   else if(rr < MinRiscoRetorno)
      bloqueio = "alvo de " + DoubleToString(rr, 2) + "R, abaixo do mínimo " + DoubleToString(MinRiscoRetorno, 2) + "R";
   else if(MaxOperacoesDia > 0 && OperacoesHoje() >= MaxOperacoesDia)
      bloqueio = "já foram " + IntegerToString(OperacoesHoje()) + " operações hoje (máximo " + IntegerToString(MaxOperacoesDia) + ")";
   else if(PerdaMaxDia > 0 && ResultadoHoje() - perdaNoStop < -PerdaMaxDia)
      bloqueio = "se bater o stop, o dia passa da perda máxima de " + Reais(PerdaMaxDia);

   string plano = nome + " " + _Symbol + " às " + hora + " | entrada " + Preco(entrada) + " | stop " + Preco(stop) +
                  " | alvo " + Preco(alvo) + " (" + DoubleToString(rr, 1) + "R) | " + DoubleToString(contratos, 0) + " contrato(s) | perda no stop ~" + Reais(perdaNoStop) +
                  " (pode ser pior num mercado rápido) | zerar até " + HoraZerar;

   if(bloqueio != "")
   {
      ultimoTexto = "BLOQUEADO: " + bloqueio + ".";
      Avisar("PanissAsset B3: " + nome + " BLOQUEADA", plano + " | Motivo: " + bloqueio + ".", Modo == SO_AVISAR);
      return;
   }

   // 4) Time Machine
   ResultadoTM tm;
   TimeMachine(lado, entrada, stop, alvo, Slot(horaBarra), tm);
   string txtTM = TextoTM(tm);
   if(FiltroTimeMachine && tm.ok && tm.lado < 0)
   {
      ultimoTexto = "PULOU " + nome + " das " + hora + ": Time Machine puxa para o stop.";
      Avisar("PanissAsset B3: " + nome + " pulada", plano + " | " + txtTM, Modo == SO_AVISAR);
      return;
   }

   // 5) ação
   if(Modo == SO_AVISAR)
   {
      ultimoTexto = "SINAL " + nome + " às " + hora + ". Decisão sua.";
      Avisar("PanissAsset B3: " + nome, plano + " | " + txtTM + " | Nada foi enviado: a decisão é sua.", true);
      return;
   }
   bool ok = (lado > 0) ? trade.Buy(contratos, _Symbol, 0, stop, alvo, "PanissAsset B3 faixa compra")
                        : trade.Sell(contratos, _Symbol, 0, stop, alvo, "PanissAsset B3 faixa venda");
   if(ok)
   {
      ultimoTexto = nome + " enviada às " + hora + ".";
      Avisar("PanissAsset B3: " + nome + " ENVIADA", plano + " | " + txtTM, false);
   }
   else
      Avisar("PanissAsset B3: " + nome + " recusada pela corretora", IntegerToString((int)trade.ResultRetcode()) + " " + trade.ResultRetcodeDescription(), false);
}

//+------------------------------------------------------------------+
void Painel()
{
   long tipo = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string conta = (tipo == ACCOUNT_TRADE_MODE_DEMO ? "DEMO" : tipo == ACCOUNT_TRADE_MODE_REAL ? "REAL" : "CONCURSO");
   string s = "PanissAsset B3 Futuros | " + _Symbol + " | conta " + conta + " | " + (Modo == SO_AVISAR ? "só avisa" : "opera sozinho") + "\n";
   if(bloqueadoReal) s += "Conta REAL detectada: robô parado (PermitirContaReal = false).\n";
   if(faixaPronta) s += "Faixa: " + Preco(faixaMin) + " a " + Preco(faixaMax) + "\n";
   s += "Hoje: " + IntegerToString(OperacoesHoje()) + " operação(ões), resultado " + Reais(ResultadoHoje()) + "\n";
   s += ultimoTexto;
   Comment(s);
}

void Zerar(ulong ticket, string motivo)
{
   if(trade.PositionClose(ticket))
      Avisar("PanissAsset B3: ZERADO", motivo + " Resultado do dia: " + Reais(ResultadoHoje()), false);
   else
      Print("PanissAsset B3: falha ao zerar (", trade.ResultRetcode(), ") ", trade.ResultRetcodeDescription());
}

//+------------------------------------------------------------------+
int OnInit()
{
   if(MinutosFaixa < 5 || MinutosFaixa % 5 != 0) { Print("PanissAsset B3: MinutosFaixa precisa ser múltiplo de 5."); return INIT_PARAMETERS_INCORRECT; }
   if(AlvoR <= 0) { Print("PanissAsset B3: AlvoR precisa ser maior que zero."); return INIT_PARAMETERS_INCORRECT; }
   trade.SetExpertMagicNumber(NumeroMagico);
   trade.SetTypeFillingBySymbol(_Symbol);
   trade.SetDeviationInPoints(50);
   ultimaBarra = iTime(_Symbol, TF, 0);    // só olha velas que fecharem daqui pra frente
   long tipo = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   bloqueadoReal = (tipo == ACCOUNT_TRADE_MODE_REAL && !PermitirContaReal && Modo == OPERAR_SOZINHO);
   EventSetTimer(30);
   Painel();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int motivo)
{
   EventKillTimer();
   Comment("");
}

void OnTimer() { Painel(); }

//+------------------------------------------------------------------+
void OnTick()
{
   // virada do dia
   datetime hoje = InicioDia(TimeCurrent());
   if(hoje != diaAtual)
   {
      diaAtual = hoje; faixaPronta = false; usouCompra = false; usouVenda = false; avisouLimite = false;
      ultimoTexto = "Aguardando a faixa de abertura.";
   }
   if(bloqueadoReal) { Painel(); return; }

   ulong tk;
   int pos = Posicao(tk);
   int agora = MinutosAgora();

   // 1) fim do dia: zera e não abre mais nada
   if(agora >= Minutos(HoraZerar))
   {
      if(pos != 0) Zerar(tk, "Hora de zerar (" + HoraZerar + ").");
      return;
   }
   // 2) perda máxima do dia
   if(PerdaMaxDia > 0 && ResultadoHoje() <= -PerdaMaxDia)
   {
      if(pos != 0) Zerar(tk, "Perda máxima do dia atingida.");
      if(!avisouLimite) { avisouLimite = true; ultimoTexto = "Parado: perda máxima do dia."; Avisar("PanissAsset B3: PARADO", "Perda máxima do dia atingida. Volta amanhã.", true); }
      return;
   }

   // 3) só decide quando uma vela de 5 min fecha
   datetime barra = iTime(_Symbol, TF, 0);
   if(barra == 0 || barra == ultimaBarra) return;
   ultimaBarra = barra;

   if(!faixaPronta && !MontarFaixa()) { Painel(); return; }
   if(agora < Minutos(HoraAbertura) + MinutosFaixa || agora >= Minutos(HoraFimEntradas)) { Painel(); return; }
   if(pos != 0) { Painel(); return; }

   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, TF, 1, 1, r) != 1) return;
   if(InicioDia(r[0].time) != hoje) return;

   // um gatilho por lado por dia: o primeiro fechamento fora da faixa
   if(!usouCompra && r[0].close > faixaMax)
   {
      usouCompra = true;
      Sinal(1, r[0].close, r[0].time);
   }
   else if(!usouVenda && r[0].close < faixaMin)
   {
      usouVenda = true;
      if(PermitirVenda) Sinal(-1, r[0].close, r[0].time);
   }
   else if(!usouCompra || !usouVenda)
   {
      double dist = MathMin(MathAbs(faixaMax - r[0].close), MathAbs(r[0].close - faixaMin));
      ultimoTexto = "Aguardando: último fechamento " + Preco(r[0].close) + " (" + Preco(dist) + " da ponta mais perto da faixa).";
   }
   Painel();
}
//+------------------------------------------------------------------+
