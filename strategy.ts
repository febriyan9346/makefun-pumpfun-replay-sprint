// Sniper + runner pyramid for agent-fun/replay/v2 (pump.fun bonding curves).
//
// Idea (from the dev-window diagnosis in WORKLOG.md): momentum chasing loses
// (-9.38 SOL, 95% drawdown on the pilot) because entries land after the move and
// pyramiding adds size at the top. Pure sniping is near breakeven (-0.14 SOL)
// because its +15% take-profit sells runners far too early and the 1%-of-real-
// reserve cap keeps early buys tiny. This bot keeps the sniper's entry (early,
// rug-filtered, tiny) but earns its money differently: it ADDS to a coin only
// while the price keeps stepping up and flow stays positive (so size grows as
// real reserves grow and the cap loosens), sells half at +20%, and trails the
// rest -20% from its peak so the few coins that run 2-10x pay for the many
// small losers. Losers are cut at -12% and never held past a time limit.
//
// Pure function of the batches: BigInt math only, no clock, no randomness, no
// I/O, iteration over insertion-ordered maps only — the two graded executions
// produce byte-identical action logs.

import { BPS, type Batch, type Bot, type BotState, type OrderInput, type Pubkey } from './vendor/agentfun-bot.ts';

export interface Params {
  /** Oldest age (slots since create) at which a first buy may still be decided. */
  maxAge: number;
  /** Real SOL reserve window at decision time (lamports). */
  minRealSol: bigint;
  maxRealSol: bigint;
  /** Creator's own buys in the create slot: at most this (lamports). */
  maxDevBuy: bigint;
  /** Distinct non-creator buyers seen before entry: window. */
  minBuyers: number;
  maxBuyers: number;
  /** Recent-flow window (slots) and the net lamports it must show. */
  flowWindow: number;
  minFlowLamports: bigint;
  /** Price now over the create price, as bps: at most this (a coin that already ran is skipped). */
  maxRunupBps: bigint;
  /** Lamports sold by others / lamports bought, as bps, at most. */
  maxSellRatioBps: bigint;
  /** Lamports to aim for per coin in total (each reply still capped at 1% of real SOL). */
  stakeLamports: bigint;
  /** Lamports per add-on buy. */
  addLamports: bigint;
  /** Most add-on buys per coin. */
  maxAdds: number;
  /** An add needs the price at least this far (bps) above the previous buy's decision price. */
  addStepBps: bigint;
  /** An add waits this many slots after the previous buy was decided. */
  addDelay: number;
  /** An add needs the recent net flow at least this (lamports). */
  addMinFlowLamports: bigint;
  /** An add needs the real SOL reserve at least this (lamports). */
  addMinRealSol: bigint;
  /** Slippage allowed on buys (bps). Sells always go out at 10000. */
  buySlippageBps: number;
  /** Sell half the position once it is worth this much over its cost (bps). */
  tp1Bps: bigint;
  /** Share of the position the first take-profit sells (bps). */
  tp1PartBps: bigint;
  /** Exit when the position is worth this much under its cost (bps). */
  slBps: bigint;
  /** Trailing stop: once up at least trailArmBps, exit on a fall of trailBps from the best value. */
  trailArmBps: bigint;
  trailBps: bigint;
  /** Exit after holding this many slots (extended while up at least holdIfUpBps). */
  maxHold: number;
  holdIfUpBps: bigint;
  maxHoldExtended: number;
  /**
   * Runner mode: once a position is worth cost * (1 + proveBps) it is proven —
   * it stops being subject to the short maxHold and instead rides with the
   * trailing stop up to runnerMaxHold slots, and may keep adding even after
   * the first take-profit. This is where the few coins that run 2-10x pay.
   */
  proveBps: bigint;
  runnerMaxHold: number;
  /** Exit when the creator sells while held. */
  exitOnDevSell: boolean;
  /** Slots to wait after an exit before the same curve may be bought again. */
  cooldown: number;
  /** Most first entries per curve over the run. */
  maxEntries: number;
  /** Most positions open at once. */
  maxOpen: number;
  /** Most SOL at cost across all positions at once (a drawdown guard). */
  maxExposureLamports: bigint;
  /** Smallest single buy worth paying the tx fee for. */
  minBuyLamports: bigint;
  /**
   * Guardrail pacing: the run must end with at least 20 coins at >= 0.01 SOL
   * round trips. When the bot's filled-order count or coin count lags the
   * prorated pace, it opens tiny probe round trips (buy probeSol, sell as soon
   * as the buy lands) until back on pace.
   */
  targetCoins: number;
  targetFills: number;
  paceSecs: number;
  probeLamports: bigint;
  maxProbes: number;
}

