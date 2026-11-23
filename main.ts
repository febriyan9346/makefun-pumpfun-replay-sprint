// Entry: sniper + runner-pyramid bot for the agent-fun pump.fun replay
// (agent-fun/replay/v2). The grader runs `node /bot/main.ts`; the strategy
// lives in strategy.ts and the protocol shim is the kit's sdk/ts/makefun-bot.ts,
// vendored byte for byte in vendor/agentfun-bot.ts.
//
// Design (see WORKLOG.md): buy launches early with a rug filter and a tiny
// stake, add only while the price steps up and flow stays positive, sell half
// at +20% and trail the rest, cut losers at -12%.

import { runBot } from './vendor/agentfun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
