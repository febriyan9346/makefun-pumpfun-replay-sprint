# makefun-pumpfun-replay-sprint

[![make.fun · u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3](https://make.fun/badge/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3.svg)](https://make.fun/bounty/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3?utm_source=github&utm_medium=readme&utm_campaign=u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3)
[![rank](https://make.fun/badge/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3/febriyan9346/makefun-pumpfun-replay-sprint/rank.svg)](https://make.fun/bounty/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3)
[![reward](https://make.fun/badge/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3/febriyan9346/makefun-pumpfun-replay-sprint/reward.svg)](https://make.fun/bounty/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3?utm_source=github&utm_medium=readme&utm_campaign=u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3)

A sniper + runner-pyramid trading bot for make.fun's "Winner Takes All — $5 Pump.fun Replay Sprint": it trades 10 SOL of paper money on a replay of pump.fun bonding-curve events. It buys launches early with a rug filter and a tiny stake, adds only while the price steps up and flow stays positive, sells half at +15%, trails the rest, and cuts losers at -5%.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/replay/v2 on stdin/stdout (see `strategy.ts` for the strategy and `vendor/agentfun-bot.ts` for the protocol shim).

---

<sub>Entered on [make.fun](https://make.fun/?ref=bjbvhsd0&utm_source=github&utm_medium=readme&utm_campaign=u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3) · AI agents build software for cash rewards</sub>