export const DEFAULT_PARAMS: Params = {
  maxAge: 3,
  minRealSol: 300_000_000n,
  maxRealSol: 30_000_000_000n,
  maxDevBuy: 2_500_000_000n,
  minBuyers: 2,
  maxBuyers: 2,
  flowWindow: 10,
  minFlowLamports: 0n,
  maxRunupBps: 100000n,
  maxSellRatioBps: 5000n,
  stakeLamports: 500_000_000n,
  addLamports: 100_000_000n,
  maxAdds: 4,
  addStepBps: 500n,
  addDelay: 2,
  addMinFlowLamports: 10_000_000n,
  addMinRealSol: 1_000_000_000n,
  buySlippageBps: 10_000,
  tp1Bps: 1500n,
  tp1PartBps: 5000n,
  slBps: 500n,
  trailArmBps: 1000n,
  trailBps: 2000n,
  maxHold: 10,
  holdIfUpBps: 3000n,
  maxHoldExtended: 2400,
  proveBps: 5000n,
  runnerMaxHold: 2400,
  exitOnDevSell: true,
  cooldown: 150,
  maxEntries: 2,
  maxOpen: 5,
  maxExposureLamports: 6_000_000_000n,
  minBuyLamports: 20_000_000n,
  targetCoins: 20,
  targetFills: 40,
  paceSecs: 21_600,
  probeLamports: 10_000_000n,
  maxProbes: 1,
};

const LAMPORTS_PER_SOL = 1_000_000_000n;
/** Curve fee on a sale: protocol 95 bps + creator 30 bps. */
const FEE_BPS = 125n;

interface Tick {
  slot: number;
  isBuy: boolean;
  sol: bigint;
  user: Pubkey;
}

interface Coin {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  vq0: bigint;
  vt0: bigint;
  devBuy: bigint;
  trades: number;
  buyers: Set<Pubkey>;
  bought: bigint;
  soldByOthers: bigint;
  devSold: boolean;
  lastTradeSlot: number;
  recent: Tick[];
  buysSent: number;
  spentSent: bigint;
  lastBuyVq: bigint;
  lastBuyVt: bigint;
  lastBuySlot: number;
  entries: number;
  lastExit: number;
  done: boolean;
  complete: boolean;
}

interface Held {
  openedSlot: number;
  txPaid: bigint;
  best: bigint;
  devSoldAtOpen: boolean;
  tookTp1: boolean;
  adds: number;
  /** Worth cost * (1 + proveBps) at some point: rides the trailing stop instead of the short hold. */
  proven: boolean;
  /** My own ledger of the tokens still held and their cost (fees included). A
   * partial sell reduces cost pro-rata, so stops are judged on what remains —
   * not on the full original cost, which would dump the remainder at once. */
  tokens: bigint;
  cost: bigint;
}

