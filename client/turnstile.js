// Cloudflare Turnstile: proves a person (not a script) is joining. Rendered explicitly because the
// title screen stays open between joins and every join needs a fresh, single-use token.
// The site key comes from the server (/api/config), so production and local dev use different keys.
let siteKey = null;
let widgetId = null;
let ready = null;
let pending = null;

export function initTurnstile() {
  ready = fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      siteKey = cfg.turnstileSiteKey;
      if (!siteKey) return;
      return new Promise((resolve, reject) => {
        window.onTurnstileLoad = () => {
          widgetId = window.turnstile.render('#turnstile', {
            sitekey: siteKey,
            action: 'join', // must match the server's check
            execution: 'execute', // only run the check when someone actually joins
            appearance: 'interaction-only', // invisible unless Cloudflare needs a click
            callback: (token) => pending?.resolve(token),
            'error-callback': () => {
              pending?.reject(new Error('turnstile'));
              return true;
            },
            'expired-callback': () => window.turnstile.reset(widgetId),
          });
          resolve();
        };
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad';
        script.async = true;
        script.defer = true;
        script.onerror = () => reject(new Error('turnstile script'));
        document.head.appendChild(script);
      });
    });
  return ready;
}

// A fresh token for one join, or null when Turnstile isn't configured (plain local dev).
export async function humanToken() {
  await ready;
  if (!siteKey) return null;
  try {
    return await new Promise((resolve, reject) => {
      pending = { resolve, reject };
      window.turnstile.reset(widgetId);
      window.turnstile.execute(widgetId);
    });
  } finally {
    pending = null;
  }
}

// Tokens are single-use: clear the widget once a token has been sent.
export function spendToken() {
  if (widgetId !== null) window.turnstile.reset(widgetId);
}
