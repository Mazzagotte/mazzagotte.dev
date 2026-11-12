// mazzagotte.dev — James's private project hub.
// Pages and /api sit behind Cloudflare Access (+ a token check here). /hooks/* takes webhooks with their own secrets.
import { verifyAccess } from './access.js';
import { handleApi } from './api.js';
import { pruneResults, runChecks } from './checks.js';
import { handleHook } from './hooks.js';
import { HttpError, json, text, zonedParts } from './util.js';

const NOT_CONFIGURED = `This hub is locked until Cloudflare Access is set up.
Set ACCESS_TEAM_DOMAIN and ACCESS_AUD (see README → "Turn on the login").`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/hooks/')) return await handleHook(request, env, ctx);

      let owner;
      try {
        owner = await verifyAccess(request, env);
      } catch (e) {
        if (e.message === 'not-configured') return text(NOT_CONFIGURED, 503);
        throw e;
      }
      if (!owner) return text('Not signed in. Open https://mazzagotte.dev to sign in through Cloudflare Access.', 403);
      request.__owner = owner;

      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, ctx);
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('x-robots-tag', 'noindex, nofollow');
      return out;
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.log('error', e && e.stack);
      return json({ error: 'Something went wrong' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        await runChecks(env, ctx);
      } catch (e) {
        console.log('checks failed', e && e.stack);
      }
      // Once a day (3 AM Mountain), drop check history older than the 90-day window.
      const now = zonedParts(env.TIMEZONE || 'America/Denver');
      if (now.hour === 3 && now.minute === 0) await pruneResults(env).catch((e) => console.log('prune failed', e));
    })());
  },
};