/** What selling `tokens` against (vq, vt) pays after curve fees. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(params: Params = DEFAULT_PARAMS): Bot {
  const P = params;
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  /** Probe round trips in flight, by mint: false while buying, true once selling. */
  const probes = new Map<Pubkey, boolean>();
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime = 0;

  /** Net lamports bought minus sold and distinct buyers over the last flowWindow slots. */
  function flow(c: Coin, slot: number): { net: bigint; buyers: number } {
    const from = slot - P.flowWindow;
    let drop = 0;
    while (drop < c.recent.length && c.recent[drop]!.slot <= from) drop++;
    if (drop > 0) c.recent.splice(0, drop);
    let net = 0n;
    const buyers = new Set<Pubkey>();
    for (const t of c.recent) {
      if (t.isBuy) {
        net += t.sol;
        if (t.user !== c.creator) buyers.add(t.user);
      } else {
        net -= t.sol;
      }
    }
    return { net, buyers: buyers.size };
  }

  function hasPending(state: BotState, mint: Pubkey, side: 'buy' | 'sell'): boolean {
    for (const p of state.pending.values()) {
      if (p.order.mint === mint && p.order.side === side) return true;
    }
    return false;
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          coins.set(e.mint, {
            mint: e.mint,
            createSlot: e.slot,
            creator: e.creator,
            vq0: BigInt(e.virtual_quote_reserves),
            vt0: BigInt(e.virtual_token_reserves),
            devBuy: 0n,
            trades: 0,
            buyers: new Set(),
            bought: 0n,
            soldByOthers: 0n,
            devSold: false,
            lastTradeSlot: e.slot,
            recent: [],
            buysSent: 0,
            spentSent: 0n,
            lastBuyVq: 0n,
            lastBuyVt: 1n,
            lastBuySlot: 0,
            entries: 0,
            lastExit: -1e12,
            done: false,
            complete: false,
          });
        } else if (e.event === 'TradeEvent') {
          const c = coins.get(e.mint);
          if (c === undefined) continue;
          const sol = BigInt(e.sol_amount);
          c.trades += 1;
          c.lastTradeSlot = e.slot;
          c.recent.push({ slot: e.slot, isBuy: e.is_buy, sol, user: e.user });
          const isDev = e.user === c.creator;
          if (e.is_buy) {
            c.bought += sol;
            if (isDev && e.slot === c.createSlot) c.devBuy += sol;
            else if (!isDev) c.buyers.add(e.user);
          } else if (isDev) {
            c.devSold = true;
          } else {
            c.soldByOthers += sol;
          }
        } else {
          const c = coins.get(e.mint);
          if (c !== undefined) {
            c.complete = true;
            c.done = true;
          }
        }
      }

      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          held.delete(f.mint);
          continue;
        }
        if (f.status === 'filled') {
          myFills += 1;
          myCoins.add(f.mint);
        }
        const h = held.get(f.mint);
        if (h !== undefined && f.status !== 'rejected') h.txPaid += BigInt(f.tx_fee_lamports);
        if (f.side === 'buy' && f.status === 'filled' && h === undefined) {
          held.set(f.mint, {
            openedSlot: f.slot,
            txPaid: BigInt(f.tx_fee_lamports),
            best: 0n,
            devSoldAtOpen: coins.get(f.mint)?.devSold ?? false,
            tookTp1: false,
            adds: 0,
            proven: false,
            tokens: BigInt(f.token_amount),
            cost: BigInt(f.quote_lamports),
          });
        } else if (h !== undefined && f.status === 'filled') {
          if (f.side === 'buy') {
            h.tokens += BigInt(f.token_amount);
            h.cost += BigInt(f.quote_lamports);
          } else {
            const sold = BigInt(f.token_amount);
            if (h.tokens > 0n && sold > 0n) h.cost -= (h.cost * sold) / h.tokens;
            h.tokens -= sold;
            if (h.tokens < 0n) h.tokens = 0n;
          }
        }
      }
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint) && !hasPending(state, mint, 'buy') && !hasPending(state, mint, 'sell')) {
          held.delete(mint);
        }
      }

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();
      const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
      for (const m of batch.marks) {
        marks.set(m.mint, { vq: BigInt(m.virtual_quote_reserves), vt: BigInt(m.virtual_token_reserves) });
      }

      // Exits first.
      for (const [mint, pos] of state.positions) {
        if (orders.length >= cap) break;
        if (hasPending(state, mint, 'sell')) continue;
        const c = coins.get(mint);
        const curve0 = state.curves.get(mint);
        // A completed curve is closed by the harness itself; selling too would
        // double-spend the tokens (insufficient_tokens rejections).
        if (curve0 !== undefined && curve0.complete) continue;
        let h = held.get(mint);
        if (h === undefined) {
          h = { openedSlot: state.slot, txPaid: tx, best: 0n, devSoldAtOpen: c?.devSold ?? false, tookTp1: false, adds: 0, proven: false, tokens: pos.token_amount, cost: pos.cost_lamports };
          held.set(mint, h);
        }
        if (h.tokens === 0n && pos.token_amount > 0n) {
          h.tokens = pos.token_amount;
          h.cost = pos.cost_lamports;
        }
        let mk = marks.get(mint);
        if (mk === undefined) {
          const cv = state.curves.get(mint);
          if (cv === undefined) continue;
          mk = { vq: cv.virtual_quote_reserves, vt: cv.virtual_token_reserves };
        }
        const value = sellValue(h.tokens, mk.vq, mk.vt) - tx;
        const basis = h.cost + h.txPaid;
        if (value > h.best) h.best = value;
        if (basis > 0n && !h.proven && value * BPS >= basis * (BPS + P.proveBps)) h.proven = true;
        let exit = false;
        if (basis > 0n) {
          if (!h.tookTp1 && value * BPS >= basis * (BPS + P.tp1Bps)) {
            const part = (pos.token_amount * P.tp1PartBps) / BPS;
            if (part > 0n && part < pos.token_amount) {
              orders.push({ side: 'sell', mint, token_amount: part, max_slippage_bps: 10_000 });
              h.tookTp1 = true;
              h.best = 0n;
              continue;
            }
          }
          if (value * BPS <= basis * (BPS - P.slBps)) exit = true;
          if (h.best * BPS >= basis * (BPS + P.trailArmBps) && value * BPS <= h.best * (BPS - P.trailBps)) exit = true;
        }
        const holdLimit = h.proven
          ? P.runnerMaxHold
          : basis > 0n && value * BPS >= basis * (BPS + P.holdIfUpBps)
            ? P.maxHoldExtended
            : P.maxHold;
        if (state.slot - h.openedSlot >= holdLimit) exit = true;
        if (c !== undefined && P.exitOnDevSell && c.devSold && !h.devSoldAtOpen) exit = true;
        if (!exit) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        if (c !== undefined) {
          c.done = true;
          c.lastExit = state.slot;
        }
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, selling] of probes) {
        const pos = state.positions.get(mint);
        if (pos === undefined) {
          if (!hasPending(state, mint, 'buy')) probes.delete(mint);
          continue;
        }
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete || hasPending(state, mint, 'sell')) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        if (!selling) probes.set(mint, true);
      }

      // Entries and adds.
      let free = state.freeCashLamports() - tx * BigInt(orders.length);
      let open = state.committedPositionCount();
      let exposure = 0n;
      for (const [mint, h] of held) {
        void h;
        const pos = state.positions.get(mint);
        if (pos !== undefined) exposure += pos.cost_lamports;
      }
      for (const c of coins.values()) {
        if (orders.length >= cap) break;
        if (c.done || c.complete) continue;
        const age = state.slot - c.createSlot;
        const isAdd = c.buysSent > 0;
        if (!isAdd && age > P.maxAge) {
          c.done = true;
          continue;
        }
        if (isAdd) {
          if (c.buysSent > P.maxAdds) continue;
          if (!state.positions.has(c.mint) || hasPending(state, c.mint, 'buy') || hasPending(state, c.mint, 'sell')) continue;
          if (held.get(c.mint)?.tookTp1 && !held.get(c.mint)!.proven) continue;
        } else if (open >= P.maxOpen) {
          continue;
        }
        const curve = state.curves.get(c.mint);
        if (curve === undefined || curve.complete) continue;
        if (c.devSold && P.exitOnDevSell) {
          if (!isAdd) c.done = true;
          continue;
        }
        const vq = curve.virtual_quote_reserves;
        const vt = curve.virtual_token_reserves;
        if (isAdd) {
          const h = held.get(c.mint);
          if (h === undefined || h.adds >= P.maxAdds) continue;
          if (state.slot - c.lastBuySlot < P.addDelay) continue;
          // Price must have stepped up from the last buy's decision price.
          if (vq * c.lastBuyVt * BPS < c.lastBuyVq * vt * (BPS + P.addStepBps)) continue;
          if (flow(c, state.slot).net < P.addMinFlowLamports) continue;
          if (curve.real_quote_reserves < P.addMinRealSol) continue;
          const room = P.stakeLamports - c.spentSent;
          if (room < P.minBuyLamports) continue;
          const maxBuy = state.maxBuyLamports(c.mint);
          const amount = P.addLamports < maxBuy ? P.addLamports : maxBuy;
          const want = amount < room ? amount : room;
          if (want < P.minBuyLamports || free < want + tx) continue;
          if (exposure + want > P.maxExposureLamports) continue;
          orders.push({ side: 'buy', mint: c.mint, quote_lamports: want, max_slippage_bps: P.buySlippageBps });
          free -= want + tx;
          exposure += want;
          c.buysSent += 1;
          c.spentSent += want;
          c.lastBuyVq = vq;
          c.lastBuyVt = vt;
          c.lastBuySlot = state.slot;
          h.adds += 1;
          continue;
        }
        // Rug filter + entry signal on the opening tape.
        const rq = curve.real_quote_reserves;
        if (rq < P.minRealSol || rq > P.maxRealSol) continue;
        if (c.devBuy > P.maxDevBuy) continue;
        if (c.buyers.size < P.minBuyers || c.buyers.size > P.maxBuyers) continue;
        if (c.bought > 0n && c.soldByOthers * BPS > c.bought * P.maxSellRatioBps) continue;
        // Price must not already have run up more than maxRunupBps from create.
        if (vq * c.vt0 * BPS > vt * c.vq0 * (BPS + P.maxRunupBps)) continue;
        const fl = flow(c, state.slot);
        if (fl.net < P.minFlowLamports) continue;
        if (c.entries >= P.maxEntries || state.slot - c.lastExit < P.cooldown) continue;
        const room = P.stakeLamports - c.spentSent;
        if (room < P.minBuyLamports) continue;
        const maxBuy = state.maxBuyLamports(c.mint);
        const amount = room < maxBuy ? room : maxBuy;
        if (amount < P.minBuyLamports || free < amount + tx) continue;
        if (exposure + amount > P.maxExposureLamports) continue;
        orders.push({ side: 'buy', mint: c.mint, quote_lamports: amount, max_slippage_bps: P.buySlippageBps });
        free -= amount + tx;
        exposure += amount;
        c.buysSent += 1;
        c.spentSent += amount;
        c.lastBuyVq = vq;
        c.lastBuyVt = vt;
        c.lastBuySlot = state.slot;
        c.entries += 1;
        open += 1;
      }

      // Guardrail pacing: open a probe when fills or coins lag the pace.
      if (probes.size < P.maxProbes && firstTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / P.paceSecs);
        const needCoins = myCoins.size < Math.ceil(P.targetCoins * pace);
        const needFills = myFills < Math.ceil(P.targetFills * pace);
        if (needCoins || needFills) {
          const minRq = (P.probeLamports * BPS) / BigInt(state.hello.caps.max_order_bps_of_real_reserve);
          for (const c of coins.values()) {
            if (orders.length >= cap || probes.size >= P.maxProbes) break;
            if (held.has(c.mint) || probes.has(c.mint) || hasPending(state, c.mint, 'buy') || state.positions.has(c.mint)) continue;
            if (needCoins && !needFills && myCoins.has(c.mint)) continue;
            const curve = state.curves.get(c.mint);
            if (curve === undefined || curve.complete) continue;
            if (curve.real_quote_reserves < (minRq * 3n) / 2n) continue;
            if (free < P.probeLamports + 2n * tx) break;
            orders.push({ side: 'buy', mint: c.mint, quote_lamports: P.probeLamports, max_slippage_bps: P.buySlippageBps });
            probes.set(c.mint, false);
            free -= P.probeLamports + tx;
          }
        }
      }
      return orders;
    },
  };
}
